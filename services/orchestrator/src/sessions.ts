/**
 * Session registry and message routing.
 *
 * Three parties per session:
 *   browser <-> orchestrator <-> runner container
 *
 * The orchestrator forwards commands to the runner and events back to the browser,
 * except pty.* commands, which it serves itself over docker exec.
 *
 * Events go into a ring buffer so a reconnect can ask for the gap again with the
 * `since` parameter.
 */

import type { WebSocket } from "ws";
import type {
  ContainerRunner,
  RunnerEvent,
  RunnerEventBody,
  SessionSpec,
} from "@agent-lab/protocol";

const BUFFER_SIZE = 2000;

export type SessionState = "starting" | "ready" | "stopped" | "error";

export type Session = {
  id: string;
  token: string;
  runner: ContainerRunner;
  spec: SessionSpec;
  state: SessionState;
  createdAt: number;
  /** The latest session.init, so a new browser connection gets the skill list at once. */
  init?: Extract<RunnerEventBody, { type: "session.init" }>;
  title: string;
  totalCostUsd: number;

  runnerWs?: WebSocket;
  clients: Set<WebSocket>;
  /** Events the runner sent before any browser had joined. */
  buffer: RunnerEvent[];
  /** Commands queued while the runner has not connected yet. */
  pending: unknown[];
};

const sessions = new Map<string, Session>();

/** Repo name as the title — a session list reads better than a column of uuids. */
function repoTitle(repoUrl?: string): string {
  if (!repoUrl) return "Empty workspace";
  const parts = repoUrl
    .replace(/\.git$/, "")
    .split(/[/:]/)
    .filter(Boolean)
    .slice(-2);
  return parts.join("/") || "Workspace";
}

export function createSession(
  spec: SessionSpec,
  token: string,
  runner: ContainerRunner,
): Session {
  const s: Session = {
    id: spec.sessionId,
    token,
    runner,
    spec,
    state: "starting",
    createdAt: Date.now(),
    title: repoTitle(spec.repoUrl),
    totalCostUsd: 0,
    clients: new Set(),
    buffer: [],
    pending: [],
  };
  sessions.set(s.id, s);
  return s;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function listSessions() {
  return [...sessions.values()]
    .map((s) => ({
      id: s.id,
      title: s.title,
      state: s.state,
      runner: s.runner,
      createdAt: s.createdAt,
      model: s.spec.model,
      repoUrl: s.spec.repoUrl,
      skillCount: s.init?.skills.length ?? 0,
      totalCostUsd: s.totalCostUsd,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function removeSession(id: string) {
  const s = sessions.get(id);
  if (!s) return;
  for (const c of s.clients) c.close();
  s.runnerWs?.close();
  sessions.delete(id);
}

/** The runner connected. Send the spec and drain the queue. */
export function attachRunner(s: Session, ws: WebSocket) {
  s.runnerWs = ws;
  ws.send(JSON.stringify({ type: "spec", spec: s.spec }));
  for (const cmd of s.pending.splice(0)) ws.send(JSON.stringify(cmd));
}

/** A browser connected. Replay buffered events from the given seq. */
export function attachClient(s: Session, ws: WebSocket, since = -1) {
  s.clients.add(ws);
  for (const ev of s.buffer) {
    if (ev.seq > since) ws.send(JSON.stringify(ev));
  }
}

export function detachClient(s: Session, ws: WebSocket) {
  s.clients.delete(ws);
}

/** Runner event: buffer it, update state, broadcast to browsers. */
export function onRunnerEvent(s: Session, ev: RunnerEvent) {
  s.buffer.push(ev);
  if (s.buffer.length > BUFFER_SIZE) s.buffer.shift();

  if (ev.type === "session.init") {
    s.init = ev;
    s.state = "ready";
  } else if (ev.type === "finish") {
    s.totalCostUsd = ev.totalCostUsd;
  } else if (ev.type === "error") {
    s.state = "error";
  }

  broadcast(s, ev);
}

/** An event the orchestrator itself produced (terminal output, container error). */
export function emitLocal(s: Session, body: RunnerEventBody) {
  const ev: RunnerEvent = {
    ...body,
    sessionId: s.id,
    seq: nextLocalSeq(s),
    ts: Date.now(),
  };
  // Terminal data does not belong in the transcript — it would be megabytes of noise.
  if (body.type !== "pty.output") {
    s.buffer.push(ev);
    if (s.buffer.length > BUFFER_SIZE) s.buffer.shift();
  }
  broadcast(s, ev);
}

/**
 * Local events take a seq above the runner's numbering so the two sources cannot
 * collide. The runner numbers 0..n and the orchestrator continues from there.
 */
function nextLocalSeq(s: Session): number {
  const last = s.buffer[s.buffer.length - 1];
  return (last?.seq ?? -1) + 1;
}

function broadcast(s: Session, ev: RunnerEvent) {
  const payload = JSON.stringify(ev);
  for (const c of s.clients) {
    if (c.readyState === 1) c.send(payload);
  }
}

/** Command for the runner. Queued if the runner has not connected yet. */
export function sendToRunner(s: Session, cmd: unknown) {
  if (s.runnerWs && s.runnerWs.readyState === 1) {
    s.runnerWs.send(JSON.stringify(cmd));
    return;
  }
  s.pending.push(cmd);
}
