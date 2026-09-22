/**
 * The runner process. Runs inside the container alongside the agent and the workspace.
 *
 * The container publishes NO port. It dials out to the orchestrator over a WebSocket.
 * That removes port allocation entirely and behaves identically on Windows and Linux —
 * runners can sit on an internal network where only the orchestrator and the model
 * router are reachable.
 */

import { WebSocket } from "ws";
import {
  frame,
  type RunnerCommand,
  type RunnerEventBody,
  type SessionSpec,
} from "@agent-lab/protocol";
import { startAgent, type AgentSession } from "./agent.ts";
import { WorkspaceFs } from "./fs-api.ts";
import { cloneInto } from "./workspace-setup.ts";
import { Translator } from "./translate.ts";

const ORCHESTRATOR_WS = process.env.ORCHESTRATOR_WS ?? "ws://orchestrator:8080";
const RUNNER_TOKEN = process.env.RUNNER_TOKEN ?? "";
const SESSION_ID = process.env.SESSION_ID ?? "";
const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? "/workspace";

if (!SESSION_ID || !RUNNER_TOKEN) {
  console.error("SESSION_ID ja RUNNER_TOKEN ovat pakollisia.");
  process.exit(1);
}

const fsApi = new WorkspaceFs(WORKSPACE_DIR);
const translator = new Translator();

let seq = 0;
let agent: AgentSession | null = null;
let pumping = false;

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

  // The orchestrator sends the spec once, before any command.
  const maybeSpec = parsed as { type?: string; spec?: SessionSpec };
  if (maybeSpec.type === "spec" && maybeSpec.spec) {
    if (agent) return;
    const spec = maybeSpec.spec;

    // Clone BEFORE starting the agent so it sees the repo on the very first turn
    // rather than an empty directory.
    if (spec.repoUrl) {
      emit({
        type: "session.status",
        status: "starting",
        detail: `cloning ${spec.repoUrl}`,
      });
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

    const session = startAgent(spec);
    agent = session;
    // Pump first, so the stream has a consumer when the subprocess comes up.
    void pump(session);
    void session
      .warmup()
      .then((info) => {
        for (const body of translator.initFromControl({
          agentSessionId: spec.sessionId,
          model: spec.model,
          cwd: spec.cwd,
          permissionMode: spec.permissionMode,
          skills: info.skills,
          slashCommands: info.slashCommands,
          tools: [],
          ...(spec.repoUrl ? { repoUrl: spec.repoUrl } : {}),
        })) {
          emit(body);
        }
      })
      .catch((err: unknown) => {
        emit({
          type: "error",
          code: "sandbox_error",
          message: `Agent failed to start: ${(err as Error)?.message ?? err}`,
          retryable: false,
        });
      });
    return;
  }

  await handleCommand(parsed as RunnerCommand);
});

ws.on("close", () => {
  console.log("[runner] connection closed, shutting down");
  agent?.close();
  process.exit(0);
});

ws.on("error", (err) => {
  console.error("[runner] websocket error:", err.message);
});

/** Pumps the SDK message stream through the translator into the WebSocket. */
async function pump(session: AgentSession) {
  if (pumping) return;
  pumping = true;
  try {
    for await (const msg of session.messages) {
      for (const body of translator.translate(msg)) emit(body);
    }
  } catch (err) {
    emit({
      type: "error",
      code: "model_error",
      message: String((err as Error)?.message ?? err),
      retryable: false,
    });
  } finally {
    pumping = false;
  }
}

async function handleCommand(cmd: RunnerCommand) {
  switch (cmd.type) {
    case "prompt":
      if (!agent) return;
      emit({ type: "session.status", status: "thinking" });
      agent.prompt(cmd.text);
      return;

    case "interrupt":
      await agent?.interrupt().catch(() => {});
      return;

    case "stop":
      agent?.close();
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

    case "ping":
      return;

    default:
      // The terminal is served by the orchestrator over docker exec,
      // so pty.* commands never reach this point.
      return;
  }
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    agent?.close();
    ws.close();
    process.exit(0);
  });
}
