"use client";

/**
 * Event stream -> renderable state.
 *
 * The part state machine follows AI SDK 7's ToolUIPart phases
 * (input-streaming -> input-available -> output-available | output-error), so
 * ai-elements' <Tool> and <Confirmation> can be dropped in later without changing
 * the protocol or the reducer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DiscoveredSkill,
  RunnerCapabilities,
  RunnerEvent,
  SessionStatus,
  ToolKind,
} from "@skill-lab/protocol";
import { RunnerClient } from "./runner-client";

export type ToolPartState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error";

export type Part =
  | { kind: "text"; id: string; text: string; streaming: boolean }
  | { kind: "reasoning"; id: string; text: string; streaming: boolean }
  | {
      kind: "tool";
      toolCallId: string;
      toolName: string;
      toolKind: ToolKind;
      title?: string;
      state: ToolPartState;
      inputText: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
      /** Required in approval-requested state, or the confirmation renders nothing. */
      approval?: { id: string; approved?: boolean; reason?: string };
    }
  | { kind: "skill"; toolCallId: string; name: string; via: string };

export type Turn = { id: string; role: "user" | "assistant"; parts: Part[] };

export type SessionInfo = {
  model: string;
  cwd: string;
  repoUrl?: string;
  skills: DiscoveredSkill[];
  slashCommands: string[];
  capabilities: RunnerCapabilities;
};

export type Usage = { costUsd: number; input: number; output: number };

export function useRunnerSession(sessionId: string) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<SessionStatus>("starting");
  const [connection, setConnection] = useState<"connecting" | "open" | "closed">(
    "connecting",
  );
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [usage, setUsage] = useState<Usage>({ costUsd: 0, input: 0, output: 0 });
  const [treeVersion, setTreeVersion] = useState(0);
  /** The most recently changed file, so an open editor can reload itself. */
  const [changedFile, setChangedFile] = useState<{ path: string; nonce: number } | null>(null);
  const [ptyOutput, setPtyOutput] = useState<{ ptyId: string; data: string } | null>(
    null,
  );
  const clientRef = useRef<RunnerClient | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const client = new RunnerClient({
      sessionId,
      onStatus: setConnection,
      onEvent: (ev) => applyEvent(ev),
    });
    clientRef.current = client;
    client.connect();
    return () => {
      client.close();
      clientRef.current = null;
    };

    function applyEvent(ev: RunnerEvent) {
      switch (ev.type) {
        case "session.init":
          setInfo({
            model: ev.model,
            cwd: ev.cwd,
            skills: ev.skills,
            slashCommands: ev.slashCommands,
            capabilities: ev.capabilities,
            repoUrl: ev.repoUrl,
          });
          return;

        case "session.status":
          setStatus(ev.status);
          return;

        case "usage":
          setUsage({
            costUsd: ev.cumulativeCostUsd,
            input: ev.inputTokens,
            output: ev.outputTokens,
          });
          return;

        case "file.tree-invalidated":
          setTreeVersion((v) => v + 1);
          return;

        case "file.changed":
          setTreeVersion((v) => v + 1);
          setChangedFile({ path: ev.path, nonce: Date.now() });
          return;

        case "pty.output":
          setPtyOutput({ ptyId: ev.ptyId, data: ev.data });
          return;

        default:
          setTurns((prev) => reduce(prev, ev));
      }
    }
  }, [sessionId]);

  const sendPrompt = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setTurns((prev) => [
      ...prev,
      {
        id: `u${prev.length}`,
        role: "user",
        parts: [{ kind: "text", id: "u", text: trimmed, streaming: false }],
      },
    ]);
    setStatus("thinking");
    clientRef.current?.send({ type: "prompt", text: trimmed });
  }, []);

  const interrupt = useCallback(() => {
    clientRef.current?.send({ type: "interrupt" });
  }, []);

  const respondPermission = useCallback(
    (requestId: string, decision: "allow" | "deny") => {
      clientRef.current?.send({ type: "permission.respond", requestId, decision });
    },
    [],
  );

  return {
    turns,
    status,
    connection,
    info,
    usage,
    treeVersion,
    changedFile,
    ptyOutput,
    client: clientRef,
    sendPrompt,
    interrupt,
    respondPermission,
  };
}

/**
 * Events that produce a conversation part. The rest (finish, result, pty…) must not
 * create a turn — otherwise an empty assistant turn appears and displaces the empty
 * state along with its instructions.
 */
const PART_EVENTS = new Set([
  "text.start",
  "text.delta",
  "text.end",
  "reasoning.start",
  "reasoning.delta",
  "reasoning.end",
  "tool.start",
  "tool.input-delta",
  "tool.input",
  "tool.result",
  "tool.error",
  "skill.invoked",
  "permission.request",
  "permission.resolved",
  "error",
]);

/** Pure reducer: easy to test without a WebSocket. */
function reduce(turns: Turn[], ev: RunnerEvent): Turn[] {
  if (!PART_EVENTS.has(ev.type)) return turns;

  const next = [...turns];
  let turn = next[next.length - 1];

  // Assistant parts belong to the last assistant turn; create one when needed.
  if (!turn || turn.role !== "assistant") {
    turn = { id: `a${next.length}`, role: "assistant", parts: [] };
    next.push(turn);
  } else {
    turn = { ...turn, parts: [...turn.parts] };
    next[next.length - 1] = turn;
  }
  const parts = turn.parts;

  const findTool = (id: string) =>
    parts.findIndex((p) => p.kind === "tool" && p.toolCallId === id);

  switch (ev.type) {
    case "text.start":
      parts.push({ kind: "text", id: ev.id, text: "", streaming: true });
      break;

    case "text.delta": {
      const i = parts.findIndex((p) => p.kind === "text" && p.id === ev.id);
      if (i === -1) {
        parts.push({ kind: "text", id: ev.id, text: ev.delta, streaming: true });
      } else {
        const p = parts[i] as Extract<Part, { kind: "text" }>;
        parts[i] = { ...p, text: p.text + ev.delta };
      }
      break;
    }

    case "text.end": {
      const i = parts.findIndex((p) => p.kind === "text" && p.id === ev.id);
      if (i !== -1) {
        parts[i] = { ...(parts[i] as Extract<Part, { kind: "text" }>), streaming: false };
      }
      break;
    }

    case "reasoning.start":
      parts.push({ kind: "reasoning", id: ev.id, text: "", streaming: true });
      break;

    case "reasoning.delta": {
      const i = parts.findIndex((p) => p.kind === "reasoning" && p.id === ev.id);
      if (i === -1) {
        parts.push({
          kind: "reasoning",
          id: ev.id,
          text: ev.delta,
          streaming: true,
        });
      } else {
        const p = parts[i] as Extract<Part, { kind: "reasoning" }>;
        parts[i] = { ...p, text: p.text + ev.delta };
      }
      break;
    }

    case "reasoning.end": {
      const i = parts.findIndex((p) => p.kind === "reasoning" && p.id === ev.id);
      if (i !== -1) {
        parts[i] = {
          ...(parts[i] as Extract<Part, { kind: "reasoning" }>),
          streaming: false,
        };
      }
      break;
    }

    case "tool.start":
      if (findTool(ev.toolCallId) === -1) {
        parts.push({
          kind: "tool",
          toolCallId: ev.toolCallId,
          toolName: ev.toolName,
          toolKind: ev.kind,
          title: ev.title,
          state: "input-streaming",
          inputText: "",
        });
      }
      break;

    case "tool.input-delta": {
      const i = findTool(ev.toolCallId);
      if (i !== -1) {
        const p = parts[i] as Extract<Part, { kind: "tool" }>;
        parts[i] = { ...p, inputText: p.inputText + ev.delta };
      }
      break;
    }

    case "tool.input": {
      const i = findTool(ev.toolCallId);
      if (i !== -1) {
        const p = parts[i] as Extract<Part, { kind: "tool" }>;
        parts[i] = { ...p, input: ev.input, state: "input-available" };
      }
      break;
    }

    case "tool.result": {
      const i = findTool(ev.toolCallId);
      if (i !== -1) {
        const p = parts[i] as Extract<Part, { kind: "tool" }>;
        parts[i] = { ...p, output: ev.output, state: "output-available" };
      }
      break;
    }

    case "tool.error": {
      const i = findTool(ev.toolCallId);
      if (i !== -1) {
        const p = parts[i] as Extract<Part, { kind: "tool" }>;
        parts[i] = { ...p, errorText: ev.errorText, state: "output-error" };
      }
      break;
    }

    case "skill.invoked":
      parts.push({
        kind: "skill",
        toolCallId: ev.toolCallId,
        name: ev.skill,
        via: ev.via,
      });
      break;

    case "permission.request": {
      const i = ev.toolCallId ? findTool(ev.toolCallId) : -1;
      if (i !== -1) {
        const p = parts[i] as Extract<Part, { kind: "tool" }>;
        // approval MUST be set at the same moment the state flips — otherwise the
        // approval component renders nothing at all.
        parts[i] = {
          ...p,
          state: "approval-requested",
          approval: { id: ev.requestId },
        };
      }
      break;
    }

    case "permission.resolved": {
      const i = parts.findIndex(
        (p) => p.kind === "tool" && p.approval?.id === ev.requestId,
      );
      if (i !== -1) {
        const p = parts[i] as Extract<Part, { kind: "tool" }>;
        parts[i] = {
          ...p,
          state: "approval-responded",
          approval: {
            id: ev.requestId,
            approved: ev.decision !== "deny" && ev.decision !== "timeout",
          },
        };
      }
      break;
    }

    case "error":
      parts.push({
        kind: "text",
        id: `err${parts.length}`,
        text: `⚠ ${ev.message}`,
        streaming: false,
      });
      break;

    default:
      break;
  }

  return next;
}
