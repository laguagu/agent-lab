/**
 * A Claude Agent SDK session in streaming-input mode.
 *
 * Why streaming input rather than query() per turn: one query() call per turn costs about
 * 12 seconds of startup overhead, because the SDK spawns a fresh claude subprocess each
 * time. A long-lived session pays that once.
 */

import { query, type Options, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionMode, SessionSpec } from "@skill-lab/protocol";

/** Queue feeding the user's turns into a live session. */
class PromptQueue implements AsyncIterable<SDKUserMessage> {
  #pending: SDKUserMessage[] = [];
  #resolve: ((v: IteratorResult<SDKUserMessage>) => void) | null = null;
  #closed = false;

  push(text: string) {
    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: "",
    };
    if (this.#resolve) {
      const r = this.#resolve;
      this.#resolve = null;
      r({ value: msg, done: false });
      return;
    }
    this.#pending.push(msg);
  }

  close() {
    this.#closed = true;
    if (this.#resolve) {
      const r = this.#resolve;
      this.#resolve = null;
      r({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const queued = this.#pending.shift();
        if (queued) return Promise.resolve({ value: queued, done: false });
        if (this.#closed) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise((resolve) => {
          this.#resolve = resolve;
        });
      },
    };
  }
}

/** Session data from the control channel, before the first turn. */
export type WarmupInfo = {
  skills: Array<{ name: string; description: string }>;
  slashCommands: string[];
  models: string[];
};

export type AgentSession = {
  /** Message stream. The caller translates these into RunnerEvents. */
  messages: Query;
  /**
   * Starts the claude subprocess and collects session data from the control channel.
   *
   * In streaming-input mode `system/init` does NOT reach the message stream before the
   * first real turn — verified experimentally. The UI still has to show the discovered
   * skills the moment a session opens, so the data comes off the control channel:
   * `initializationResult()` gives models and commands, `reloadSkills()` gives skills
   * with descriptions (better than system/init, which carries names only).
   */
  warmup(): Promise<WarmupInfo>;
  prompt(text: string): void;
  interrupt(): Promise<void>;
  close(): void;
};

export function startAgent(spec: SessionSpec): AgentSession {
  const queue = new PromptQueue();

  const options: Options = {
    cwd: spec.cwd,

    // Skills are found ONLY on the filesystem. "user" covers ~/.claude/skills/, where
    // the entrypoint symlinks the /skills mount. "project" covers /workspace/.claude/skills/.
    settingSources: ["user", "project"],
    skills: spec.skills,

    model: spec.model,
    maxTurns: spec.maxTurns,
    maxBudgetUsd: spec.maxBudgetUsd,
    permissionMode: spec.permissionMode,

    // bypassPermissions is rejected without this flag.
    allowDangerouslySkipPermissions: spec.permissionMode === "bypassPermissions",

    // Deltas for text, reasoning and tool inputs.
    includePartialMessages: true,

    // CRITICAL: in the TypeScript SDK env REPLACES the subprocess environment, it does
    // not merge. Without the spread, PATH disappears and the bundled binary never starts.
    env: {
      ...process.env,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    },

    ...(spec.resume ? { resume: spec.resume } : {}),
    ...(spec.systemPromptAppend
      ? {
          systemPrompt: {
            type: "preset" as const,
            preset: "claude_code" as const,
            append: spec.systemPromptAppend,
          },
        }
      : {}),
  };

  const messages = query({ prompt: queue, options });

  return {
    messages,
    warmup: async () => {
      const init = await messages.initializationResult();
      // reloadSkills() is the only API that returns skills with their descriptions.
      const reloaded = await messages
        .reloadSkills()
        .catch(() => ({ skills: [] as Array<{ name: string; description: string }> }));
      return {
        skills: (reloaded.skills ?? []).map((s) => ({
          name: s.name,
          description: s.description ?? '',
        })),
        slashCommands: (init.commands ?? []).map((c) => c.name),
        models: (init.models ?? []).map((m) => m.resolvedModel ?? m.value),
      };
    },
    prompt: (text) => queue.push(text),
    interrupt: async () => {
      await messages.interrupt();
    },
    close: () => queue.close(),
  };
}

export function isValidMode(mode: string): mode is PermissionMode {
  return ["default", "acceptEdits", "plan", "bypassPermissions"].includes(mode);
}
