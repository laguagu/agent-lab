# Agent Lab

Run sandboxed agents locally, three different ways, and compare them side by side.

An agent that decides for itself — writes a script, runs it, reads the error, fixes it — has
to run somewhere that a mistake cannot hurt. There is no single right answer to *where*.
This repository builds the three serious ones and puts the same browser UI on all of them:
conversation, file tree, editor, diff and a terminal into the same sandbox.

| Track | The agent is | Sandbox | Production |
| --- | --- | --- | --- |
| **`claude-container`** | the Claude Agent SDK | a Docker container this repo starts | any Docker host, OpenShift, a VPS |
| **`eve`** | a directory of files you author | eve's backend | `eve deploy` → Vercel |
| **`harness`** | Claude Code / Codex, driven from code | Vercel Sandbox, **required** | Vercel |

Read [docs/00-tracks.md](docs/00-tracks.md) before picking one. The short version: only
`claude-container` runs without an external service, and the `harness` track cannot be
self-hosted today because its adapter needs a network sandbox with an exposed port and the
only documented provider is Vercel's.

Status: `claude-container` is built and verified end to end. `eve` and `harness` are next —
see [Roadmap](#roadmap).

The repo is also meant to be handed to an agent as context when the task is *build me a
sandboxed agent that runs code*. Two files carry that: `docs/00-tracks.md` for what has been
measured here, and [`skills/code-agent-sandboxes`](skills/code-agent-sandboxes/SKILL.md) for
the decision itself — which framework, which sandbox, and which deployment target, including
the constraints that rule most options out on OpenShift.

## How it works

```
browser ──┬── web            Next.js 16 · port 3000
          │                  UI only — it does not know which track is running
          │
          └── orchestrator   Node 24 + Hono + ws · port 8080
                             the only process holding the Docker socket
                                  │
              ┌───────────────────┴──────────────────┐
              │                                      │
        litellm (optional)                    runner-<sessionId>
        port 4000                             Node 24 + the track's engine
        Anthropic format in,                  publishes no ports; dials out
        any provider out                      /workspace + /skills (ro)
```

Runner containers publish no ports — they dial out to the orchestrator. That removes port
allocation entirely and behaves identically on Windows and Linux.

`packages/protocol` is the seam. Everything the UI knows about an agent arrives as a
`RunnerEvent`, and the UI degrades from the `capabilities` field rather than guessing. A new
track is a new translator, not a new UI.

## Quick start

Requires Docker and [Bun](https://bun.com).

```bash
bun install
bun run sync-skills        # optional: overlay your own skill library
bun run build:protocol
bun run build:image        # ~1 GB, includes the native Claude Code binary
cp .env.example .env       # add an API key
bun run dev:orchestrator   # port 8080
bun run dev:web            # port 3000
```

### Skills

The repo ships its own skills in `skills/`, so a fresh clone works with no setup. To add your
own library on top:

```bash
SKILLS_SRC=~/my-skills bun run sync-skills
```

That merges both into `.skills-cache/` (gitignored), which the orchestrator mounts instead of
`skills/`. Any directory of `<name>/SKILL.md` folders works.

## Verifying

Four scripts, no test framework, each exits 0 on success:

| Script | What it proves |
| --- | --- |
| `node scripts/verify-session.mjs` | session → container → skills discovered → file operations |
| `node scripts/verify-clone.mjs <repo>` | a public repo lands in the workspace |
| `node scripts/verify-turn.mjs` | the agent runs Bash/Read/Write and edits files |
| `node scripts/verify-terminal.mjs <sessionId>` | terminal over `docker exec`, running as uid 1000 |

## Models

The `claude-container` runner speaks the Anthropic Messages format, which gives two routes:

| Route | Configuration | When |
| --- | --- | --- |
| **Native** | `ANTHROPIC_API_KEY` | Claude, direct |
| **Native, enterprise** | `CLAUDE_CODE_USE_FOUNDRY` / `_USE_BEDROCK` / `_USE_VERTEX` | Claude through Azure AI Foundry, Bedrock or Vertex — no translation layer, full feature fidelity |
| **Gateway** | `docker compose up -d litellm` + `ANTHROPIC_BASE_URL` | Anything non-Claude: Azure OpenAI, OpenAI, Gemini |

The model picker greys out gateway-routed models while the gateway is down, rather than
letting the request fail somewhere invisible.

Provider credentials live only in the gateway container, never inside a runner. A skill is
arbitrary code, so it must not be able to read the keys that pay for it.

> **Security:** LiteLLM 1.82.7 and 1.82.8 shipped credential-stealing malware
> ([PyPI, 2026-03-24](https://github.com/BerriAI/litellm/issues/24518)). The compose file
> pins v1.98.0 by digest, not by tag.

## Container isolation

Runner containers drop all capabilities, run as uid 1000, get `no-new-privileges`, a memory
and CPU ceiling, a pid limit and a `noexec` tmpfs. They sit on their own bridge network and
never see the Docker socket.

This is a lab, not a hardened multi-tenant host. Skills are arbitrary code and the agent will
run them, so treat the container as a boundary against accidents rather than against an
adversary. For stronger isolation see [gVisor](https://gvisor.dev) or a microVM.

## Roadmap

| | |
| --- | --- |
| `eve` track | The agent-as-files engine, wired to the same protocol. Gives the `eve deploy` path. |
| `harness` track | `HarnessAgent` + `claudeCode` on Vercel Sandbox. Needs a Vercel login; cannot run offline. |
| Permission flow | `canUseTool` → `permission.request` → approval card. Protocol and UI are ready; no runner sends requests yet. This is the missing piece for letting an agent decide and execute unsupervised. |
| Session persistence | The `~/.claude` volume already survives and `SessionSpec.resume` is defined. Not wired to the UI. |
| Deployment | Compose is deployment-ready; TLS, auth and provisioning are not written. |

## Licence

MIT.
