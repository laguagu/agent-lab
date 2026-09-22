# Agent Lab

Run sandboxed agents locally, three different ways, and compare them side by side. One
browser UI on top of all of them: conversation, file tree, Monaco editor, diff view and a
terminal into the same sandbox.

The three ways — the **tracks** — are `claude-container`, `eve` and `harness`. Read
`docs/00-tracks.md` before working on any of them; it records what each one costs and the
one finding that constrains the design (the `harness` track is not self-hostable today).
Only `claude-container` is built.

## Running it

```bash
bun run sync-skills        # materialise your skill library into .skills-cache/ (run first)
bun run build:protocol     # shared protocol -> dist/
bun run build:image        # runner image
bun run dev:orchestrator   # port 8080, on the host (needs Docker access)
bun run dev:web            # port 3000
```

Verification: `node scripts/verify-session.mjs` creates a session and prints the skills the
container discovered. Exit 0 means the whole chain works.

## Layout

| Path | What |
| --- | --- |
| `packages/protocol` | `RunnerEvent` / `RunnerCommand`. **The most important interface in the project** — it is what separates a track from the UI. Zero dependencies. |
| `images/runner-claude` | The `claude-container` track. Node 24 + `@anthropic-ai/claude-agent-sdk`. Further tracks go in sibling `images/runner-<track>/` directories. |
| `services/orchestrator` | The only process holding the Docker socket. Container lifecycle, WebSocket fan-out, terminal. Track-agnostic. |
| `apps/web` | Next.js 16. UI only — it does not know which track sits in the container. |
| `skills/` | The skills this repo ships. Committed, so they travel with the source. `code-agent-sandboxes` is the one to read when the task is to *build* a sandboxed code-executing agent rather than extend this lab. |
| `docs/` | The comparison between tracks. This is the lab's actual output. |

Runner containers **publish no ports**. They dial out to the orchestrator
(`ws://host.docker.internal:8080/ws/runner`), which removes port allocation entirely and
behaves identically on Windows and Linux.

## Hard rules

1. **Build the runner image with npm, not bun.** The native `claude` binary (392 MB) ships
   as the optional dependency `@anthropic-ai/claude-agent-sdk-linux-x64`. **Bun installs
   neither it nor the peer dependencies** — verified 2026-08-25 — and the run then dies with
   `spawn ENOENT`. npm installs both. The Dockerfile asserts the binary exists; do not
   remove that check.
2. **Never bundle the runner.** `bun build` breaks the SDK's CLI discovery: `import.meta.url`
   resolves to `/$bunfs/root/`, where `cli.js` does not physically exist.
3. **No parameter properties in runner source.** Node runs TypeScript in strip-only mode,
   which rejects `constructor(private x: T)` with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
4. **The `env` option replaces the subprocess environment** in the TypeScript SDK (Python
   merges instead). Always spread `...process.env`, or `PATH` disappears and the bundled
   binary never starts.
5. **The Docker socket belongs to the orchestrator alone.** A runner never sees it.
6. **Skills come from a volume, not from the image.** The repo ships its own `skills/`,
   and `sync-skills.sh` optionally overlays a personal library from `$SKILLS_SRC` on top,
   producing `.skills-cache/`. The orchestrator mounts `.skills-cache/` when it exists and
   `skills/` otherwise, so a fresh clone runs with no setup. A personal library is typically
   a tree of symlinks; `COPY` does not follow them, so the script dereferences with a
   `tar -ch | tar -x` pair. **robocopy will not do** — it copies symlinks as symlinks.
7. **The UI does not know which engine runs in the container.** Everything travels through
   `packages/protocol`. A second engine implements the same contract, and the UI degrades
   according to the `capabilities` field.
8. **Never mount `.env` files into the workspace.** The agent reads anything under
   `/workspace`, and skills are arbitrary code.

## Two non-obvious implementation details

**`system/init` never arrives on the message stream in streaming-input mode.** The SDK does
not spawn the subprocess until the input queue yields its first message, so the skill list
would only appear after the user had already typed something. `agent.ts:warmup()` therefore
pulls the data off the control channel instead: `initializationResult()` gives models and
commands, `reloadSkills()` gives skills **with descriptions** — better than `system/init`,
which carries names only.

**The terminal does not use node-pty.** The orchestrator opens a `docker exec` connection in
`Tty: true` mode and pipes the stream to a WebSocket. That keeps a native build
(`python3 make g++`) out of the image and leaves the terminal where the Docker socket
already is.

## Environment

Real values live outside the repo. The committed `.env.example` documents every key.

Model routing has two levels:

- **Native** — `ANTHROPIC_API_KEY`, or `CLAUDE_CODE_USE_FOUNDRY=1` / `_USE_BEDROCK` /
  `_USE_VERTEX` for enterprise routes. No translation layer, full feature fidelity.
- **Gateway** — `ANTHROPIC_BASE_URL=http://litellm:4000/anthropic` +
  `ANTHROPIC_AUTH_TOKEN`, with `docker compose up -d litellm`. LiteLLM translates the
  Anthropic format to Azure OpenAI, Gemini, Bedrock or Vertex. Needed for any non-Claude
  model, because the runner only speaks the Anthropic Messages format.

Provider credentials live only in the gateway, never inside a runner container.

> LiteLLM 1.82.7 and 1.82.8 shipped credential-stealing malware (PyPI, 2026-03-24). The
> compose file pins v1.98.0 **by digest**, not by tag. Do not switch it to `latest`.

## UI conventions

- **The UI is in English.** So are code comments and docs.
- **Markdown renders through `streamdown`**, not react-markdown. An ordinary parser breaks
  mid-stream while a fence is still open or a bold run unclosed; streamdown is built for
  incomplete input. `components/agent/response.tsx` is the only file that knows about it,
  and it is memoised on `children` — without that the whole markdown tree reparses on every
  delta and long answers stutter.
- **One icon library: lucide.** `components/ui/icons.tsx` maps file types and tool kinds.
  Families are never mixed and paths are never hand-drawn. Provider brand marks come from
  [svgl](https://svgl.app) and live in `public/logos/` as files rather than inlined JSX,
  because the Gemini and Azure marks carry internal `id`s that would collide in one
  document. Brand marks keep their own colour and are never tinted.
- **The accent is amber and it means agent activity** — a skill call, a running tool, the
  primary action. Measured, not eyeballed: 6.1:1 light, 11.5:1 dark.
- **Motion only when it communicates.** Part entry conveys order; three pulsing dots convey
  that a tool is still running. `useReducedMotion` is honoured everywhere.
- **Empty reasoning blocks are not drawn.** The model emits `redacted_thinking` blocks with
  no text; `isRenderable` filters them out.

### Two traps already fixed

**The reducer must not create a turn from events that produce no part.** `finish`, `usage`
and `result` used to spawn an empty assistant turn that displaced the empty state and its
instructions. The `PART_EVENTS` set bounds this.

**An open file reloads when the agent writes to it.** The runner emits `file.changed` with
the real path, taken from the tool's `file_path` input, and the workspace panel re-reads the
file if it is open and has no unsaved edits. Previously you had to switch files and back.

## Windows notes

- Git Bash rewrites `/usr/local/...` arguments into Windows paths. Use `MSYS_NO_PATHCONV=1`
  when running `docker run --entrypoint /usr/local/bin/...`.
- The entrypoint changes directory to `/workspace`, so `CMD` uses an absolute path.
- Bind mounts need `C:/...` form, not `/c/...`.
- **A container elsewhere on the machine can steal the orchestrator's port from the
  runner's point of view.** The orchestrator binds `0.0.0.0:8080`; an unrelated container
  publishing `127.0.0.1:8080->8080` binds the more specific address. Both listen happily.
  The host reaches the orchestrator, `host.docker.internal` reaches the other container,
  and the runner exits 0 after logging `websocket error: Unexpected server response: 200`.
  Diagnose from inside the network, not from the host:
  `docker run --rm --network agent-lab-net curlimages/curl -si http://host.docker.internal:8080/api/health`.
  Cost: one debugging session on 2026-09-22, against an Adminer container.
- **`node --watch` watches `node_modules`.** Package-manager churn restarted the
  orchestrator mid-handshake and wiped its in-memory sessions. The dev script pins
  `--watch-path=src`; do not drop that flag.
