"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { FsNode } from "@agent-lab/protocol";
import { iconForDir, iconForFile } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

export function FileTree({
  root,
  selected,
  recentlyChanged,
  onSelect,
}: {
  root: FsNode | null;
  selected: string | null;
  /** The file the agent just changed is highlighted briefly. */
  recentlyChanged?: string | null;
  onSelect: (path: string) => void;
}) {
  const children = root?.children ?? [];

  if (children.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-muted">
        {root ? "No files yet" : "Workspace not ready"}
      </p>
    );
  }

  return (
    <ul className="py-1">
      {children.map((child) => (
        <Node
          key={child.path}
          node={child}
          depth={0}
          selected={selected}
          recentlyChanged={recentlyChanged}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function Node({
  node,
  depth,
  selected,
  recentlyChanged,
  onSelect,
}: {
  node: FsNode;
  depth: number;
  selected: string | null;
  recentlyChanged?: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);

  // Open a directory when the selection or a change lies inside it.
  useEffect(() => {
    if (node.kind !== "dir") return;
    const inside = (p?: string | null) => p && p.startsWith(node.path + "/");
    if (inside(selected) || inside(recentlyChanged)) setOpen(true);
  }, [selected, recentlyChanged, node.kind, node.path]);

  const isSelected = selected === node.path;
  const isChanged = recentlyChanged === node.path;
  const Icon = node.kind === "dir" ? iconForDir(open) : iconForFile(node.name);

  return (
    <li>
      <button
        onClick={() =>
          node.kind === "dir" ? setOpen((v) => !v) : onSelect(node.path)
        }
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        title={node.path}
        className={cn(
          "flex w-full items-center gap-1.5 py-1 pr-2 text-left transition-colors",
          isSelected
            ? "bg-accent/12 text-accent"
            : isChanged
              ? "text-accent"
              : "hover:bg-surface",
        )}
      >
        {node.kind === "dir" ? (
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-muted transition-transform",
              open && "rotate-90",
            )}
          />
        ) : (
          <span aria-hidden className="w-3 shrink-0" />
        )}
        <Icon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0",
            isSelected || isChanged ? "text-accent" : "text-muted",
          )}
        />
        <span className="truncate font-mono">{node.name}</span>
        {isChanged && (
          <span
            aria-label="just changed"
            className="ml-auto size-1.5 shrink-0 rounded-full bg-accent"
          />
        )}
      </button>

      {node.kind === "dir" && open && (
        <ul>
          {(node.children ?? []).map((c) => (
            <Node
              key={c.path}
              node={c}
              depth={depth + 1}
              selected={selected}
              recentlyChanged={recentlyChanged}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
