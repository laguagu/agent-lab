# The tracks

There is no single way to run an agent in a sandbox. The tracks below make different
trade-offs, and the trade-offs only become visible when you run them against the same task.
That comparison is what this repository is for.

Two tracks are built — `claude-container` and `codex-container` — and two are designs to
be verified. The wider field, including vendor-hosted agent loops and hosted sandboxes
that do not fit this lab's shape, is surveyed in [01-options.md](01-options.md).

Every track answers the same four questions differently:

1. **Who owns the loop?** Does the agent's write → run → fix cycle belong to code you wrote,
   to a framework, or to an existing product like Claude Code?
2. **Where does untrusted code run?** A model-generated `rm -rf` has to land somewhere
   harmless.
3. **Who holds the credentials?** The sandbox protects you from the model. It does not
   protect you from your own tool code.
4. **How does it reach production?** A lab that cannot ship is a toy.

## At a glance

| | `claude-container` | `codex-container` | `eve` | `harness` |
| --- | --- | --- | --- | --- |
| Status | **built, verified** | **built, verified up to the model** | design | design |
| The agent is | the Claude Agent SDK | the Codex SDK | a directory of files you author | an existing product, driven from code |
| Loop owner | Claude Code | Codex CLI | eve's default harness | Claude Code / Codex / Pi |
| Sandbox | a Docker container this repo starts | the same container | eve's backend (Docker locally, Vercel in prod) | Vercel Sandbox — **required** |
| Tools | Claude Code's built-ins + skills | shell, apply_patch, web search + skills | built-ins + your `defineTool`s | the harness's native tools |
| Custom skills | `SKILL.md` folders, mounted read-only | the same folders, read by Codex | `agent/skills/<name>/SKILL.md` | the harness's own mechanism |
| Credentials | Anthropic key, or Foundry / Bedrock / Vertex | `CODEX_API_KEY` or a ChatGPT login | per model provider | Vercel + the harness's own |
| Runs offline | yes | yes | yes (Docker backend) | no |
| Production | any Docker host, OpenShift, a VPS | the same | `eve deploy` → Vercel | Vercel |
| Maturity | Agent SDK is stable | SDK 0.x, pinned exactly | eve 0.63.0, preview | packages marked **experimental** |

## `claude-container` — you own the container

The original track and still the default. The orchestrator starts a container per session,
mounts a workspace volume and a read-only skill directory, and the runner inside speaks
`packages/protocol` to the browser.

**Choose it when** the deployment target is not Vercel: OpenShift, a customer's own
hardware, an air-gapped network. It is the only track with no external dependency beyond a
container runtime.

**The cost** is that you own the container lifecycle — startup, cleanup, resource ceilings,
isolation. That work is done here and verified, but it is yours to maintain.

Isolation, as configured: all capabilities dropped, uid 1000, `no-new-privileges`, memory
and CPU ceilings, a pid limit, a `noexec` tmpfs, an isolated bridge network, and no Docker
socket. Good against accidents, not against a determined adversary — for that, see
[gVisor](https://gvisor.dev) or a microVM.

## `codex-container` — the same container, OpenAI's agent

Built on 2026-09-22 to answer a narrower question: is the container track tied to Claude,
or does another vendor's coding agent drop into the same shape? It drops in. The
orchestrator, the terminal, the file tree and the editor are unchanged; the track is one
image (`images/runner-codex`), one translator, one row in the orchestrator's `TRACKS`
table and two entries in the model picker.

**Choose it when** the constraint is the same as for `claude-container` — your own
hardware, no Vercel — but the model has to be OpenAI's, natively, without a translation
gateway.

What was measured, rather than assumed:

- **Codex's own sandbox does not start inside a Docker container.** Codex sandboxes
  commands with bubblewrap, which needs unprivileged user namespaces, and Docker's default
  seccomp profile denies them. `read-only` and `workspace-write` both fail every command
  with `bwrap: No permissions to create a new namespace` — with this repo's hardening and
  with Docker's defaults alike. Only `danger-full-access` runs, so the track uses it and
  the container is the boundary, exactly as for Claude. `--security-opt seccomp=unconfined`
  makes Codex's sandbox work (`read-only` then really refuses writes), but only by
  weakening the container around it. Not worth the trade.
- **One process per turn.** The SDK runs `codex exec --experimental-json` for each turn and
  resumes the thread from `$CODEX_HOME/sessions`, so each turn pays the CLI startup (about
  2 s) and the state directory has to be a volume. The Claude runner keeps one subprocess
  alive for the whole session.
- **Text does not stream.** `codex exec` reports an agent message when it is complete; the
  answer appears whole. The translator handles partial updates in case a release adds them.
- **No approval channel.** `codex exec` cannot ask; the track runs with
  `approvalPolicy: "never"` and reports `permissionPrompts: false`, so the UI shows no
  approval cards. The Codex app-server protocol has approvals and streaming deltas, and is
  the upgrade path if either matters.
- **Skills work unchanged.** Codex reads user skills from `~/.agents/skills`; the
  entrypoint links the `/skills` mount there. `codex debug prompt-input` inside the
  container shows all four repo skills in the model-visible prompt — checked without a
  model call.
- **Credentials sit in the container.** Either `CODEX_API_KEY` in the environment, or a
  ChatGPT login copied from `CODEX_AUTH_FILE` into the session volume. Under
  `danger-full-access` the code the agent runs can read either — the same exposure as an
  Anthropic key in the Claude track. The real fix is a proxy that injects the credential
  outside the sandbox, which is what Docker Sandboxes does. A ChatGPT login has one more
  catch: a refresh inside the container rotates the token and can sign the host out.

Verified end to end on 2026-09-22 up to the model: the session starts, skills and the
file API work, the terminal runs as uid 1000, and a prompt reaches OpenAI with the mounted
login — which answered with the account's usage limit. That error arrives in the UI as
one `error` and one `finish`, which is the failure path working. A successful turn
could not be recorded that day; `scripts/verify-codex-translator.mjs` replays the SDK's
event shapes through the translator offline until one can.

## `eve` — the agent is files

An [eve](https://eve.dev) agent is a directory: `instructions.md`, `tools/*.ts`,
`skills/<name>/SKILL.md`, `sandbox/sandbox.ts`. eve compiles and runs it. The write → run →
fix loop is the framework default and needs no orchestration code.

**Choose it when** you want your own tools and your own skills, and Vercel is an acceptable
production target. It is the shortest path from a working local agent to a deployed one:
`eve deploy`.

**Two things to know before you trust it:**

- **`defineTool` code runs in the app runtime, not the sandbox**, with the full
  `process.env` — every secret included. This is eve's documented trust boundary. The
  sandbox protects you from a model-generated command, not from your own tool code.
- **Set the network policy on the backend factory, not only in `onSession`.** If the backend
  replaces a sandbox under the same key, `onSession` does not run again and a policy that
  lived only there silently disappears.

On Windows the backend resolves to Docker when Docker Desktop is running and to `just-bash`
otherwise. `just-bash` has no `python`, no `git`, no `pip` — the model can write a script but
cannot execute it, so the loop never closes. **If you want the loop on Windows, start Docker
Desktop.**

## `harness` — run Claude Code itself, from code

`HarnessAgent` from `@ai-sdk/harness` drives an existing agent runtime: Claude Code, Codex,
Pi, OpenCode and others. You get that product's exact behaviour — its history, its
permissions, its compaction — addressable from TypeScript.

**Choose it when** you specifically want Claude Code's behaviour rather than an agent you
authored.

**The hard constraint:** the Claude Code adapter runs a bridge *inside* the sandbox and
streams events back over a sandbox-exposed WebSocket, so it needs a network sandbox with at
least one open port. The documented sandbox provider is `@ai-sdk/sandbox-vercel`, and only
that one. **This track is therefore not self-hostable today** without writing your own
sandbox provider. That is the single most important finding in this comparison, and the
reason the track exists here: to be measured, not adopted by default.

```ts
const agent = new HarnessAgent({
  harness: claudeCode,
  model: 'claude-sonnet-4-6',
  sandbox: createVercelSandbox({ runtime: 'node24', ports: [4000] }),
});
```

## Choosing

- **Deploying to OpenShift, a VPS, or a customer's own hardware** → `claude-container`, or
  `codex-container` when the model is OpenAI's. They are the tracks that do not assume
  Vercel.
- **Deploying to Vercel, and you want your own tools** → `eve`.
- **You want Claude Code's exact behaviour and Vercel is fine** → `harness`.
- **You do not know yet** → start on `claude-container`. Its protocol boundary means moving a
  workload to another track later is a translator, not a rewrite.

## What every track must implement

`packages/protocol` is the contract. A track that satisfies it renders in the same UI as
every other, and the UI degrades from the `capabilities` field rather than guessing. Engine
specifics live in the track's translator and nowhere else.
