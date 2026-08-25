"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Brain,
  Check,
  ChevronRight,
  FileDiff,
  FilePen,
  FilePlus,
  FileSearch,
  Globe,
  ListChecks,
  Search,
  Sparkles,
  SquareTerminal,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ToolKind } from "@skill-lab/protocol";
import type { Part, Turn } from "@/lib/use-runner-session";
import { cn } from "@/lib/cn";
import { Response } from "./response";

/** One icon per tool kind, from one family. The name tells the rest. */
const TOOL_ICON: Record<ToolKind, LucideIcon> = {
  read: FileSearch,
  write: FilePlus,
  edit: FilePen,
  bash: SquareTerminal,
  glob: Search,
  grep: Search,
  task: Users,
  skill: Sparkles,
  todo: ListChecks,
  web: Globe,
  mcp: FileDiff,
  other: ChevronRight,
};

export function Conversation({
  turns,
  onPermission,
}: {
  turns: Turn[];
  onPermission: (requestId: string, decision: "allow" | "deny") => void;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  // Scroll down only when the user is already at the bottom, so reading is not broken.
  useEffect(() => {
    if (pinned) bottom.current?.scrollIntoView({ block: "end" });
  }, [turns, pinned]);

  return (
    <div
      onScroll={(e) => {
        const el = e.currentTarget;
        setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
      }}
      className="flex-1 overflow-y-auto px-5 py-5"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {turns.map((turn) => (
          <article key={turn.id} className="flex flex-col gap-2">
            {turn.role === "user" ? (
              <UserTurn turn={turn} />
            ) : (
              <AnimatePresence initial={false}>
                {turn.parts
                  .filter(isRenderable)
                  .map((part, i) => (
                    <PartView
                      key={partKey(part, i)}
                      part={part}
                      onPermission={onPermission}
                    />
                  ))}
              </AnimatePresence>
            )}
          </article>
        ))}
        <div ref={bottom} />
      </div>
    </div>
  );
}

/**
 * An empty reasoning block is just a box with nothing in it. The model can emit
 * redacted_thinking blocks carrying no text at all, and those must not be drawn.
 */
function isRenderable(part: Part): boolean {
  if (part.kind === "reasoning") return part.text.trim().length > 0;
  if (part.kind === "text") return part.text.trim().length > 0 || part.streaming;
  return true;
}

function partKey(part: Part, i: number) {
  if (part.kind === "tool" || part.kind === "skill") return part.toolCallId + i;
  return part.id + i;
}

function UserTurn({ turn }: { turn: Turn }) {
  const text = turn.parts.map((p) => ("text" in p ? p.text : "")).join("");
  return (
    <div className="self-end rounded-xl rounded-br-sm bg-raised px-3.5 py-2 whitespace-pre-wrap">
      {text}
    </div>
  );
}

/** Entry conveys order: a new step slides up from below. */
function Enter({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

function PartView({
  part,
  onPermission,
}: {
  part: Part;
  onPermission: (requestId: string, decision: "allow" | "deny") => void;
}) {
  if (part.kind === "text") {
    return (
      <Enter>
        <div className={cn(part.streaming && "streaming")}>
          <Response>{part.text}</Response>
        </div>
      </Enter>
    );
  }

  if (part.kind === "reasoning") {
    return (
      <Enter>
        <Reasoning text={part.text} streaming={part.streaming} />
      </Enter>
    );
  }

  if (part.kind === "skill") {
    return (
      <Enter>
        <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/8 px-3 py-1.5">
          <Sparkles className="size-3.5 shrink-0 text-accent" aria-hidden />
          <span className="font-mono text-accent">/{part.name}</span>
          <span className="text-muted">
            {part.via === "slash-command" ? "invoked" : "chosen by the model"}
          </span>
        </div>
      </Enter>
    );
  }

  return (
    <Enter>
      <ToolPart part={part} onPermission={onPermission} />
    </Enter>
  );
}

function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  // Open while streaming, closed when done. Thinking is transient information.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!streaming) setOpen(false);
  }, [streaming]);

  return (
    <div className="rounded-md border border-line bg-surface">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted"
      >
        <Brain className="size-3.5 shrink-0" aria-hidden />
        <span className={cn(streaming && "text-fg")}>Thinking</span>
        <ChevronRight
          aria-hidden
          className={cn(
            "ml-auto size-3.5 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2 text-muted">
          <Response>{text}</Response>
        </div>
      )}
    </div>
  );
}

function ToolPart({
  part,
  onPermission,
}: {
  part: Extract<Part, { kind: "tool" }>;
  onPermission: (requestId: string, decision: "allow" | "deny") => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICON[part.toolKind] ?? ChevronRight;

  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";
  const awaiting = part.state === "approval-requested";
  const target = part.title ?? summarize(part.input);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border bg-surface transition-colors",
        awaiting ? "border-accent" : "border-line",
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        <Icon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0",
            failed ? "text-danger" : running ? "text-accent" : "text-muted",
          )}
        />
        <span className="shrink-0 font-mono">{part.toolName}</span>
        {target && (
          <span className="min-w-0 flex-1 truncate font-mono text-muted">
            {target}
          </span>
        )}
        {running && <Pulse />}
        {failed && <X className="size-3.5 shrink-0 text-danger" aria-hidden />}
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-muted transition-transform",
            open && "rotate-90",
            !target && "ml-auto",
          )}
        />
      </button>

      {awaiting && part.approval && (
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <span className="flex-1">Allow this call?</span>
          <button
            onClick={() => onPermission(part.approval!.id, "deny")}
            className="flex h-8 items-center gap-1.5 rounded border border-line px-2.5"
          >
            <X className="size-3.5" aria-hidden />
            Deny
          </button>
          <button
            onClick={() => onPermission(part.approval!.id, "allow")}
            className="flex h-8 items-center gap-1.5 rounded bg-accent px-2.5 font-medium text-accent-fg"
          >
            <Check className="size-3.5" aria-hidden />
            Allow
          </button>
        </div>
      )}

      {open && (
        <div className="border-t border-line">
          {part.input !== undefined && (
            <pre className="overflow-x-auto px-3 py-2 font-mono text-muted">
              {JSON.stringify(part.input, null, 2)}
            </pre>
          )}
          {(part.output !== undefined || part.errorText) && (
            <pre
              className={cn(
                "max-h-72 overflow-auto border-t border-line px-3 py-2 font-mono whitespace-pre-wrap",
                failed && "text-danger",
              )}
            >
              {part.errorText ?? String(part.output ?? "")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** Three dots that mean something: a tool is still running. Not a spinner. */
function Pulse() {
  const reduced = useReducedMotion();
  if (reduced) return <span className="text-muted">…</span>;
  return (
    <span aria-hidden className="flex shrink-0 gap-0.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1 rounded-full bg-accent"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.16 }}
        />
      ))}
    </span>
  );
}

function summarize(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  for (const k of ["file_path", "command", "pattern", "description", "name"]) {
    if (typeof i[k] === "string") return i[k] as string;
  }
  return undefined;
}
