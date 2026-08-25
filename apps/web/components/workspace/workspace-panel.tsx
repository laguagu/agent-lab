"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileCode2, GitCompare, RefreshCw, SquareTerminal } from "lucide-react";
import type { FsNode, RunnerCapabilities } from "@skill-lab/protocol";
import type { RunnerClient } from "@/lib/runner-client";
import { cn } from "@/lib/cn";
import { FileTree } from "./file-tree";
import { MonacoDiff, MonacoEditor } from "./editor-pane";
import { TerminalPane } from "./terminal-pane";

type Tab = "editor" | "diff" | "terminal";

export function WorkspacePanel({
  client,
  capabilities,
  treeVersion,
  changedFile,
  ptyOutput,
}: {
  client: RunnerClient | null;
  capabilities: RunnerCapabilities | null;
  treeVersion: number;
  changedFile: { path: string; nonce: number } | null;
  ptyOutput: { ptyId: string; data: string } | null;
}) {
  const [tab, setTab] = useState<Tab>("editor");
  const [tree, setTree] = useState<FsNode | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(true);
  const [diff, setDiff] = useState<{ original: string; modified: string } | null>(
    null,
  );
  // Keep the freshest values in refs so an agent-driven change does not need an effect
  // that would be recreated and reset the editor.
  const selectedRef = useRef<string | null>(null);
  const savedRef = useRef(true);
  selectedRef.current = selected;
  savedRef.current = saved;

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      setTree(
        await client.request<FsNode>({
          type: "fs.list",
          path: ".",
          depth: 5,
        } as never),
      );
    } catch {
      /* the session is not ready yet */
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh, treeVersion]);

  const read = useCallback(
    async (path: string) => {
      if (!client) return;
      const res = await client.request<{ content: string }>({
        type: "fs.read",
        path,
      } as never);
      setContent(res.content);
      setSaved(true);
    },
    [client],
  );

  const open = useCallback(
    async (path: string) => {
      setSelected(path);
      setTab("editor");
      try {
        await read(path);
      } catch (e) {
        setContent(`// Could not read file: ${(e as Error).message}`);
      }
    },
    [read],
  );

  /**
   * When the agent writes to a file that is open, reload it.
   *
   * Without this the user had to switch to another file and back to see the change.
   * Unsaved local edits are never overwritten.
   */
  useEffect(() => {
    if (!changedFile) return;
    if (changedFile.path !== selectedRef.current) return;
    if (!savedRef.current) return;
    void read(changedFile.path).catch(() => {});
  }, [changedFile, read]);

  const save = useCallback(async () => {
    if (!client || !selected) return;
    await client.request({ type: "fs.write", path: selected, content } as never);
    setSaved(true);
  }, [client, selected, content]);

  const showDiff = useCallback(async () => {
    if (!client || !selected) return;
    setTab("diff");
    try {
      setDiff(
        await client.request<{ original: string; modified: string }>({
          type: "fs.diff",
          path: selected,
        } as never),
      );
    } catch {
      setDiff(null);
    }
  }, [client, selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const tabs = [
    { id: "editor" as const, label: "Editor", icon: FileCode2, enabled: true },
    {
      id: "diff" as const,
      label: "Changes",
      icon: GitCompare,
      enabled: Boolean(selected),
    },
    {
      id: "terminal" as const,
      label: "Terminal",
      icon: SquareTerminal,
      // Shown only when the engine reports it can do this.
      enabled: capabilities?.pty !== false,
    },
  ];

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-60 shrink-0 flex-col border-r border-line">
        <div className="flex h-9 items-center justify-between border-b border-line px-3">
          <span className="text-muted">Workspace</span>
          <button
            onClick={() => void refresh()}
            aria-label="Refresh file tree"
            className="flex size-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface hover:text-fg"
          >
            <RefreshCw className="size-3.5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <FileTree
            root={tree}
            selected={selected}
            recentlyChanged={changedFile?.path ?? null}
            onSelect={(p) => void open(p)}
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 items-center gap-1 border-b border-line px-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              disabled={!t.enabled}
              onClick={() => (t.id === "diff" ? void showDiff() : setTab(t.id))}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded px-2 transition-colors disabled:opacity-30",
                tab === t.id ? "bg-surface text-fg" : "text-muted hover:text-fg",
              )}
            >
              <t.icon className="size-3.5" aria-hidden />
              {t.label}
            </button>
          ))}
          <span className="min-w-0 flex-1 truncate px-2 text-right font-mono text-muted">
            {selected ?? ""}
          </span>
          {tab === "editor" && selected && !saved && (
            <button
              onClick={() => void save()}
              className="h-7 rounded bg-accent px-2.5 font-medium text-accent-fg"
            >
              Save
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1">
          {tab === "editor" &&
            (selected ? (
              <MonacoEditor
                path={selected}
                value={content}
                onChange={(v) => {
                  setContent(v);
                  setSaved(false);
                }}
              />
            ) : (
              <Placeholder>Select a file to edit it</Placeholder>
            ))}

          {tab === "diff" &&
            (diff && diff.original !== diff.modified ? (
              <MonacoDiff original={diff.original} modified={diff.modified} />
            ) : (
              <Placeholder>
                {diff ? "No changes in this file" : "Not a git repository"}
              </Placeholder>
            ))}

          <div className={cn("h-full", tab !== "terminal" && "hidden")}>
            <TerminalPane
              client={client}
              ptyOutput={ptyOutput}
              active={tab === "terminal"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-muted">
      {children}
    </div>
  );
}
