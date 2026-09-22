---
name: extend-agent-lab
description: Extend Agent Lab itself — add an event or command to the wire protocol, add a new track (agent engine), or add a workspace panel. Use when working inside the agent-lab repository on the protocol, a runner, the orchestrator or the web UI.
---

# Extend Agent Lab

This repo has one load-bearing rule: **the UI never learns which engine runs in the
container.** Everything crosses `packages/protocol`. Follow the seam and changes stay small;
cut across it and the next track becomes impossible.

Read `AGENTS.md` first — it holds the hard rules and the traps already paid for.

## Adding an event or command

The protocol is a discriminated union, so the compiler finds every site for you.

1. Add the variant to `packages/protocol/src/events.ts` (runner → browser) or
   `commands.ts` (browser → runner). Document the field that is not obvious.
2. `bun run build:protocol` — the package is compiled, not consumed as source, because Node
   refuses to strip types inside `node_modules`.
3. Emit it in each track's translator — `images/runner-claude/src/translate.ts` and
   `images/runner-codex/src/translate.ts`. **These are the only files allowed to read
   engine-specific shapes.** If your new event needs SDK knowledge, it belongs there. A
   track whose engine cannot produce the event simply never emits it.
4. Handle it in `apps/web/lib/use-runner-session.ts`. If it produces a conversation part,
   add its type to `PART_EVENTS` — otherwise it silently creates an empty turn.
5. Render it in `apps/web/components/agent/conversation.tsx`.

A command that expects an answer carries a `requestId` and is answered with a `result`
event. `RunnerClient.request()` already pairs them.

## Adding a track

A track is one way of running a sandboxed agent — see `docs/00-tracks.md` for the ones that
exist. The contract it implements is: dial out to the orchestrator over WebSocket, accept a
`SessionSpec`, emit `RunnerEvent`s, accept `RunnerCommand`s. `images/runner-codex` is the
worked example of adding one; it took these steps and no others:

1. New image under `images/runner-<track>/` with its own `translate.ts`, and a
   `build:image:<track>` script.
2. Report honest `capabilities` in `session.init`. The UI hides what an engine cannot do —
   `capabilities.pty: false` removes the terminal tab rather than breaking it.
3. Add the track to `RunnerKind` and `CONTAINER_RUNNERS` in the protocol.
4. One row in the orchestrator's `TRACKS` table: image, state directory, default model,
   and the credentials the runner may see — nothing else.
5. Its models in `apps/web/lib/models.ts`, each with `runner` set.

If a track needs more than that from the orchestrator or the web app — a new component, a
branch on the track name — the seam is in the wrong place and the protocol is what should
change.

## Adding a workspace panel

Panels live in `apps/web/components/workspace/`. Add the tab to the `tabs` array in
`workspace-panel.tsx` and gate it on a capability if it depends on the engine.

Anything touching the container filesystem goes through `fs.*` commands, never through a new
HTTP endpoint — the runner publishes no ports.

## Before you finish

```bash
bun run typecheck                    # every package
bun run build:image                  # if images/runner-claude changed
bun run build:image:codex            # if images/runner-codex changed
node scripts/verify-session.mjs      # the chain still works end to end
RUNNER=codex-container node scripts/verify-session.mjs
node scripts/verify-codex-translator.mjs   # if the Codex translator changed
```

`verify-session` exits 0 only when a container starts, dials back, reports its skills and
answers a file operation. If it passes, the seam is intact.
