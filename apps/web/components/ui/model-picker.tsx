"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  MODELS,
  PROVIDER_LABEL,
  PROVIDER_LOGO,
  findModel,
  type ModelOption,
} from "@/lib/models";
import { cn } from "@/lib/cn";

/**
 * A native <select> cannot render an image inside an option, and the provider mark is
 * the fastest way to tell these models apart. Hence a custom listbox.
 */
export function ModelPicker({
  value,
  gatewayUp,
  onChange,
}: {
  value: string;
  /** When false, gateway-routed models are shown but not selectable. */
  gatewayUp: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = findModel(value) ?? MODELS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Model: ${selected.label}`}
        className="flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 transition-colors hover:border-accent"
      >
        <Logo model={selected} />
        <span className="whitespace-nowrap">{selected.label}</span>
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 text-muted transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute top-full right-0 z-20 mt-1 w-64 overflow-hidden rounded-lg border border-line bg-raised py-1 shadow-xl"
        >
          {MODELS.map((m) => {
            const blocked = m.viaGateway && !gatewayUp;
            const active = m.id === value;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={blocked}
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  title={blocked ? "Start the LiteLLM gateway to use this model" : m.note}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                    blocked ? "cursor-not-allowed opacity-40" : "hover:bg-surface",
                  )}
                >
                  <Logo model={m} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{m.label}</span>
                    <span className="block truncate text-muted">
                      {PROVIDER_LABEL[m.provider]}
                      {blocked && " · gateway offline"}
                    </span>
                  </span>
                  {active && (
                    <Check className="size-3.5 shrink-0 text-accent" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Brand marks keep their own colour — they are logo-like objects, not UI glyphs, so they
 * are never tinted with currentColor. Served as files rather than inlined JSX because the
 * Gemini and Azure marks carry internal ids that would collide in one document.
 */
function Logo({ model }: { model: ModelOption }) {
  return (
    <img
      src={PROVIDER_LOGO[model.provider]}
      alt=""
      aria-hidden
      width={16}
      height={16}
      className="size-4 shrink-0"
    />
  );
}
