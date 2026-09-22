# Where an agent that runs code can live

The question behind this lab, asked more widely: *I want an agent that reads files, runs
commands and executes code — the way Claude Code or Codex does — driven from my own code
or an API. Where does it run, who owns the loop, and what does each choice cost?*

Surveyed on 2026-09-22 from the vendors' own documentation. Anything run on this machine is
marked **tried**; everything else is what the vendor says, to be verified before building
on it.

## Five shapes

Every option falls into one of five shapes. The shape matters more than the vendor, because
it decides where untrusted code runs and who carries the operations.

### 1. An agent CLI in your own container, driven by its SDK

The vendor's coding agent — its loop, tools, compaction — runs as a subprocess inside a
container you start. You talk to it through the vendor SDK.

- **Claude Agent SDK** — the `claude-container` track. **Tried**, verified end to end.
- **Codex SDK** (`@openai/codex-sdk`) — the `codex-container` track. **Tried**, verified up
  to the model call; see [00-tracks.md](00-tracks.md#codex-container--the-same-container-openais-agent).
  Codex also has a richer JSON-RPC surface, `codex app-server`, which is what its IDE
  extension and desktop app use: streaming deltas and approval requests, which `codex exec`
  lacks. The SDK is the documented route for automation; the app-server is broader and marked
  experimental.

You get each product's exact behaviour and run anywhere a container runs, including
OpenShift as one pod per session. You own the container lifecycle, and the credential sits
inside the container with the code the agent runs.

### 2. A vendor-hosted agent loop, called over an API

The loop runs at the vendor; you send events and stream results back.

**Claude Managed Agents** (public beta, header `managed-agents-2026-04-01`, on by default
for API accounts). Four concepts: an *agent* (model, prompt, tools, MCP servers, skills), an
*environment* (where it runs), a *session* and *events* over SSE. Built-in tools are bash,
file read/write/edit/glob/grep, web search and fetch, and MCP. Sessions are stateful and
resumable, which is also why the feature is not eligible for Zero Data Retention or HIPAA
BAA coverage.

The environment is the interesting part:

- **Cloud sandbox** — Anthropic runs the container. No infrastructure at all.
- **Self-hosted sandbox** — a *worker* on your own infrastructure claims work from
  Anthropic's queue and executes the tool calls locally. The connection is **outbound HTTPS
  only**: no inbound port, no `/dev/kvm`, no privileged mode — a plain container or pod with
  `/bin/bash` and a writable directory. `ant beta:worker poll`, or `EnvironmentWorker` in the
  Python, TypeScript and Go SDKs; a `--on-work` hook can start one fresh container per
  session. Managed integrations exist for Cloudflare, Daytona, Modal and Vercel.

The self-hosted worker is the most important finding in this survey for OpenShift/Rahti.
Every restriction that rules out microVM sandboxes there — no KVM, no privileged pods, no
Docker socket — is irrelevant to it. The trade is that the *model loop* stays at Anthropic:
tool inputs and outputs travel to Anthropic's control plane so Claude can see them. Files
and processes stay on your side; what the agent reads does not.

Not tried: it needs an Anthropic API key, and none was configured here.

OpenAI's closest counterpart is the server-side tool set in the Responses API (code
interpreter and its hosted container). Not re-verified in this survey.

### 3. Your own loop, a sandbox from a provider

You write the agent — instructions, tools, orchestration — and the framework gives it a
workspace behind a provider interface.

**OpenAI Agents SDK sandbox agents** (April 2026, Python and TypeScript). A `SandboxAgent`
gets filesystem, shell and compaction capabilities by default, and a *manifest* describes the
workspace (local directories, git repos, cloud storage mounts). The sandbox is chosen at run
time:

```ts
import { SandboxAgent } from '@openai/agents/sandbox';
import { DockerSandboxClient } from '@openai/agents/sandbox/local';
// or UnixLocalSandboxClient, or a hosted one: Blaxel, Cloudflare, Daytona,
// E2B, Modal, Runloop, Vercel
```

It is the only framework found where moving from a local Docker sandbox to a hosted provider
is a one-line change. `UnixLocalSandboxClient` gives no OS-level confinement on Linux, so it
is for development only. Not tried.

The AI SDK's `ToolLoopAgent` plus a sandbox client (Vercel Sandbox, E2B, …) is the
TypeScript equivalent without the manifest abstraction.

### 4. An existing harness, driven from code, on a sandbox provider

**AI SDK `HarnessAgent`** drives Claude Code, Codex or Pi through one interface.
Re-verified 2026-09-22: Claude Code and Codex are *bridge-backed* and still "require using
real network sandbox like `@ai-sdk/sandbox-vercel`"; only Pi runs on the local
`sandbox-just-bash`. A Cloudflare provider is an open request, not a release. The `harness`
track's finding stands: not self-hostable for Claude Code or Codex today.

**eve** — an agent authored as files, deployed with `eve deploy`. See the `eve` track.

### 5. A local microVM for CLI agents

**Docker Sandboxes** (`sbx`, generally available since 2026-01-30). Each agent — Claude Code,
Codex, Copilot CLI, Gemini CLI, OpenCode, Kiro — runs in its own microVM with its own
kernel and its own Docker daemon, so it can build containers without touching the host.
Credentials stay on the host: a proxy injects them into outbound calls, so the agent can use
a key it cannot read. That is the credential model the container tracks here lack.

Built for a developer's machine, not a server: Windows 11 x86_64 (`winget install
Docker.sbx`), Apple Silicon, or Ubuntu with KVM.

**Tried:** the older built-in `docker sandbox` command is gone from Docker Desktop 29.6.2 —
it prints `"docker sandbox" is deprecated and has been removed` and points to `sbx`. `sbx`
itself was not installed.

## Choosing

| If you need | Take |
| --- | --- |
| Claude Code's behaviour on your own hardware or OpenShift | `claude-container` |
| Codex, OpenAI models natively, on your own hardware | `codex-container` |
| No infrastructure at all, and Claude | Managed Agents, cloud sandbox |
| Files and execution inside your perimeter, no loop to maintain | Managed Agents, self-hosted worker — the model still runs at Anthropic |
| Your own agent logic, free choice of sandbox provider | OpenAI Agents SDK `SandboxAgent`, or AI SDK `ToolLoopAgent` + a sandbox client |
| CLI agents running unattended on your laptop | Docker Sandboxes |
| CSC Rahti / OpenShift | a container track as one pod per session, or the Managed Agents worker. Nothing microVM-based: no `/dev/kvm` |

## Tried on 2026-09-22

| What | Result |
| --- | --- |
| Codex SDK 0.155.1 on the host, streamed turn | Event stream recorded. The ChatGPT plan was at its usage limit, so the turn failed — `error` then `turn.failed`, and the SDK throws when the CLI exits 1. |
| Codex's own sandbox in Docker, `codex sandbox -P <profile>` | See the table below. |
| Codex skill discovery in the container, `codex debug prompt-input` | All four repo skills in the model-visible prompt, read from `~/.agents/skills`. No model call needed. |
| `verify-session.mjs`, both tracks | Exit 0: container starts, dials back, skills reported, file API answers. |
| `verify-turn.mjs`, `RUNNER=codex-container` | The prompt reaches OpenAI with the mounted login; the usage-limit answer arrives as one `error` and one `finish`. |
| Browser UI, Codex session | Model picker offers the Codex models; session starts, repo cloned, error rendered cleanly; terminal runs as uid 1000. |
| `docker sandbox` | Removed in Docker 29; replaced by `sbx`. |

Codex's sandbox inside a container, per permission profile:

| Container | `:workspace` | `:read-only` | `:danger-full-access` |
| --- | --- | --- | --- |
| This repo's hardening (`cap-drop ALL`, `no-new-privileges`) | bwrap: no namespace | bwrap: no namespace | runs |
| Docker defaults | bwrap: no namespace | bwrap: no namespace | runs |
| `seccomp=unconfined` | runs | writes refused | runs |

Not tried, and why: Managed Agents, the OpenAI Agents SDK and every hosted sandbox need an
Anthropic or OpenAI API key or a provider account, and none was configured. Creating keys
and accounts is the owner's decision.

## Next experiments, most valuable first

1. **Record a successful Codex turn** — after the plan limit resets, or with
   `CODEX_API_KEY` — and replace the synthetic sequence in
   `scripts/verify-codex-translator.mjs`. `codex exec --experimental-json` prints the same
   JSONL the SDK parses, so redirecting it to a file is the whole recording.
2. **The Managed Agents self-hosted worker in a container.** It is the best candidate for
   Rahti: outbound-only, no KVM, no Docker socket. Worth a track of its own.
3. **`SandboxAgent` with `DockerSandboxClient`** as a third built track — the one shape here
   where you own the agent logic rather than borrowing a product's.
4. **`sbx run codex` and `sbx run claude`** on this Windows machine, to compare the
   credential proxy against the container tracks' in-container keys.

## Sources

- [Claude Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)
- [Self-hosted sandboxes](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes)
- [Self-hosted sandboxes and MCP tunnels, announcement](https://claude.com/blog/claude-managed-agents-updates)
- [OpenAI Agents SDK: sandbox agents](https://developers.openai.com/api/docs/guides/agents/sandboxes)
- [The next evolution of the Agents SDK](https://openai.com/index/the-next-evolution-of-the-agents-sdk/)
- [Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [AI SDK Harnesses: HarnessAgent](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)
- [Docker Sandboxes](https://www.docker.com/products/docker-sandboxes/)
- [Docker Sandboxes for Codex CLI](https://codex.danielvaughan.com/2026/04/13/docker-sandboxes-codex-cli-microvm-isolation/) — third-party, used for the platform requirements
