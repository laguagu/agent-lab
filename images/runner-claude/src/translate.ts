/**
 * Claude Agent SDK message stream -> RunnerEvent.
 *
 * This is the only file in the project allowed to read Claude-specific shapes.
 * Everything else — orchestrator, UI, components — sees only @agent-lab/protocol types.
 * Adding another engine means writing another file like this and touching nothing else.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  DiscoveredSkill,
  PermissionMode,
  RunnerEventBody,
  ToolKind,
} from "@agent-lab/protocol";
import { toolKindOf } from "@agent-lab/protocol";

type ToolState = { name: string; filePath?: string };

/** What this engine supports. The UI hides whatever is missing. */
const CAPABILITIES = {
  pty: true,
  fileWatch: true,
  permissionPrompts: true,
  resume: true,
  checkpoints: false,
  budgetCap: true,
  skillDiscovery: 'filesystem',
} as const;

export class Translator {
  #tools = new Map<string, ToolState>();
  #blockIndexToToolId = new Map<number, string>();
  #openText = new Set<string>();
  #openReasoning = new Set<string>();
  #cumulativeCostUsd = 0;
  #initEmitted = false;

  /**
   * Builds session.init from control-channel data.
   *
   * In streaming-input mode system/init never reaches the stream before the first turn,
   * so the UI would get the skill list far too late. The control channel gives the same
   * data immediately — plus skill descriptions for free.
   */
  initFromControl(input: {
    agentSessionId: string;
    model: string;
    cwd: string;
    permissionMode: PermissionMode;
    skills: Array<{ name: string; description: string }>;
    slashCommands: string[];
    tools: string[];
    repoUrl?: string;
  }): RunnerEventBody[] {
    if (this.#initEmitted) return [];
    this.#initEmitted = true;

    return [
      {
        type: "session.init",
        runner: "claude-container",
        capabilities: CAPABILITIES,
        agentSessionId: input.agentSessionId,
        model: input.model,
        cwd: input.cwd,
        skills: input.skills.map((s) => ({
          name: s.name,
          description: s.description,
          source: "user" as const,
          path: `~/.claude/skills/${s.name}`,
          allowed: true,
        })),
        slashCommands: input.slashCommands,
        tools: input.tools,
        permissionMode: input.permissionMode,
        ...(input.repoUrl ? { repoUrl: input.repoUrl } : {}),
      },
      { type: "session.status", status: "ready" },
    ];
  }

  /** Returns zero or more events. The caller frames them. */
  translate(msg: SDKMessage): RunnerEventBody[] {
    switch (msg.type) {
      case "system":
        return this.#system(msg);
      case "stream_event":
        return this.#streamEvent(msg);
      case "assistant":
        return this.#assistant(msg);
      case "user":
        return this.#user(msg);
      case "result":
        return this.#result(msg);
      default:
        return [];
    }
  }

  #system(msg: Extract<SDKMessage, { type: "system" }>): RunnerEventBody[] {
    if (msg.subtype !== "init") return [];
    // Init was already sent from the control channel — no duplicate for the UI.
    if (this.#initEmitted) return [];
    this.#initEmitted = true;
    const init = msg as Extract<
      SDKMessage,
      { type: "system"; subtype: "init" }
    >;

    const skills: DiscoveredSkill[] = (init.skills ?? []).map((name) => ({
      name,
      description: "",
      source: "user",
      path: `~/.claude/skills/${name}`,
      allowed: true,
    }));

    return [
      {
        type: "session.init",
        runner: "claude-container",
        capabilities: CAPABILITIES,
        agentSessionId: init.session_id,
        model: init.model,
        cwd: init.cwd,
        skills,
        slashCommands: init.slash_commands ?? [],
        tools: init.tools ?? [],
        permissionMode: normalizeMode(init.permissionMode),
      },
      { type: "session.status", status: "ready" },
    ];
  }

  /** Partial messages carry the deltas. Requires includePartialMessages: true. */
  #streamEvent(
    msg: Extract<SDKMessage, { type: "stream_event" }>,
  ): RunnerEventBody[] {
    const ev = msg.event as {
      type: string;
      index?: number;
      content_block?: { type: string; id?: string; name?: string };
      delta?: {
        type: string;
        text?: string;
        thinking?: string;
        partial_json?: string;
      };
    };

    if (ev.type === "content_block_start") {
      const idx = ev.index ?? 0;
      const block = ev.content_block;
      if (!block) return [];

      if (block.type === "text") {
        const id = `t${idx}`;
        this.#openText.add(id);
        return [{ type: "text.start", id }];
      }
      if (block.type === "thinking" || block.type === "redacted_thinking") {
        const id = `r${idx}`;
        this.#openReasoning.add(id);
        return [{ type: "reasoning.start", id }];
      }
      if (block.type === "tool_use" && block.id && block.name) {
        this.#blockIndexToToolId.set(idx, block.id);
        this.#tools.set(block.id, { name: block.name });
        return [
          {
            type: "tool.start",
            toolCallId: block.id,
            toolName: block.name,
            kind: toolKindOf(block.name) as ToolKind,
          },
        ];
      }
      return [];
    }

    if (ev.type === "content_block_delta") {
      const idx = ev.index ?? 0;
      const d = ev.delta;
      if (!d) return [];

      if (d.type === "text_delta" && d.text) {
        return [{ type: "text.delta", id: `t${idx}`, delta: d.text }];
      }
      if (d.type === "thinking_delta" && d.thinking) {
        return [{ type: "reasoning.delta", id: `r${idx}`, delta: d.thinking }];
      }
      if (d.type === "input_json_delta" && d.partial_json !== undefined) {
        const toolCallId = this.#blockIndexToToolId.get(idx);
        if (!toolCallId) return [];
        return [
          { type: "tool.input-delta", toolCallId, delta: d.partial_json },
        ];
      }
      return [];
    }

    if (ev.type === "content_block_stop") {
      const idx = ev.index ?? 0;
      const out: RunnerEventBody[] = [];
      const tId = `t${idx}`;
      const rId = `r${idx}`;
      if (this.#openText.delete(tId)) out.push({ type: "text.end", id: tId });
      if (this.#openReasoning.delete(rId)) {
        out.push({ type: "reasoning.end", id: rId });
      }
      return out;
    }

    return [];
  }

  /**
   * The full assistant message finalises tool inputs. Without partial messages,
   * tool.start is born here instead.
   */
  #assistant(
    msg: Extract<SDKMessage, { type: "assistant" }>,
  ): RunnerEventBody[] {
    const out: RunnerEventBody[] = [];
    const blocks = (msg.message?.content ?? []) as Array<{
      type: string;
      id?: string;
      name?: string;
      input?: unknown;
    }>;

    for (const b of blocks) {
      if (b.type !== "tool_use" || !b.id || !b.name) continue;

      if (!this.#tools.has(b.id)) {
        this.#tools.set(b.id, { name: b.name });
        out.push({
          type: "tool.start",
          toolCallId: b.id,
          toolName: b.name,
          kind: toolKindOf(b.name) as ToolKind,
          title: titleFor(b.name, b.input),
        });
      }

      const fp = (b.input as { file_path?: unknown } | undefined)?.file_path;
      if (typeof fp === 'string') {
        this.#tools.set(b.id, { name: b.name, filePath: fp });
      }

      out.push({ type: "tool.input", toolCallId: b.id, input: b.input ?? {} });

      if (b.name === "Skill") {
        const input = b.input as { name?: string; command?: string } | undefined;
        out.push({
          type: "skill.invoked",
          toolCallId: b.id,
          skill: input?.name ?? input?.command ?? "unknown",
          via: "model",
          args: b.input,
        });
      }
    }
    return out;
  }

  /** Tool results arrive as user-role messages. */
  #user(msg: Extract<SDKMessage, { type: "user" }>): RunnerEventBody[] {
    const out: RunnerEventBody[] = [];
    const content = (msg.message as { content?: unknown })?.content;
    if (!Array.isArray(content)) return out;

    for (const b of content as Array<{
      type: string;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    }>) {
      if (b.type !== "tool_result" || !b.tool_use_id) continue;

      const tool = this.#tools.get(b.tool_use_id);
      const text = flattenResult(b.content);

      if (b.is_error) {
        out.push({
          type: "tool.error",
          toolCallId: b.tool_use_id,
          errorText: text,
        });
        continue;
      }

      out.push({
        type: "tool.result",
        toolCallId: b.tool_use_id,
        output: text,
      });

      // Writing tools change the workspace. The path travels along so the UI can refresh
      // exactly the file the user has open — not just the whole tree.
      if (tool && WRITING_TOOLS.has(tool.name)) {
        const path = tool.filePath ? toWorkspaceRelative(tool.filePath) : undefined;
        out.push(
          path
            ? { type: "file.changed", path, op: "modify", toolCallId: b.tool_use_id }
            : { type: "file.tree-invalidated", root: "." },
        );
        // The tree may still change (a new file), so invalidate it regardless.
        if (path) out.push({ type: "file.tree-invalidated", root: "." });
      }
    }
    return out;
  }

  #result(msg: Extract<SDKMessage, { type: "result" }>): RunnerEventBody[] {
    const cost = (msg as { total_cost_usd?: number }).total_cost_usd ?? 0;
    this.#cumulativeCostUsd = cost;

    const usage = ((msg as unknown) as { usage?: Record<string, number> }).usage ?? {};
    const turns = (msg as { num_turns?: number }).num_turns ?? 0;
    const durationMs = (msg as { duration_ms?: number }).duration_ms ?? 0;

    return [
      {
        type: "usage",
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens,
        cumulativeCostUsd: this.#cumulativeCostUsd,
      },
      {
        type: "finish",
        reason:
          msg.subtype === "success"
            ? "end_turn"
            : msg.subtype === "error_max_turns"
              ? "max_turns"
              : "error",
        turns,
        durationMs,
        totalCostUsd: cost,
      },
      { type: "session.status", status: "awaiting-input" },
    ];
  }
}

const WRITING_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** /workspace/app/page.tsx -> app/page.tsx */
function toWorkspaceRelative(p: string): string {
  return p.replace(/^\/workspace\/?/, "").split("\\").join("/");
}

function normalizeMode(mode: string): PermissionMode {
  switch (mode) {
    case "acceptEdits":
    case "plan":
    case "bypassPermissions":
      return mode;
    default:
      return "default";
  }
}

/** A short human-readable line for a tool call, e.g. "Read app/page.tsx". */
function titleFor(name: string, input: unknown): string | undefined {
  const i = input as Record<string, unknown> | undefined;
  if (!i) return undefined;
  if (typeof i.file_path === "string") return `${name} ${i.file_path}`;
  if (typeof i.command === "string") return i.command.slice(0, 80);
  if (typeof i.pattern === "string") return `${name} ${i.pattern}`;
  return undefined;
}

function flattenResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => {
      if (typeof c === "string") return c;
      const t = (c as { text?: unknown })?.text;
      return typeof t === "string" ? t : "";
    })
    .join("");
}
