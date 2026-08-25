/**
 * Events travelling from the runner to the browser.
 *
 * This union is the project's contract. Everything the UI knows about the agent comes
 * from it. Engine specifics (Claude Agent SDK, OpenAI Agents SDK, a harness) may live
 * only in the translator that produces these — never in the UI.
 *
 * `seq` is monotonic per session: a reconnect uses it to spot gaps and ask for a
 * resend (`?since=<seq>`).
 */

export type RunnerKind = "claude-container" | "openai-host" | "harness";

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "bypassPermissions";

/** What the running engine can do. The UI degrades from this rather than guessing. */
export type RunnerCapabilities = {
  /** The terminal tab renders only when this is true. */
  pty: boolean;
  fileWatch: boolean;
  permissionPrompts: boolean;
  resume: boolean;
  checkpoints: boolean;
  budgetCap: boolean;
  skillDiscovery: "filesystem" | "inline" | "lazy-index";
};

export type DiscoveredSkill = {
  name: string;
  description: string;
  source: "user" | "project" | "plugin" | "additional-dir";
  /** Absolute path inside the container. */
  path: string;
  /** Whether the skill is on this session's allowlist. */
  allowed: boolean;
};

/**
 * Coarse tool kind. The translator normalises the raw SDK name into this, and the UI
 * picks a component from it — never by string-matching the name.
 */
export type ToolKind =
  | "read"
  | "write"
  | "edit"
  | "bash"
  | "glob"
  | "grep"
  | "task"
  | "skill"
  | "todo"
  | "web"
  | "mcp"
  | "other";

export type FileChangeOp = "create" | "modify" | "delete" | "rename";

export type SessionStatus =
  | "starting"
  | "ready"
  | "thinking"
  | "awaiting-input"
  | "awaiting-permission"
  | "done"
  | "error"
  | "stopped";

export type FinishReason =
  | "end_turn"
  | "max_turns"
  | "budget_exceeded"
  | "stopped"
  | "error";

export type RunnerErrorCode =
  | "model_error"
  | "sandbox_error"
  | "container_oom"
  | "container_exit"
  | "protocol_error"
  | "budget_exceeded"
  | "timeout"
  | "unknown";

export type RunnerEventBody =
  // --- session ---
  | {
      type: "session.init";
      runner: RunnerKind;
      capabilities: RunnerCapabilities;
      /** The engine's own session id. Needed for resume. */
      agentSessionId: string;
      model: string;
      cwd: string;
      skills: DiscoveredSkill[];
      slashCommands: string[];
      tools: string[];
      permissionMode: PermissionMode;
      /** Repo cloned into the workspace, if one was given. */
      repoUrl?: string;
      resumedFrom?: string;
    }
  | { type: "session.status"; status: SessionStatus; detail?: string }

  // --- text and reasoning ---
  | { type: "text.start"; id: string }
  | { type: "text.delta"; id: string; delta: string }
  | { type: "text.end"; id: string }
  | { type: "reasoning.start"; id: string }
  | { type: "reasoning.delta"; id: string; delta: string }
  | { type: "reasoning.end"; id: string }

  // --- tools ---
  | {
      type: "tool.start";
      toolCallId: string;
      /** Raw SDK name, e.g. "Bash" or "mcp__github__list_issues". */
      toolName: string;
      kind: ToolKind;
      /** Human-readable line, e.g. "Read app/page.tsx". */
      title?: string;
    }
  | { type: "tool.input-delta"; toolCallId: string; delta: string }
  | { type: "tool.input"; toolCallId: string; input: unknown }
  | {
      type: "tool.result";
      toolCallId: string;
      output: unknown;
      durationMs?: number;
      truncated?: boolean;
    }
  | { type: "tool.error"; toolCallId: string; errorText: string }
  | {
      type: "skill.invoked";
      toolCallId: string;
      skill: string;
      via: "model" | "slash-command";
      args?: unknown;
    }

  // --- files ---
  | {
      type: "file.changed";
      /** Posix path relative to the workspace. */
      path: string;
      op: FileChangeOp;
      from?: string;
      toolCallId?: string;
      additions?: number;
      deletions?: number;
    }
  | { type: "file.tree-invalidated"; root: string }

  // --- permissions ---
  | {
      type: "permission.request";
      requestId: string;
      toolCallId?: string;
      toolName: string;
      input: unknown;
      reason?: string;
      expiresAt?: number;
    }
  | {
      type: "permission.resolved";
      requestId: string;
      decision: "allow" | "deny" | "allow-always" | "timeout";
      updatedInput?: unknown;
    }

  // --- terminal ---
  | { type: "pty.output"; ptyId: string; data: string }
  | { type: "pty.exit"; ptyId: string; exitCode: number }

  // --- request/response ---
  | {
      type: "result";
      requestId: string;
      ok: boolean;
      data?: unknown;
      error?: { code: string; message: string };
    }

  // --- completion ---
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      costUsd?: number;
      cumulativeCostUsd: number;
    }
  | {
      type: "finish";
      reason: FinishReason;
      turns: number;
      durationMs: number;
      totalCostUsd: number;
    }
  | {
      type: "error";
      code: RunnerErrorCode;
      message: string;
      retryable: boolean;
      detail?: unknown;
    };

export type RunnerEvent = RunnerEventBody & {
  seq: number;
  sessionId: string;
  ts: number;
};

/** Narrow helper for translators: adds frame metadata to a body. */
export function frame(
  body: RunnerEventBody,
  sessionId: string,
  seq: number,
): RunnerEvent {
  return { ...body, sessionId, seq, ts: Date.now() };
}
