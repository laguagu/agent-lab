---
name: extend-skill-lab
description: Extend Skill Lab itself — add an event or command to the wire protocol, add a second agent engine, or add a workspace panel. Use when working inside the skill-lab repository on the protocol, the runner, the orchestrator or the web UI.
---

# Extend Skill Lab

This repo has one load-bearing rule: **the UI never learns which engine runs in the
container.** Everything crosses `packages/protocol`. Follow the seam and changes stay small;
cut across it and the second engine becomes impossible.

Read `AGENTS.md` first — it holds the hard rules and the traps already paid for.

## Adding an event or command

The protocol is a discriminated union, so the compiler finds every site for you.

1. Add the variant to `packages/protocol/src/events.ts` (runner → browser) or
   `commands.ts` (browser → runner). Document the field that is not obvious.
2. `bun run build:protocol` — the package is compiled, not consumed as source, because Node
   refuses to strip types inside `node_modules`.
3. Emit it in `images/runner/src/translate.ts`. **This is the only file allowed to read
   Claude-specific shapes.** If your new event needs SDK knowledge, it belongs here.
4. Handle it in `apps/web/lib/use-runner-session.ts`. If it produces a conversation part,
   add its type to `PART_EVENTS` — otherwise it silently creates an empty turn.
5. Render it in `apps/web/components/agent/conversation.tsx`.

A command that expects an answer carries a `requestId` and is answered with a `result`
event. `RunnerClient.request()` already pairs them.

## Adding a second engine

The contract an engine implements is: dial out to the orchestrator over WebSocket, accept a
`SessionSpec`, emit `RunnerEvent`s, accept `RunnerCommand`s.

1. New image under `images/<engine>/` with its own `translate.ts`.
2. Report honest `capabilities` in `session.init`. The UI hides what an engine cannot do —
   `capabilities.pty: false` removes the terminal tab rather than breaking it.
3. Do not touch the orchestrator or the web app. If you need to, the seam is in the wrong
   place and the protocol is what should change.

## Adding a workspace panel

Panels live in `apps/web/components/workspace/`. Add the tab to the `tabs` array in
`workspace-panel.tsx` and gate it on a capability if it depends on the engine.

Anything touching the container filesystem goes through `fs.*` commands, never through a new
HTTP endpoint — the runner publishes no ports.

## Before you finish

```bash
bun run typecheck                    # all four packages
bun run build:image                  # if images/runner changed
node scripts/verify-session.mjs      # the chain still works end to end
```

`verify-session` exits 0 only when a container starts, dials back, reports its skills and
answers a file operation. If it passes, the seam is intact.
