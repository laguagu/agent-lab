"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Sparkles } from "lucide-react";
import { Composer } from "@/components/agent/composer";
import { Conversation } from "@/components/agent/conversation";
import { EmptyState } from "@/components/agent/empty-state";
import { WorkspacePanel } from "@/components/workspace/workspace-panel";
import { useRunnerSession } from "@/lib/use-runner-session";
import { cn } from "@/lib/cn";

const STATUS_TEXT: Record<string, string> = {
  starting: "starting",
  ready: "ready",
  thinking: "running",
  "awaiting-input": "ready",
  "awaiting-permission": "needs approval",
  done: "done",
  error: "error",
  stopped: "stopped",
};

export default function WorkbenchPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const {
    turns,
    status,
    connection,
    info,
    usage,
    treeVersion,
    changedFile,
    ptyOutput,
    client,
    sendPrompt,
    interrupt,
    respondPermission,
  } = useRunnerSession(sessionId);

  const [preset, setPreset] = useState<{ text: string; nonce: number }>();
  const busy = status === "thinking";
  const broken = connection === "closed" || status === "error";

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-3">
        <Link
          href="/"
          className="flex items-center gap-1 text-muted transition-colors hover:text-fg"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Sessions
        </Link>

        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            broken ? "bg-danger" : busy ? "bg-accent" : "bg-ok",
          )}
        />
        <span className="text-muted">
          {connection === "closed" ? "disconnected" : STATUS_TEXT[status]}
        </span>

        <span className="flex-1" />

        {info && (
          <>
            <span className="hidden font-mono text-muted sm:inline">
              {info.model}
            </span>
            <span className="flex items-center gap-1.5 text-muted">
              <Sparkles className="size-3.5 text-accent" aria-hidden />
              {info.skills.length}
            </span>
          </>
        )}
        {usage.costUsd > 0 && (
          <span className="tabular-nums text-muted">
            ${usage.costUsd.toFixed(4)}
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col border-r border-line">
          {turns.length === 0 ? (
            <div className="flex-1 overflow-y-auto px-5">
              <EmptyState
                skills={info?.skills ?? []}
                repoUrl={info?.repoUrl}
                onPick={(text) => setPreset({ text, nonce: Date.now() })}
              />
            </div>
          ) : (
            <Conversation turns={turns} onPermission={respondPermission} />
          )}
          <Composer
            skills={info?.skills ?? []}
            busy={busy}
            preset={preset}
            onSubmit={sendPrompt}
            onInterrupt={interrupt}
          />
        </section>

        {/* The workspace needs room to be useful; on narrow screens chat takes it all. */}
        <section className="hidden min-w-0 flex-1 lg:flex lg:flex-col">
          <WorkspacePanel
            client={client.current}
            capabilities={info?.capabilities ?? null}
            treeVersion={treeVersion}
            changedFile={changedFile}
            ptyOutput={ptyOutput}
          />
        </section>
      </div>
    </div>
  );
}
