"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import type { DiscoveredSkill } from "@skill-lab/protocol";

/**
 * An empty conversation is where the user either understands what this tool does, or
 * does not. Hence concrete starting points, not a paragraph explaining what an agent is.
 *
 * The first suggestion uses no skill at all: it works in any repo and proves the agent
 * can see the files. Skill suggestions are filtered by what is actually present in the
 * container.
 */

const PLAIN_STARTER = "Explain what this repo does and how it is structured";

const SKILL_STARTERS: Array<{ skill: string; prompt: string }> = [
  { skill: "code-review", prompt: "Review the code and tell me what to fix" },
  { skill: "skill-finder", prompt: "Which of my skills fit this repo?" },
  { skill: "nextjs-seo", prompt: "Audit the SEO and fix what you find" },
  { skill: "ui-signature", prompt: "Strip the decorative noise from the UI" },
  { skill: "react-best-practices", prompt: "Find wasteful re-renders" },
];

export function EmptyState({
  skills,
  repoUrl,
  onPick,
}: {
  skills: DiscoveredSkill[];
  repoUrl?: string;
  onPick: (prompt: string) => void;
}) {
  const available = new Set(skills.map((s) => s.name));
  const usable = SKILL_STARTERS.filter((s) => available.has(s.skill)).slice(0, 2);
  const repo = repoUrl?.replace(/^https?:\/\/(www\.)?github\.com\//, "");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-1 py-10">
      <p className="text-muted">
        {repo ? (
          <>
            <span className="font-mono text-fg">{repo}</span> is cloned into the
            container. The agent reads and edits it in the tree on the right.
          </>
        ) : (
          <>
            The workspace is empty. The agent can create files here, or go back and
            clone a repo.
          </>
        )}
      </p>

      <ul className="flex flex-col gap-2">
        <li>
          <Starter onClick={() => onPick(PLAIN_STARTER)}>{PLAIN_STARTER}</Starter>
        </li>
        {usable.map((s) => (
          <li key={s.skill}>
            <Starter onClick={() => onPick(`/${s.skill} ${s.prompt}`)}>
              <Sparkles className="size-3.5 shrink-0 text-accent" aria-hidden />
              <span className="font-mono text-accent">/{s.skill}</span>
              <span className="text-muted">{s.prompt}</span>
            </Starter>
          </li>
        ))}
      </ul>

      <p className="text-muted">
        Press <span className="font-mono text-fg">/</span> to browse all{" "}
        {skills.length} skills.
      </p>
    </div>
  );
}

function Starter({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent"
    >
      {children}
      <ArrowRight
        aria-hidden
        className="ml-auto size-3.5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
      />
    </button>
  );
}
