"use client";

/**
 * Markdown rendering with streamdown.
 *
 * An ordinary markdown parser breaks mid-stream while a fence is still open or a bold run
 * is unclosed. Streamdown is built for incomplete input, so the text looks right in every
 * frame rather than only at the end of a turn.
 *
 * memo plus a children comparison: without it the whole markdown tree reparses on every
 * delta, which stutters on long answers.
 */

import { memo } from "react";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { cn } from "@/lib/cn";

const plugins = { code };

export const Response = memo(
  ({ children, className }: { children: string; className?: string }) => (
    <Streamdown
      plugins={plugins}
      className={cn(
        "min-w-0 leading-relaxed",
        // Drop first and last child margins so parts sit flush against each other
        // without doubled spacing.
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        "[&_p]:my-2",
        "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-medium",
        "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:font-medium",
        "[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:font-medium",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-0.5",
        "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-4",
        "[&_strong]:font-medium [&_strong]:text-fg",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-muted",
        // Inline code is set apart by background, not a border: a border around every
        // identifier shreds the line of text.
        "[&_code:not(pre_code)]:rounded [&_code:not(pre_code)]:bg-raised [&_code:not(pre_code)]:px-1 [&_code:not(pre_code)]:py-0.5 [&_code:not(pre_code)]:font-mono [&_code:not(pre_code)]:text-[0.92em]",
        "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-line [&_pre]:bg-raised [&_pre]:p-3",
        "[&_table]:my-3 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto",
        "[&_th]:border-b [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
        "[&_td]:border-b [&_td]:border-line [&_td]:px-2 [&_td]:py-1",
        "[&_hr]:my-4 [&_hr]:border-line",
        className,
      )}
    >
      {children}
    </Streamdown>
  ),
  (prev, next) => prev.children === next.children,
);

Response.displayName = "Response";
