---
name: review-changes
description: Review uncommitted changes in the workspace for correctness bugs and needless complexity. Use when the user asks to review the diff, check the changes, look over what was edited, or asks whether recent edits are correct before committing.
---

# Review the working tree

Review what changed, not what exists. The bar is: would this break in production, and could
it be simpler.

## Get the diff

```bash
git status --short
git diff
git diff --staged
```

If the workspace is not a git repository, say so and ask which files to review rather than
reading everything.

For each changed file, read enough surrounding code to judge the change in context. A diff
hunk alone hides the bug most of the time.

## What counts as a finding

Report only what you can defend with a concrete failure:

- **Correctness** — a specific input or state that produces a wrong result, a crash, or a
  hang. Name the input.
- **Contract breaks** — a changed signature, return shape or error behaviour with callers
  that were not updated. Grep for the callers; do not assume.
- **Resource and lifecycle** — an unclosed handle, a listener never removed, an effect that
  reruns because a dependency is unstable.
- **Simplification** — code that duplicates something already in the repo. Name the existing
  function and its path.

Not findings: style, naming preferences, missing comments, or "consider extracting this".

## Report

Most severe first. For each:

```
path/to/file.ts:42  <one-sentence claim>
  Fails when: <concrete input or state> -> <wrong output or crash>
  Fix: <the smallest change that works>
```

End with one line: how many findings, and whether the change is safe to commit as it stands.

If nothing is wrong, say that plainly in one sentence. A review that invents a finding to
look thorough is worse than a short one.

## Rules

- Verify before claiming. If a bug depends on a caller, open the caller.
- Mark anything you could not verify as uncertain, and say what would settle it.
- Do not fix anything unless asked. Review and fix are separate requests.
