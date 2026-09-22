/**
 * The orchestrator: the only process holding the Docker socket.
 *
 * Responsibilities:
 *   - runner container lifecycle (dockerode)
 *   - WebSocket fan-out between browser and runner
 *   - the terminal, over docker exec
 *
 * Next.js cannot do this: App Router route handlers are request/response and offer no
 * WebSocket server, and a duplex channel is essential because one connection carries
 * the prompt, the permission reply, the file operation and the keystroke.
 */

import { randomUUID, randomBytes } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer, type WebSocket } from "ws";
import {
  CONTAINER_RUNNERS,
  type ContainerRunner,
  type RunnerCommand,
  type RunnerEvent,
  type SessionSpec,
} from "@agent-lab/protocol";
import {
  createRunner,
  destroySession,
  ensureNetwork,
  openTerminal,
  pingDocker,
  reapOrphans,
  stopRunner,
  type TerminalHandle,
} from "./docker.ts";
import {
  attachClient,
  attachRunner,
  createSession,
  detachClient,
  emitLocal,
  getSession,
  listSessions,
  onRunnerEvent,
  removeSession,
  sendToRunner,
} from "./sessions.ts";

const PORT = Number(process.env.ORCHESTRATOR_PORT ?? 8080);
/**
 * Which directory gets mounted at /skills.
 *
 * `.skills-cache` is what `sync-skills` builds when you overlay a personal library on top
 * of the repo's own skills. Without it we mount `skills/` straight from the repo, so a
 * fresh clone runs with no setup step at all.
 */
const SKILLS_HOST_PATH = resolveSkillsPath();

function resolveSkillsPath(): string {
  if (process.env.SKILLS_HOST_PATH) {
    return path.resolve(process.env.SKILLS_HOST_PATH);
  }
  // Resolve against the repo root, not the process cwd: this service is started from
  // services/orchestrator, so a relative path would look for skills next to the source.
  const repoRoot = path.resolve(import.meta.dirname, "../../..");
  const cache = path.join(repoRoot, ".skills-cache");
  if (existsSync(cache)) return cache;
  return path.join(repoRoot, "skills");
}
/**
 * What differs between tracks at the container level: the image, where the engine keeps
 * its state, the default model, and which credentials it may see. The lifecycle, the
 * socket and the terminal are shared.
 */
type Track = {
  image: string;
  stateDir: string;
  defaultModel: string;
  /** Model routing and keys, passed through as-is. A runner never sees any other. */
  env: Record<string, string | undefined>;
  extraBinds: string[];
};

const TRACKS: Record<ContainerRunner, Track> = {
  "claude-container": {
    image: process.env.RUNNER_IMAGE ?? "agent-lab-runner-claude:latest",
    stateDir: "/home/node/.claude",
    defaultModel: process.env.AGENT_MODEL ?? "claude-sonnet-5",
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
      CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
      ANTHROPIC_FOUNDRY_API_KEY: process.env.ANTHROPIC_FOUNDRY_API_KEY,
      ANTHROPIC_FOUNDRY_RESOURCE: process.env.ANTHROPIC_FOUNDRY_RESOURCE,
      CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
      CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
    },
    extraBinds: [],
  },
  "codex-container": {
    image: process.env.RUNNER_CODEX_IMAGE ?? "agent-lab-runner-codex:latest",
    stateDir: "/home/node/.codex",
    defaultModel: process.env.CODEX_MODEL ?? "gpt-5.5",
    // Deliberately CODEX_API_KEY and not OPENAI_API_KEY: the latter belongs to the
    // LiteLLM gateway, and forwarding it here would put a gateway credential in a runner.
    env: {
      CODEX_API_KEY: process.env.CODEX_API_KEY,
      CODEX_SANDBOX_MODE: process.env.CODEX_SANDBOX_MODE,
    },
    extraBinds: codexAuthBinds(),
  },
};

/**
 * A ChatGPT login for the codex-container track — opt-in, never automatic.
 *
 * The file is mounted read-only and the entrypoint copies it into the session's own
 * volume, because Codex rewrites it on token refresh. Code the agent runs can read that
 * copy, exactly as it could read an API key in its environment.
 */
function codexAuthBinds(): string[] {
  const raw = process.env.CODEX_AUTH_FILE;
  if (!raw) return [];
  const file = path.resolve(raw.replace(/^~(?=$|[\\/])/, os.homedir()));
  if (!existsSync(file)) {
    console.warn(`[orchestrator] CODEX_AUTH_FILE not found: ${file}`);
    return [];
  }
  return [`${file}:/run/secrets/codex-auth.json:ro`];
}

function isContainerRunner(value: unknown): value is ContainerRunner {
  return CONTAINER_RUNNERS.includes(value as ContainerRunner);
}

const RUNNER_NETWORK = process.env.RUNNER_NETWORK ?? "agent-lab-net";
const RUNNER_MEMORY_MB = Number(process.env.RUNNER_MEMORY_MB ?? 2048);
const RUNNER_CPUS = Number(process.env.RUNNER_CPUS ?? 2);
/**
 * How a container reaches us. In Windows development the orchestrator runs on the host
 * (so it can reach the named pipe), hence the container dials host.docker.internal.
 */
const RUNNER_CALLBACK_WS =
  process.env.RUNNER_CALLBACK_WS ?? `ws://host.docker.internal:${PORT}`;
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_SESSIONS ?? 4);
/** LiteLLM gateway, if one is running. Empty disables the check. */
const GATEWAY_URL = process.env.LITELLM_URL ?? "http://127.0.0.1:4000";

const app = new Hono();
app.use("*", cors());

/**
 * Is the LiteLLM gateway reachable?
 *
 * Non-Claude models only work through it, so the UI needs to know before offering them.
 * Kept short and failure-tolerant: a missing gateway is a normal state, not an error.
 */
async function pingGateway(): Promise<boolean> {
  if (!GATEWAY_URL) return false;
  try {
    const res = await fetch(`${GATEWAY_URL}/health/liveliness`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

app.get("/health", async (c) => {
  const [docker, gateway] = await Promise.all([pingDocker(), pingGateway()]);
  return c.json({
    status: docker ? "ok" : "docker-unavailable",
    docker,
    gateway,
    sessions: listSessions().length,
    images: Object.fromEntries(
      Object.entries(TRACKS).map(([runner, t]) => [runner, t.image]),
    ),
    skillsPath: SKILLS_HOST_PATH,
  });
});

/** The skill library from the host cache. Lets the UI list skills before a session. */
app.get("/api/skills", async (c) => {
  try {
    const dirs = await fs.readdir(SKILLS_HOST_PATH, { withFileTypes: true });
    const skills = [];
    for (const d of dirs) {
      if (!d.isDirectory() || d.name.startsWith(".")) continue;
      const file = path.join(SKILLS_HOST_PATH, d.name, "SKILL.md");
      const raw = await fs.readFile(file, "utf8").catch(() => null);
      if (raw === null) continue;
      skills.push({ name: d.name, description: frontmatterDescription(raw) });
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return c.json({ skills, path: SKILLS_HOST_PATH });
  } catch (err) {
    return c.json(
      { skills: [], error: String((err as Error).message), path: SKILLS_HOST_PATH },
      200,
    );
  }
});

app.get("/api/sessions", (c) => c.json({ sessions: listSessions() }));

app.post("/api/sessions", async (c) => {
  if (listSessions().filter((s) => s.state !== "stopped").length >= MAX_CONCURRENT) {
    return c.json(
      { error: `Concurrency limit of ${MAX_CONCURRENT} reached. Close a session first.` },
      429,
    );
  }

  type CreateBody = Partial<SessionSpec> & { runner?: string };
  const body: CreateBody = await c.req
    .json<CreateBody>()
    .catch(() => ({}) as CreateBody);

  const runner = body.runner ?? "claude-container";
  if (!isContainerRunner(runner)) {
    return c.json(
      { error: `Unknown runner "${runner}". Available: ${CONTAINER_RUNNERS.join(", ")}.` },
      400,
    );
  }
  const track = TRACKS[runner];

  const sessionId = randomUUID().slice(0, 12);
  const token = randomBytes(24).toString("hex");

  const spec: SessionSpec = {
    sessionId,
    model: body.model ?? track.defaultModel,
    permissionMode: body.permissionMode ?? "acceptEdits",
    skills: body.skills ?? "all",
    maxTurns: body.maxTurns ?? Number(process.env.AGENT_MAX_TURNS ?? 40),
    maxBudgetUsd:
      body.maxBudgetUsd ?? Number(process.env.AGENT_MAX_BUDGET_USD ?? 5),
    cwd: "/workspace",
    ...(body.repoUrl ? { repoUrl: body.repoUrl } : {}),
    ...(body.resume ? { resume: body.resume } : {}),
  };

  createSession(spec, token, runner);

  try {
    await ensureNetwork(RUNNER_NETWORK);
    await createRunner({
      sessionId,
      runner,
      token,
      stateDir: track.stateDir,
      extraBinds: track.extraBinds,
      skillsPath: SKILLS_HOST_PATH,
      orchestratorWs: RUNNER_CALLBACK_WS,
      image: track.image,
      memoryMb: RUNNER_MEMORY_MB,
      cpus: RUNNER_CPUS,
      network: RUNNER_NETWORK,
      env: track.env,
    });
  } catch (err) {
    removeSession(sessionId);
    return c.json({ error: String((err as Error).message) }, 500);
  }

  return c.json({ sessionId, runner, spec });
});

app.delete("/api/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const purge = c.req.query("purge") === "1";
  if (purge) await destroySession(id);
  else await stopRunner(id);
  removeSession(id);
  return c.json({ ok: true, purged: purge });
});

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[orchestrator] http://localhost:${info.port}`);
  console.log(`[orchestrator] skills: ${SKILLS_HOST_PATH}`);
  for (const [runner, t] of Object.entries(TRACKS)) {
    console.log(`[orchestrator] ${runner}: ${t.image}`);
  }
  console.log(`[orchestrator] container callback: ${RUNNER_CALLBACK_WS}`);
});

// --- WebSockets --------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const sessionId = url.searchParams.get("session") ?? "";
  const session = getSession(sessionId);

  if (!session) {
    socket.destroy();
    return;
  }

  if (url.pathname === "/ws/runner") {
    if (url.searchParams.get("token") !== session.token) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      attachRunner(session, ws);
      ws.on("message", (raw) => {
        try {
          onRunnerEvent(session, JSON.parse(raw.toString()) as RunnerEvent);
        } catch {
          /* a malformed frame is ignored */
        }
      });
      ws.on("close", () => {
        session.runnerWs = undefined;
        // Without this, dead sessions keep occupying the concurrency limit.
        session.state = "stopped";
        emitLocal(session, {
          type: "session.status",
          status: "stopped",
          detail: "runner disconnected",
        });
      });
    });
    return;
  }

  if (url.pathname === "/ws/client") {
    const since = Number(url.searchParams.get("since") ?? -1);
    wss.handleUpgrade(req, socket, head, (ws) => {
      attachClient(session, ws, since);
      const terminals = new Map<string, TerminalHandle>();

      ws.on("message", (raw) => {
        let cmd: RunnerCommand;
        try {
          cmd = JSON.parse(raw.toString()) as RunnerCommand;
        } catch {
          return;
        }
        void handleClientCommand(sessionId, cmd, terminals, ws);
      });

      ws.on("close", () => {
        for (const t of terminals.values()) t.close();
        terminals.clear();
        detachClient(session, ws);
      });
    });
    return;
  }

  socket.destroy();
});

/**
 * pty.* commands are served here over docker exec. Everything else is forwarded to
 * the runner untouched.
 */
async function handleClientCommand(
  sessionId: string,
  cmd: RunnerCommand,
  terminals: Map<string, TerminalHandle>,
  _ws: WebSocket,
) {
  const session = getSession(sessionId);
  if (!session) return;

  switch (cmd.type) {
    case "pty.open": {
      if (terminals.has(cmd.ptyId)) return;
      try {
        const term = await openTerminal(sessionId, cmd.cols, cmd.rows);
        terminals.set(cmd.ptyId, term);
        term.stream.on("data", (chunk: Buffer) => {
          emitLocal(session, {
            type: "pty.output",
            ptyId: cmd.ptyId,
            data: chunk.toString("base64"),
          });
        });
        term.stream.on("end", () => {
          terminals.delete(cmd.ptyId);
          emitLocal(session, { type: "pty.exit", ptyId: cmd.ptyId, exitCode: 0 });
        });
      } catch (err) {
        emitLocal(session, {
          type: "error",
          code: "sandbox_error",
          message: `Could not open terminal: ${(err as Error).message}`,
          retryable: true,
        });
      }
      return;
    }

    case "pty.input":
      terminals.get(cmd.ptyId)?.stream.write(Buffer.from(cmd.data, "base64"));
      return;

    case "pty.resize":
      await terminals.get(cmd.ptyId)?.resize(cmd.cols, cmd.rows);
      return;

    case "pty.close":
      terminals.get(cmd.ptyId)?.close();
      terminals.delete(cmd.ptyId);
      return;

    default:
      sendToRunner(session, cmd);
  }
}

// --- startup and shutdown ----------------------------------------------------

const orphans = await reapOrphans();
if (orphans > 0) console.log(`[orchestrator] reaped ${orphans} orphaned containers`);

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    console.log("\n[orchestrator] shutting down, stopping runners...");
    for (const s of listSessions()) await stopRunner(s.id).catch(() => {});
    process.exit(0);
  });
}

/** Extracts the `description:` field from a SKILL.md frontmatter block. */
function frontmatterDescription(raw: string): string {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return "";
  const line = m[1].match(/^description:\s*(.+)$/m);
  if (!line) return "";
  return line[1].trim().replace(/^["']|["']$/g, "");
}
