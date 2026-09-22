"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Sparkles, Square } from "lucide-react";
import type { DiscoveredSkill } from "@agent-lab/protocol";
import { cn } from "@/lib/cn";

/**
 * The input row, with a skill picker.
 *
 * Skills are the whole point of this tool, so `/` opens the list of skills discovered
 * inside the container: not a static list, but what the agent actually sees.
 */
export function Composer({
  skills,
  busy,
  preset,
  onSubmit,
  onInterrupt,
}: {
  skills: DiscoveredSkill[];
  busy: boolean;
  /** Text set from outside, such as a starter suggestion. nonce forces an update. */
  preset?: { text: string; nonce: number };
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
}) {
  const [value, setValue] = useState("");
  const [picking, setPicking] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!preset) return;
    setValue(preset.text);
    inputRef.current?.focus();
  }, [preset?.nonce, preset]);

  // Grow with the content, capped at ten rows.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const query = picking ? value.slice(1).toLowerCase() : "";
  const matches = useMemo(
    () =>
      picking
        ? skills.filter((s) => s.name.toLowerCase().includes(query)).slice(0, 8)
        : [],
    [picking, query, skills],
  );

  const choose = (name: string) => {
    setValue(`/${name} `);
    setPicking(false);
    inputRef.current?.focus();
  };

  const submit = () => {
    if (!value.trim() || busy) return;
    onSubmit(value);
    setValue("");
    setPicking(false);
  };

  return (
    <div className="relative border-t border-line px-5 py-3">
      {matches.length > 0 && (
        <ul
          role="listbox"
          className="absolute bottom-full left-1/2 mb-2 w-[32rem] max-w-[calc(100%-2.5rem)] -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-raised shadow-xl"
        >
          {matches.map((s, i) => (
            <li key={s.name}>
              <button
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(s.name)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left",
                  i === highlight && "bg-surface",
                )}
              >
                <Sparkles
                  className="mt-0.5 size-3.5 shrink-0 text-accent"
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="font-mono text-accent">/{s.name}</span>
                  {s.description && (
                    <span className="line-clamp-1 text-muted">
                      {s.description}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <div className="flex min-w-0 flex-1 items-end rounded-xl border border-line bg-surface transition-colors focus-within:border-accent">
          <textarea
            ref={inputRef}
            value={value}
            rows={1}
            placeholder="Describe a task, or press / to pick a skill"
            onChange={(e) => {
              setValue(e.target.value);
              setPicking(
                e.target.value.startsWith("/") && !e.target.value.includes(" "),
              );
              setHighlight(0);
            }}
            onKeyDown={(e) => {
              if (picking && matches.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlight((h) => (h + 1) % matches.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((h) => (h - 1 + matches.length) % matches.length);
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  choose(matches[highlight].name);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") setPicking(false);
            }}
            className="max-h-56 min-h-10 flex-1 resize-none bg-transparent px-3.5 py-2.5 outline-none placeholder:text-muted"
          />
        </div>

        {busy ? (
          <button
            onClick={onInterrupt}
            aria-label="Stop"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line transition-colors hover:border-danger hover:text-danger"
          >
            <Square className="size-3.5 fill-current" aria-hidden />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!value.trim()}
            aria-label="Run"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg transition-opacity disabled:opacity-30"
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
