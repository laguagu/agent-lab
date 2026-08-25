"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, Sparkles, Trash2 } from "lucide-react";
import {
  createSession,
  deleteSession,
  health,
  listSessions,
  listSkills,
  type SessionSummary,
  type SkillSummary,
} from "@/lib/api";
import { ModelPicker } from "@/components/ui/model-picker";
import { DEFAULT_MODEL } from "@/lib/models";
import { cn } from "@/lib/cn";

const EXAMPLES = [
  "https://github.com/octocat/Hello-World",
  "https://github.com/sindresorhus/is-plain-obj",
];

export default function StartPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [docker, setDocker] = useState<boolean | null>(null);
  const [gateway, setGateway] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [repoUrl, setRepoUrl] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [showSkills, setShowSkills] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [s, sk, h] = await Promise.all([listSessions(), listSkills(), health()]);
      setSessions(s);
      setSkills(sk);
      setDocker(h?.docker ?? false);
      setGateway(h?.gateway ?? false);
    };
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const start = () =>
    startTransition(async () => {
      setError(null);
      try {
        const { sessionId } = await createSession({
          model,
          ...(repoUrl.trim() ? { repoUrl: repoUrl.trim() } : {}),
        });
        router.push(`/s/${sessionId}`);
      } catch (e) {
        setError((e as Error).message);
      }
    });

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-10 px-6 py-14">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-medium tracking-tight">
          <Sparkles className="size-4 text-accent" aria-hidden />
          Skill Lab
        </h1>
        <p className="mt-1 text-muted">
          Clone a repo into a container and let the agent run your skills against it.
        </p>
      </header>

      {docker === false && (
        <p className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-danger">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          Docker is not responding. Start Docker Desktop.
        </p>
      )}

      {/* Starting a session is the only job of this page, so it gets the full weight. */}
      <section className="flex flex-col gap-3">
        <label htmlFor="repo" className="text-muted">
          Git repository (optional)
        </label>
        {/* On narrow screens the input takes the row and picker plus button drop below;
            on a single row the trio overflowed 375 px. */}
        <div className="flex flex-wrap gap-2">
          <input
            id="repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && start()}
            placeholder="https://github.com/owner/repo"
            spellCheck={false}
            autoComplete="off"
            inputMode="url"
            className="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono outline-none transition-colors placeholder:text-muted focus:border-accent sm:w-auto sm:flex-1"
          />
          <ModelPicker value={model} gatewayUp={gateway} onChange={setModel} />
          <button
            onClick={start}
            disabled={pending || docker === false}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 font-medium text-accent-fg transition-opacity disabled:opacity-40 sm:flex-none"
          >
            {pending ? "Starting" : "Start"}
            {!pending && <ChevronRight className="size-4" aria-hidden />}
          </button>
        </div>

        <p className="text-muted">
          Leave empty for a blank workspace. Try{" "}
          {EXAMPLES.map((url, i) => (
            <span key={url}>
              {i > 0 && " or "}
              <button
                onClick={() => setRepoUrl(url)}
                className="font-mono text-accent underline-offset-4 hover:underline"
              >
                {url.replace("https://github.com/", "")}
              </button>
            </span>
          ))}
        </p>

        {error && (
          <p className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-danger">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
      </section>

      {sessions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted">Sessions</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3">
                <span
                  aria-label={s.state}
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    s.state === "ready" && "bg-ok",
                    s.state === "starting" && "bg-accent",
                    s.state === "stopped" && "bg-muted",
                    s.state === "error" && "bg-danger",
                  )}
                />
                <button
                  onClick={() => router.push(`/s/${s.id}`)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
                >
                  <span className="truncate">{s.title}</span>
                  <span className="shrink-0 font-mono text-muted">{s.model}</span>
                </button>
                {s.totalCostUsd > 0 && (
                  <span className="shrink-0 tabular-nums text-muted">
                    ${s.totalCostUsd.toFixed(3)}
                  </span>
                )}
                <button
                  onClick={async () => {
                    await deleteSession(s.id, true);
                    setSessions(await listSessions());
                  }}
                  aria-label={`Delete ${s.title}`}
                  className="flex size-8 shrink-0 items-center justify-center rounded text-muted transition-colors hover:text-danger"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        The skill library used to be a 40-row list on this page, where it had no business
        being: skills are chosen inside a session. One fact is all that remains.
      */}
      <section className="mt-auto">
        <button
          onClick={() => setShowSkills((v) => !v)}
          aria-expanded={showSkills}
          className="flex items-center gap-1.5 text-muted transition-colors hover:text-fg"
        >
          <ChevronRight
            aria-hidden
            className={cn("size-3.5 transition-transform", showSkills && "rotate-90")}
          />
          {skills.length} skills mounted
        </button>
        {showSkills && (
          <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 pl-5 sm:grid-cols-3">
            {skills.map((s) => (
              <li
                key={s.name}
                title={s.description}
                className="truncate font-mono text-muted"
              >
                /{s.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
