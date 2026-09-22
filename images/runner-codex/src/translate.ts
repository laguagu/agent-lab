/**
 * Codex thread events -> RunnerEvent.
 *
 * This is the only file in the codex-container track allowed to read Codex-specific
 * shapes, the counterpart of runner-claude/src/translate.ts.
 *
 * Codex reports work as *items* with a lifecycle (started -> updated -> completed)
 * rather than as content blocks with deltas. Two consequences for the UI:
 *
 * - Text arrives whole. `codex exec` emits an agent message when it is complete, so a
 *   Codex answer appears at once instead of streaming. The delta logic below still
 *   handles `item.updated` in case a later release starts sending partial text.
 * - Files change through two routes: `file_change` items (apply_patch) carry the paths,
 *   while a shell command that writes a file says nothing. Every finished command
 *   therefore invalidates the tree.
 */

import type { ThreadEvent, ThreadItem, Usage } from "@openai/codex-sdk";
import type {
  FileChangeOp,
  PermissionMode,
  RunnerEventBody,
} from "@agent-lab/protocol";
import type { SkillInfo } from "./skills.ts";

/** What this engine supports. The UI hides whatever is missing. */
const CAPABILITIES = {
  pty: true,
  fileWatch: true,
  // `codex exec` has no channel to ask for approval; the sandbox mode decides instead.
  permissionPrompts: false,
  // Threads persist in the session's $CODEX_HOME volume, but nothing resumes them yet.
  resume: false,
  checkpoints: false,
  // Codex has no spend ceiling, and a ChatGPT login reports no cost at all.
  budgetCap: false,
  skillDiscovery: "filesystem",
} as const;

type EventOf<T extends ThreadEvent["type"]> = Extract<ThreadEvent, { type: T }>;

export class Translator {
  /** Emitted text length per streaming item, so an update yields only the new suffix. */
  #streamed = new Map<string, number>();
  #toolsStarted = new Set<string>();
  #turns = 0;
  #turnStartedAt = 0;
  #turnOpen = false;
  #pendingError: string | null = null;

  init(input: {
    agentSessionId: string;
    model: string;
    cwd: string;
    permissionMode: PermissionMode;
    sandboxMode: string;
    skills: SkillInfo[];
    repoUrl?: string;
  }): RunnerEventBody[] {
    return [
      {
        type: "session.init",
        runner: "codex-container",
        capabilities: CAPABILITIES,
        agentSessionId: input.agentSessionId,
        model: input.model,
        cwd: input.cwd,
        skills: input.skills.map((s) => ({
          name: s.name,
          description: s.description,
          source: "user" as const,
          path: s.path,
          allowed: true,
        })),
        // Codex skills are invoked by the model or by `$name` in the prompt; there are
        // no slash commands in exec mode.
        slashCommands: [],
        tools: ["shell", "apply_patch", "web_search", "update_plan"],
        permissionMode: input.permissionMode,
        ...(input.repoUrl ? { repoUrl: input.repoUrl } : {}),
      },
      {
        type: "session.status",
        status: "ready",
        detail: `codex sandbox: ${input.sandboxMode}`,
      },
    ];
  }

  /** Called by the runner before each turn, whatever the engine then reports. */
  beginTurn() {
    this.#turns += 1;
    this.#turnStartedAt = Date.now();
    this.#turnOpen = true;
    this.#pendingError = null;
  }

  /** True until the turn has produced its `finish`. */
  get turnOpen() {
    return this.#turnOpen;
  }

  translate(ev: ThreadEvent): RunnerEventBody[] {
    switch (ev.type) {
      case "item.started":
      case "item.updated":
      case "item.completed":
        return this.#item(ev.type, ev.item);
      case "turn.completed":
        return this.#completed(ev);
      case "turn.failed":
        return this.fail(ev.error.message);
      case "error":
        // The stream's fatal error precedes `turn.failed` with the same message, and
        // sometimes arrives alone before the process exits. Hold it; whichever closes
        // the turn reports it once.
        this.#pendingError = ev.message;
        return [];
      default:
        return [];
    }
  }

  /** The turn failed: from `turn.failed`, or from the SDK throwing when codex exited. */
  fail(message: string): RunnerEventBody[] {
    if (!this.#turnOpen) return [];
    this.#turnOpen = false;
    return [
      {
        type: "error",
        code: "model_error",
        message: this.#pendingError ?? message,
        retryable: true,
      },
      this.#finish("error"),
      { type: "session.status", status: "awaiting-input" },
    ];
  }

  /** The user interrupted: the SDK killed the process on abort. */
  stopped(): RunnerEventBody[] {
    if (!this.#turnOpen) return [];
    this.#turnOpen = false;
    return [this.#finish("stopped"), { type: "session.status", status: "awaiting-input" }];
  }

  #completed(ev: EventOf<"turn.completed">): RunnerEventBody[] {
    if (!this.#turnOpen) return [];
    this.#turnOpen = false;
    return [
      usageEvent(ev.usage),
      this.#finish("end_turn"),
      { type: "session.status", status: "awaiting-input" },
    ];
  }

  #finish(reason: "end_turn" | "error" | "stopped"): RunnerEventBody {
    return {
      type: "finish",
      reason,
      turns: this.#turns,
      durationMs: Date.now() - this.#turnStartedAt,
      totalCostUsd: 0,
    };
  }

  #item(
    phase: "item.started" | "item.updated" | "item.completed",
    item: ThreadItem,
  ): RunnerEventBody[] {
    const done = phase === "item.completed";
    switch (item.type) {
      case "agent_message":
        return this.#stream("text", item.id, item.text, done);
      case "reasoning":
        return this.#stream("reasoning", item.id, item.text, done);

      case "command_execution": {
        const out = this.#startTool(item.id, "shell", "bash", unwrapShell(item.command), {
          command: item.command,
        });
        if (!done) return out;
        const ok = item.status === "completed" && (item.exit_code ?? 0) === 0;
        out.push(
          ok
            ? { type: "tool.result", toolCallId: item.id, output: item.aggregated_output }
            : {
                type: "tool.error",
                toolCallId: item.id,
                errorText: `${item.aggregated_output}\n[exit ${item.exit_code ?? "?"}]`.trim(),
              },
          // A command can create or delete files without saying so.
          { type: "file.tree-invalidated", root: "." },
        );
        return out;
      }

      case "file_change": {
        const paths = item.changes.map((c) => toWorkspaceRelative(c.path));
        const out = this.#startTool(item.id, "apply_patch", "edit", paths.join(", "), {
          changes: item.changes.map((c, i) => ({ path: paths[i], kind: c.kind })),
        });
        if (!done) return out;
        if (item.status === "failed") {
          out.push({ type: "tool.error", toolCallId: item.id, errorText: "patch failed" });
          return out;
        }
        out.push({
          type: "tool.result",
          toolCallId: item.id,
          output: item.changes.map((c, i) => `${c.kind} ${paths[i]}`).join("\n"),
        });
        item.changes.forEach((c, i) =>
          out.push({
            type: "file.changed",
            path: paths[i],
            op: CHANGE_OP[c.kind],
            toolCallId: item.id,
          }),
        );
        out.push({ type: "file.tree-invalidated", root: "." });
        return out;
      }

      case "mcp_tool_call": {
        const out = this.#startTool(
          item.id,
          `mcp__${item.server}__${item.tool}`,
          "mcp",
          undefined,
          item.arguments,
        );
        if (!done) return out;
        out.push(
          item.status === "failed" || item.error
            ? {
                type: "tool.error",
                toolCallId: item.id,
                errorText: item.error?.message ?? "MCP call failed",
              }
            : {
                type: "tool.result",
                toolCallId: item.id,
                output: (item.result?.content ?? [])
                  .map((c) => ("text" in c && typeof c.text === "string" ? c.text : ""))
                  .join(""),
              },
        );
        return out;
      }

      case "web_search": {
        const out = this.#startTool(item.id, "web_search", "web", item.query, {
          query: item.query,
        });
        if (done) out.push({ type: "tool.result", toolCallId: item.id, output: "" });
        return out;
      }

      case "todo_list": {
        const out = this.#startTool(item.id, "update_plan", "todo", undefined, undefined);
        out.push({ type: "tool.input", toolCallId: item.id, input: { todos: item.items } });
        if (done) {
          out.push({
            type: "tool.result",
            toolCallId: item.id,
            output: item.items.map((t) => `[${t.completed ? "x" : " "}] ${t.text}`).join("\n"),
          });
        }
        return out;
      }

      case "error":
        // Non-fatal, e.g. "skill descriptions were shortened". Worth seeing, not a failure.
        return done ? [{ type: "session.status", status: "thinking", detail: item.message }] : [];

      default:
        return [];
    }
  }

  /** tool.start + tool.input the first time an item is seen, nothing afterwards. */
  #startTool(
    id: string,
    toolName: string,
    kind: Extract<RunnerEventBody, { type: "tool.start" }>["kind"],
    title: string | undefined,
    input: unknown,
  ): RunnerEventBody[] {
    if (this.#toolsStarted.has(id)) return [];
    this.#toolsStarted.add(id);
    const out: RunnerEventBody[] = [
      { type: "tool.start", toolCallId: id, toolName, kind, ...(title ? { title } : {}) },
    ];
    if (input !== undefined) out.push({ type: "tool.input", toolCallId: id, input });
    return out;
  }

  /** Text or reasoning: start on first sight, the new suffix as a delta, end on completion. */
  #stream(
    kind: "text" | "reasoning",
    id: string,
    text: string,
    done: boolean,
  ): RunnerEventBody[] {
    const out: RunnerEventBody[] = [];
    const seen = this.#streamed.get(id);
    if (seen === undefined) {
      // An empty reasoning summary is not drawn anyway; do not open a part for it.
      if (done && !text.trim()) return out;
      out.push({ type: `${kind}.start`, id });
    }
    const from = seen ?? 0;
    if (text.length > from) {
      out.push({ type: `${kind}.delta`, id, delta: text.slice(from) });
    }
    this.#streamed.set(id, Math.max(from, text.length));
    if (done) out.push({ type: `${kind}.end`, id });
    return out;
  }
}

const CHANGE_OP: Record<"add" | "delete" | "update", FileChangeOp> = {
  add: "create",
  delete: "delete",
  update: "modify",
};

function usageEvent(u: Usage): RunnerEventBody {
  return {
    type: "usage",
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cached_input_tokens,
    cacheCreationTokens: u.cache_write_input_tokens,
    cumulativeCostUsd: 0,
  };
}

/** /workspace/src/a.ts -> src/a.ts */
function toWorkspaceRelative(p: string): string {
  return p.replace(/^\/workspace\/?/, "").split("\\").join("/");
}

/** Codex wraps every command in `bash -lc '...'`; the title shows what actually ran. */
function unwrapShell(command: string): string {
  const m = command.match(/^(?:\/\S+\/)?(?:ba)?sh -l?c (['"])([\s\S]*)\1$/);
  return (m ? m[2] : command).slice(0, 80);
}
