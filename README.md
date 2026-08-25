# Skill Lab

Run your own [Agent Skills](https://code.claude.com/docs/en/skills) inside a Docker
container, with a browser UI on top.

Paste a public git URL, pick a model, and the container clones the repo, discovers your
skill library and lets the agent work on it — while you watch the file tree, editor, diff
and terminal of that same container.

<!-- Contributor and agent notes: AGENTS.md -->

## How it works

```
browser ──┬── web            Next.js 16 · port 3000
          │                  UI only
          │
          └── orchestrator   Node 24 + Hono + ws · port 8080
                             the only process holding the Docker socket
                                  │
              ┌───────────────────┴──────────────────┐
              │                                      │
        litellm (optional)                    runner-<sessionId>
        port 4000                             Node 24 + Claude Agent SDK
        Anthropic format in,                  publishes no ports; dials out
        any provider out                      /workspace + /skills (ro)
```

Runner containers publish no ports — they dial out to the orchestrator. That removes port
allocation entirely and behaves identically on Windows and Linux.

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

The repo ships its own skills in `skills/`, so they travel with the source and a fresh
clone works with no setup. To add your own library on top:

```bash
SKILLS_SRC=~/my-skills bun run sync-skills
```

That merges both into `.skills-cache/` (gitignored), which the orchestrator then mounts
instead of `skills/`. Any directory of `<name>/SKILL.md` folders works.

## Verifying

Four scripts, no test framework, each exits 0 on success:

| Script | What it proves |
| --- | --- |
| `node scripts/verify-session.mjs` | session → container → skills discovered → file operations |
| `node scripts/verify-clone.mjs <repo>` | a public repo lands in the workspace |
| `node scripts/verify-turn.mjs` | the agent runs Bash/Read/Write and edits files |
| `node scripts/verify-terminal.mjs <sessionId>` | terminal over `docker exec`, running as uid 1000 |

## Models

The runner speaks the Anthropic Messages format, which gives two routes:

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

Runner containers drop all capabilities, run as uid 1000, get `no-new-privileges`, a
memory and CPU ceiling, a pid limit and a `noexec` tmpfs. They sit on their own bridge
network and never see the Docker socket.

This is a lab, not a hardened multi-tenant host. Skills are arbitrary code and the agent
will run them, so treat the container as a boundary against accidents rather than against
an adversary. For stronger isolation see
[gVisor](https://gvisor.dev) or a microVM.

## Status

Working end to end and verified. What is not built yet:

| | |
| --- | --- |
| Permission flow | `canUseTool` → `permission.request` → approval card. Protocol and UI are ready; the runner does not send requests yet. |
| Session persistence | The `~/.claude` volume already survives, and `SessionSpec.resume` is defined. Not wired to the UI. |
| Second engine | The HTTP+WS contract was designed for one, but only the Claude Agent SDK engine exists. |
| Deployment | Compose is deployment-ready; TLS, auth and provisioning are not written. |

## Licence

MIT.
