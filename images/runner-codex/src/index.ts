/**
 * The runner process for the codex-container track.
 *
 * Same wiring as runner-claude: the container publishes no port and dials out to the
 * orchestrator. What differs is the engine — turns run one at a time through the Codex
 * SDK — and where session.init comes from: a scan of the skill mount rather than an
 * engine control channel, because `codex exec` has none.
 */

import { WebSocket } from "ws";
import {
  frame,
  type RunnerCommand,
  type RunnerEventBody,
  type SessionSpec,
} from "@agent-lab/protocol";
import { startAgent, type CodexAgent } from "./agent.ts";
import { WorkspaceFs } from "./fs-api.ts";
import { scanSkills } from "./skills.ts";
import { Translator } from "./translate.ts";
import { cloneInto } from "./workspace-setup.ts";

const ORCHESTRATOR_WS = process.env.ORCHESTRATOR_WS ?? "ws://orchestrator:8080";
const RUNNER_TOKEN = process.env.RUNNER_TOKEN ?? "";
const SESSION_ID = process.env.SESSION_ID ?? "";
const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? "/workspace";
const SKILLS_MOUNT = process.env.SKILLS_MOUNT ?? "/skills";

if (!SESSION_ID || !RUNNER_TOKEN) {
  console.error("SESSION_ID and RUNNER_TOKEN are required.");
  process.exit(1);
}

const fsApi = new WorkspaceFs(WORKSPACE_DIR);
const translator = new Translator();

let seq = 0;
let agent: CodexAgent | null = null;
/** Turns run strictly one after another; a prompt sent mid-turn waits its place. */
let queue: Promise<void> = Promise.resolve();
let current: AbortController | null = null;

const url = `${ORCHESTRATOR_WS}/ws/runner?session=${encodeURIComponent(SESSION_ID)}&token=${encodeURIComponent(RUNNER_TOKEN)}`;
const ws = new WebSocket(url);

function emit(body: RunnerEventBody) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(frame(body, SESSION_ID, seq++)));
}

function fail(requestId: string, err: unknown) {
  emit({
    type: "result",
    requestId,
    ok: false,
    error: { code: "fs_error", message: String((err as Error)?.message ?? err) },
  });
}

ws.on("open", () => {
  console.log(`[runner] connected to orchestrator, session ${SESSION_ID}`);
  emit({ type: "session.status", status: "starting" });
});

ws.on("message", async (raw) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    return;
  }

  const maybeSpec = parsed as { type?: string; spec?: SessionSpec };
  if (maybeSpec.type === "spec" && maybeSpec.spec) {
    if (agent) return;
    await begin(maybeSpec.spec);
    return;
  }

  await handleCommand(parsed as RunnerCommand);
});

ws.on("close", () => {
  console.log("[runner] connection closed, shutting down");
  current?.abort();
  process.exit(0);
});

ws.on("error", (err) => {
  console.error("[runner] websocket error:", err.message);
});

async function begin(spec: SessionSpec) {
  if (spec.repoUrl) {
    emit({ type: "session.status", status: "starting", detail: `cloning ${spec.repoUrl}` });
    const res = await cloneInto(spec.repoUrl, WORKSPACE_DIR);
    if (res.ok) {
      emit({ type: "file.tree-invalidated", root: "." });
      emit({
        type: "session.status",
        status: "starting",
        detail: `${res.files} entries from branch ${res.branch}`,
      });
    } else {
      emit({
        type: "error",
        code: "sandbox_error",
        message: `Clone failed: ${res.error}`,
        retryable: true,
      });
    }
  }

  agent = startAgent(spec);
  const skills = await scanSkills(SKILLS_MOUNT);
  for (const body of translator.init({
    agentSessionId: spec.sessionId,
    model: spec.model,
    cwd: spec.cwd,
    permissionMode: spec.permissionMode,
    sandboxMode: agent.sandboxMode,
    skills,
    ...(spec.repoUrl ? { repoUrl: spec.repoUrl } : {}),
  })) {
    emit(body);
  }
}

async function runTurn(session: CodexAgent, text: string) {
  const controller = new AbortController();
  current = controller;
  translator.beginTurn();
  emit({ type: "session.status", status: "thinking" });
  try {
    for await (const ev of session.turn(text, controller.signal)) {
      for (const body of translator.translate(ev)) emit(body);
    }
    // The stream can end without a turn event if codex exited early.
    for (const body of translator.fail("codex exited without finishing the turn")) emit(body);
  } catch (err) {
    const bodies = controller.signal.aborted
      ? translator.stopped()
      : translator.fail(String((err as Error)?.message ?? err));
    for (const body of bodies) emit(body);
  } finally {
    if (current === controller) current = null;
  }
}

async function handleCommand(cmd: RunnerCommand) {
  switch (cmd.type) {
    case "prompt": {
      const session = agent;
      if (!session) return;
      queue = queue.then(() => runTurn(session, cmd.text));
      return;
    }

    case "interrupt":
      current?.abort();
      return;

    case "stop":
      current?.abort();
      ws.close();
      return;

    case "fs.list":
      try {
        emit({
          type: "result",
          requestId: cmd.requestId,
          ok: true,
          data: await fsApi.list(cmd.path, cmd.depth ?? 4),
        });
      } catch (err) {
        fail(cmd.requestId, err);
      }
      return;

    case "fs.read":
      try {
        emit({
          type: "result",
          requestId: cmd.requestId,
          ok: true,
          data: await fsApi.read(cmd.path),
        });
      } catch (err) {
        fail(cmd.requestId, err);
      }
      return;

    case "fs.write":
      try {
        const data = await fsApi.write(cmd.path, cmd.content);
        emit({ type: "result", requestId: cmd.requestId, ok: true, data });
        emit({ type: "file.changed", path: cmd.path, op: "modify" });
      } catch (err) {
        fail(cmd.requestId, err);
      }
      return;

    case "fs.delete":
      try {
        await fsApi.remove(cmd.path);
        emit({ type: "result", requestId: cmd.requestId, ok: true });
        emit({ type: "file.changed", path: cmd.path, op: "delete" });
      } catch (err) {
        fail(cmd.requestId, err);
      }
      return;

    case "fs.diff":
      try {
        emit({
          type: "result",
          requestId: cmd.requestId,
          ok: true,
          data: await fsApi.diff(cmd.path),
        });
      } catch (err) {
        fail(cmd.requestId, err);
      }
      return;

    default:
      // ping needs no reply; pty.* is served by the orchestrator over docker exec;
      // set-mode and set-model are not supported by this track yet.
      return;
  }
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    current?.abort();
    ws.close();
    process.exit(0);
  });
}
