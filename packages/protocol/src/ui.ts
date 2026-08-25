/**
 * Tool and data maps for AI SDK 7's `UIMessage` generics.
 *
 * Kept in this package so web and orchestrator see the same shapes, but WITHOUT a
 * dependency on `ai`: the runner image must not drag the AI SDK along.
 * The reducer itself lives in the web app, where the `ai` types are available.
 */

/** Claude Code's built-in tools, statically typed. */
export type SkillLabUITools = {
  Bash: {
    input: { command: string; description?: string; timeout?: number };
    output: { stdout: string; stderr: string; exitCode: number };
  };
  Read: {
    input: { file_path: string; offset?: number; limit?: number };
    output: { content: string };
  };
  Write: {
    input: { file_path: string; content: string };
    output: { bytes: number };
  };
  Edit: {
    input: { file_path: string; old_string: string; new_string: string };
    output: { patch: string };
  };
  Glob: {
    input: { pattern: string; path?: string };
    output: { files: string[] };
  };
  Grep: {
    input: { pattern: string; glob?: string; path?: string };
    output: { matches: string[] };
  };
  Task: {
    input: { description: string; prompt: string; subagent_type: string };
    output: { result: string };
  };
  TodoWrite: {
    input: { todos: Array<{ content: string; status: string }> };
    output: null;
  };
  Skill: {
    input: { name: string; args?: unknown };
    output: unknown;
  };
};

/** `data-*` parts. Not tool calls — a side channel to the UI. */
export type SkillLabDataParts = {
  "session-init": {
    skills: Array<{ name: string; description: string; allowed: boolean }>;
    slashCommands: string[];
    model: string;
    cwd: string;
  };
  "file-change": {
    path: string;
    op: "create" | "modify" | "delete" | "rename";
    additions?: number;
    deletions?: number;
  };
  skill: {
    name: string;
    via: "model" | "slash-command";
    toolCallId: string;
  };
  finish: { reason: string; totalCostUsd: number; turns: number };
  error: { code: string; message: string };
};

export type SkillLabMessageMetadata = {
  costUsd?: number;
  model?: string;
  turns?: number;
};

/** Is the tool name statically typed, or does it travel as a `dynamic-tool` part? */
const STATIC_TOOLS = new Set<string>([
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Task",
  "TodoWrite",
  "Skill",
]);

export function isStaticTool(toolName: string): boolean {
  return STATIC_TOOLS.has(toolName);
}

/**
 * Normalise a raw SDK tool name into the kind the UI selects a component from.
 * Name comparison happens here and nowhere else.
 */
export function toolKindOf(toolName: string) {
  switch (toolName) {
    case "Bash":
      return "bash" as const;
    case "Read":
      return "read" as const;
    case "Write":
      return "write" as const;
    case "Edit":
    case "MultiEdit":
      return "edit" as const;
    case "Glob":
      return "glob" as const;
    case "Grep":
      return "grep" as const;
    case "Task":
      return "task" as const;
    case "Skill":
      return "skill" as const;
    case "TodoWrite":
      return "todo" as const;
    case "WebSearch":
    case "WebFetch":
      return "web" as const;
    default:
      return toolName.startsWith("mcp__") ? ("mcp" as const) : ("other" as const);
  }
}
