# The three tracks

There is no single way to run an agent in a sandbox. There are at least three, they make
different trade-offs, and the trade-offs only become visible when you run all three against
the same task. That comparison is what this repository is for.

Every track answers the same four questions differently:

1. **Who owns the loop?** Does the agent's write → run → fix cycle belong to code you wrote,
   to a framework, or to an existing product like Claude Code?
2. **Where does untrusted code run?** A model-generated `rm -rf` has to land somewhere
   harmless.
3. **Who holds the credentials?** The sandbox protects you from the model. It does not
   protect you from your own tool code.
4. **How does it reach production?** A lab that cannot ship is a toy.

## At a glance

| | `claude-container` | `eve` | `harness` |
| --- | --- | --- | --- |
| The agent is | the Claude Agent SDK | a directory of files you author | an existing product, driven from code |
| Loop owner | Claude Code | eve's default harness | Claude Code / Codex / Pi |
| Sandbox | a Docker container this repo starts | eve's backend (Docker locally, Vercel in prod) | Vercel Sandbox — **required** |
| Tools | Claude Code's built-ins + skills | built-ins + your `defineTool`s | the harness's native tools |
| Custom skills | `SKILL.md` folders, mounted read-only | `agent/skills/<name>/SKILL.md` | the harness's own mechanism |
| Runs offline | yes | yes (Docker backend) | no |
| Production | any Docker host, OpenShift, a VPS | `eve deploy` → Vercel | Vercel |
| Maturity | Agent SDK is stable | eve 0.63.0, preview | packages marked **experimental** |

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

- **Deploying to OpenShift, a VPS, or a customer's own hardware** → `claude-container`. It is
  the only track that does not assume Vercel.
- **Deploying to Vercel, and you want your own tools** → `eve`.
- **You want Claude Code's exact behaviour and Vercel is fine** → `harness`.
- **You do not know yet** → start on `claude-container`. Its protocol boundary means moving a
  workload to another track later is a translator, not a rewrite.

## What every track must implement

`packages/protocol` is the contract. A track that satisfies it renders in the same UI as
every other, and the UI degrades from the `capabilities` field rather than guessing. Engine
specifics live in the track's translator and nowhere else.
