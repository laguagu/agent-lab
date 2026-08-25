/**
 * Commands travelling from the browser to the runner.
 *
 * The duplex is deliberate: one channel carries the prompt, the permission reply, the
 * file operation and the terminal keystroke. That is why we do not use the AI SDK's
 * `useChat` — its SSE protocol is half-duplex and carries none of them.
 */

import type { PermissionMode } from "./events.ts";

export type Attachment = {
  name: string;
  mediaType: string;
  /** base64 without the data: prefix */
  data: string;
};

export type RunnerCommand =
  // --- turn ---
  | { type: "prompt"; text: string; attachments?: Attachment[] }
  /** Interrupt the running turn, keep the session. */
  | { type: "interrupt" }
  /** Tear the session down entirely. */
  | { type: "stop" }

  // --- settings mid-session ---
  | { type: "set-mode"; permissionMode: PermissionMode }
  | { type: "set-model"; model: string }
  | { type: "set-skills"; skills: "all" | string[] }

  // --- permissions ---
  | {
      type: "permission.respond";
      requestId: string;
      decision: "allow" | "deny" | "allow-always";
      updatedInput?: unknown;
    }

  // --- files (the reply arrives as a `result` event with the same requestId) ---
  | { type: "fs.list"; requestId: string; path: string; depth?: number }
  | { type: "fs.read"; requestId: string; path: string }
  | { type: "fs.write"; requestId: string; path: string; content: string }
  | { type: "fs.delete"; requestId: string; path: string }
  | {
      type: "fs.diff";
      requestId: string;
      path: string;
      against?: "head" | "checkpoint";
    }

  // --- terminal ---
  | { type: "pty.open"; ptyId: string; cols: number; rows: number; shell?: string }
  | { type: "pty.input"; ptyId: string; data: string }
  | { type: "pty.resize"; ptyId: string; cols: number; rows: number }
  | { type: "pty.close"; ptyId: string }

  | { type: "ping" };

/** What the orchestrator tells the runner when a session begins. */
export type SessionSpec = {
  sessionId: string;
  model: string;
  permissionMode: PermissionMode;
  skills: "all" | string[];
  maxTurns: number;
  maxBudgetUsd: number;
  cwd: string;
  /**
   * Public git URL cloned into the workspace before the agent starts.
   * Without it the workspace is empty and the agent has nothing to edit.
   */
  repoUrl?: string;
  /** The previous session's `agentSessionId`, when resuming. */
  resume?: string;
  systemPromptAppend?: string;
};

/** A file tree node, the reply to `fs.list`. */
export type FsNode = {
  name: string;
  path: string;
  kind: "file" | "dir";
  size?: number;
  children?: FsNode[];
};
