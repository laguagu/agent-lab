---
name: explain-repo
description: Explain what a freshly cloned repository does, how it is structured, and where to start reading. Use when the user asks what a repo is, what it does, how it works, where the entry point is, or asks for an overview, tour or walkthrough of unfamiliar code.
---

# Explain a repository

Produce an explanation a competent engineer could act on within a minute — not a file listing.

## Read before you write

Read in this order and stop as soon as the picture is clear. Do not read every file.

1. `README*`, then any `AGENTS.md` / `CONTRIBUTING*` — the authors' own framing.
2. The manifest: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`. Dependencies say
   more about what something is than prose does.
3. The entry point named by the manifest (`main`, `bin`, `scripts.start`).
4. The largest source directory, breadth first. Names and imports, not full bodies.
5. `git log --oneline -15` — what has actually been changing.

## Report

Four sections, in this order. Keep the whole thing under a screen.

**What it is.** One or two sentences. Name the category (CLI, library, web app, service) and
the problem it solves. If the README oversells it, say what it actually does.

**How it is built.** The stack, and the two or three architectural decisions that a reader
would otherwise have to discover the hard way — the module that owns the core abstraction,
an unusual dependency, a build step that is not obvious.

**Where to start reading.** Three to five files with a clause each on why that file. Order
them as a reading path, not alphabetically.

**What surprised you.** The part a newcomer would get wrong: a misleading name, a file that
looks central but is dead, a convention enforced nowhere but assumed everywhere. Omit this
section rather than padding it — an honest "nothing surprising" is fine.

## Rules

- Cite paths as `path/to/file.ts:42` so they are clickable.
- Never claim a file does something you have not read.
- If the repo is too large to characterise honestly, say which part you covered and which
  you did not, rather than generalising from a sample.
- No bullet list of every directory. The tree is already visible in the UI.
