---
name: code-agent-sandboxes
description: Choose how to run an agent that writes and executes code — which framework, which Python/bash sandbox, and which deployment target. Use whenever a task involves an agent running generated code, a `run_python` or code-interpreter tool, a data-analysis agent, or a coding agent that edits files and runs tests, and whenever the question is where that code should execute — CSC Rahti/OpenShift, Vercel, a VPS, a customer's own hardware, or a hosted sandbox API. Triggers on "sandbox agent", "aja python koodia", "koodiagentti", "code interpreter", "run_python", "E2B", "Daytona", "Modal", "Vercel Sandbox", "code execution tool", "OpenHands", "smolagents", "agentti joka ajaa koodia", "miten ajan agenttia kontissa", and on any question of the form "which framework should I use for an agent that ...". Also use when reviewing an existing agent that executes code, to check its isolation and credential exposure.
---

# Running an agent that executes code

Most of this decision is made for you by one fact, and people usually discover it last.
Establish it first:

**Where does the generated code run, and who owns that machine?**

Every other choice — framework, sandbox product, isolation strength, cost model — follows
from the answer. Ask it before recommending anything.

The second question is nearly as load-bearing: **is the code the agent runs going to touch
data or credentials that matter?** An agent summarising a public CSV needs far less than one
with a database password in its environment.

## Step 1 — check whether a sandbox is needed at all

The cheapest sandbox is someone else's. Before designing infrastructure, check whether a
server-side execution tool covers the job, because it removes the entire problem:

| Route | Where the code runs | Good for | Rules it out |
| --- | --- | --- | --- |
| **Anthropic `code_execution`** | Anthropic's container, server-side | Data analysis, chart generation, file transforms | Code must reach your private network or DB |
| **OpenAI code interpreter** | OpenAI's container | Same | Same |
| **Hosted sandbox API** (E2B, Daytona, Modal, Vercel Sandbox) | vendor's microVM/container, your orchestration | Long sessions, custom images, pip installs | No egress allowed from your host, or data cannot leave your jurisdiction |
| **Your own container** | your pod/VM | Data residency, private network access, air-gapped | You now own lifecycle, isolation and cleanup |

Two facts that change the answer more often than expected:

- **Anthropic's `code_execution` tool is available through Microsoft Azure AI Foundry**, not
  only the Anthropic API — it needs a *Hosted on Anthropic* deployment. It is **not** on
  Bedrock or Vertex. For an org already standardised on Azure this is frequently the whole
  answer: no sandbox to build, no container to operate. Verify current availability at
  [docs.anthropic.com/en/docs/agents-and-tools/tool-use/code-execution-tool](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/code-execution-tool)
  before committing — the provider matrix moves.
- **Server-side containers are ephemeral.** Files do not survive between API calls unless the
  REPL-persistence tool version is used, and even then only inside one conversation. Anything
  the user needs has to be pulled out of the response and stored. Plan the extraction, not
  just the execution.

If none of these fit, keep going.

## Step 2 — the deployment target eliminates most options

This is where most plans break, because sandbox vendors assume a cloud VM and enterprise
platforms do not provide one.

| Target | What is available | What is not |
| --- | --- | --- |
| **CSC Rahti / OpenShift** | Container-level isolation; pod-per-session via the OpenShift API; outbound calls to hosted sandbox APIs | **No `/dev/kvm`, no privileged containers, no Docker socket, arbitrary UID** |
| **Vercel** | Vercel Sandbox (Firecracker microVM), the AI SDK harnesses | Long-lived stateful orchestration; anything needing a persistent daemon |
| **VPS / own Docker host** | Everything — Docker socket, KVM if the host allows nested virt | Managed scaling; someone else carrying the ops |
| **Customer hardware / air-gapped** | Container isolation; local models | Every hosted sandbox API; usually the model API too |

**The Rahti constraint deserves emphasis because it is silent.** Firecracker-based sandboxes
(E2B self-hosted, Vercel Sandbox) need `/dev/kvm`, and OpenShift's SCC will not grant it.
Likewise, any design where a service spawns sibling containers through the Docker socket —
the pattern OpenHands and most local agent labs use — is dead on OpenShift. The translation
that *does* work is **one Job or Pod per session created through the Kubernetes API**, using a
ServiceAccount granted `create pods` in its own namespace. Namespace admin can grant that,
but confirm it against the cluster before designing around it.

Note what is still open on Rahti: **egress works**, so calling E2B, Daytona or Modal from a
Rahti pod is perfectly viable. The question then becomes whether the data may leave CSC.

## Step 3 — pick the framework, not the biggest one

Three shapes, and the mistake is nearly always reaching for the heaviest:

**A platform** — OpenHands is the established self-hostable one: web UI, conversation
handling, sandboxed runtimes, GitHub integration, and an Agent Server that can run ephemeral
Kubernetes sandboxes. Choose it when you want a *product* for engineers to use, and accept
that you now operate a multi-component stack whose sandbox image version must track the app
version.

**A framework you build a loop with** — the AI SDK's `ToolLoopAgent` (TypeScript) or
smolagents' `CodeAgent` (Python, writes Python instead of JSON tool calls). Choose this when
the agent is a *feature inside your application* rather than a standalone product. For most
"my app needs an agent that can run Python" tasks, this is the right size, and the whole
implementation is one tool definition plus a sandbox client.

**An existing harness, driven from code** — `HarnessAgent` with the Claude Code or Codex
adapter gives you that product's exact behaviour from TypeScript. The catch is structural:
the Claude Code adapter runs a bridge inside the sandbox and streams over an exposed port, so
it requires a network sandbox with open ports, and the documented provider is Vercel's. It is
not self-hostable without writing a sandbox provider.

Before authoring any tool, check what the vendor's own SDK already hosts. Staying inside
Anthropic's or OpenAI's framework unlocks a set of server-side tools — code execution, web
search and fetch, file handling, computer use — that run on their infrastructure and need no
sandbox, no container and no code from you beyond enabling them. Enumerating them here would
rot, so read the provider's tool-use documentation before writing a `run_python` or a web
fetcher by hand. The trade is the one in Step 1: convenience and zero ops against code that
cannot reach your private network, and data that leaves your perimeter.

Match the model route to the framework before committing: the Claude Agent SDK speaks only
the Anthropic Messages format, so pointing it at Azure OpenAI or Gemini requires a translation
gateway (LiteLLM) as an extra component. The AI SDK and anything OpenAI-compatible avoid that
entirely. An extra pod purely to reshape JSON is a real cost, in both ops and billing.

## Step 4 — if the code runs in your own process or pod

This is the common minimum — a `run_python` tool that shells out inside the same container —
and it has one failure mode that dominates all others:

**The model-generated code inherits your environment, so it can read every secret you hold.**
`os.environ` is one line. The sandbox protects you from a bad command; it does not protect you
from your own process's credentials. So:

- Spawn the subprocess with an **explicit minimal environment**, never by inheriting the
  parent's. In Node's `spawn` and the TypeScript SDKs the `env` option *replaces* rather than
  merges, which is the behaviour you want here — but it also means `PATH` disappears unless
  you set it deliberately.
- Give it a scratch directory it owns and nothing above it.
- Set a wall-clock timeout. An agent that writes `while True` otherwise holds the pod.
- Add a network policy denying egress except the model endpoint, so generated code cannot
  call home with what it found.

With those four in place, an in-pod subprocess is a reasonable boundary against *accidents* —
a model that deletes the wrong file or loops forever. It is not a boundary against an
adversary who controls the prompt. If untrusted input reaches the agent, you need process- or
kernel-level isolation, which means a separate pod, a hosted sandbox, or a microVM.

## Step 5 — the contract the execution tool must satisfy

Whichever route is chosen, the write → run → fix loop closes only if the tool hands the model
enough to diagnose its own failure. This is where implementations quietly break, because the
tool looks like it works — code runs, output appears — while the agent is unable to recover
from an error it caused.

The contract, independent of language and vendor:

- **Return stdout, stderr and the exit code as three separate fields, verbatim.** The loop
  runs on the error text. A tool that returns only stdout, or that collapses a traceback into
  "execution failed", leaves the model guessing and it will retry the same broken code.
- **Truncate long output from the middle, not the end.** A Python traceback puts the exception
  type and message last; tail-truncation throws away the only line that matters.
- **Report a timeout as a distinct outcome from a non-zero exit.** They call for different
  responses — shrink the work versus fix the code — and a model told only "failed" cannot
  tell them apart.
- **State whether the working directory persists between calls, and mean it.** An agent that
  assumes persistence writes a file on turn 1 and reads it on turn 3. Both persistent and
  ephemeral are fine; silence is not.
- **Give artifacts a retrieval path.** "Saved chart.png" is worthless if nothing can fetch the
  bytes back out of the sandbox.
- **Cap the turns and surface the cap.** An unbounded "keep retrying until it works" is how a
  single request becomes dozens of round-trips against a dependency that was never going to
  install.

On validation specifically — exit code 0 is not evidence the work is correct, only that
nothing crashed. If the task has a checkable result, have the agent write the check as code
(an assertion, an expected row count, a reconciled total) and run it in the same sandbox. A
model grading its own prose output is far weaker evidence than a failing assert.

## Choosing between hosted sandbox vendors

If a hosted sandbox is the answer, the differences that actually decide it:

- **Isolation model.** Firecracker microVM (own kernel) versus a shared-kernel container.
  Container-by-default is fine for code you mostly trust and weak for arbitrary model output.
- **Billing model beats the hourly rate.** Some vendors bill wall-clock session length,
  others only active CPU. For bursty work — a sandbox alive for minutes but computing for
  seconds — that distinction moves the bill by an order of magnitude, far more than the
  headline per-hour rate does. Model your own session-length-versus-CPU-seconds pattern
  before comparing prices at all.
- **Cold start**, if a user is waiting on the first call.
- **GPU inside the sandbox**, which as of this writing narrows the field to roughly one
  vendor — check, rather than assuming a vendor has added it.
- **Self-hosting reality.** "Open source" rarely means `helm install`: the mature self-host
  path here is a Terraform/Nomad/Consul/Firecracker stack with a Postgres dependency, not a
  Kubernetes deployment. Treat self-hosting a sandbox platform as an infrastructure project
  with its own running cost, and compare that honestly against the managed bill.

Re-check figures at the vendor's own pricing page before quoting any of them; this space
reprices often.

## Gotchas

- **`/dev/kvm` is the hidden requirement.** Any "microVM isolation" claim implies it. On
  OpenShift, managed Kubernetes without nested virtualisation, and most CI runners, it is
  unavailable — and the failure appears at runtime as a sandbox that will not start, not at
  design time.
- **The Docker-socket pattern does not port to Kubernetes.** A design where the app spawns
  sibling containers must be rewritten to create Jobs through the API. This is usually one
  module, not a rewrite, if the session lifecycle was already behind an interface.
- **Server-side execution tools do not share state with your own tools.** Combining a hosted
  `code_execution` with a client-side `bash` tool gives two separate filesystems; outputs must
  be passed explicitly. Agents get this wrong silently and produce confident nonsense about
  files that exist in the other environment.
- **A self-hosted agent is not a self-hosted brain.** Unless open-weight models are also
  served locally, self-hosting buys execution and custody, not independence from the model
  vendor. Say this out loud when data residency is the stated reason.
- **Billing on request, not usage.** On CSC Rahti the charge is `max(request, actual)`, so an
  over-generous `resources` block bills around the clock for an idle agent pod. Size it to
  measured usage.
- **Route timeouts cut long agent turns.** An OpenShift Route defaults to a 30-second HAProxy
  timeout; an agent loop or an SSE progress stream is cut off there, surfacing as a generic
  504. Raise the per-Route timeout and emit heartbeats well inside it.

## What this repository already provides

This skill ships inside Agent Lab, so when it is read with the repo in context, check what
exists before building anything:

- `docs/00-tracks.md` is the concrete counterpart to Step 2 and Step 3 above — three ways of
  running a sandboxed agent, with what each one costs. Read it before choosing a track.
- `packages/protocol` is the engine-agnostic contract. A new way of running an agent should
  implement `RunnerEvent` / `RunnerCommand` rather than grow its own UI; the browser UI,
  file tree, editor and terminal then work for free.
- `services/orchestrator/src/docker.ts` is the session lifecycle behind an interface. A
  Kubernetes/OpenShift target is a sibling module here, not a rewrite.
- `images/runner-claude` is a worked example of an engine that satisfies the contract.

The repo is the lab; it is deliberately not a finished product. Only the
`claude-container` track is built, so treat the other two as designs to be verified rather
than as working code.

## Related skills

Deployment and SDK detail lives elsewhere and may not be installed — `csc-rahti`
(Rahti/OpenShift manifests, images, secrets), `ai-sdk-7` (`ToolLoopAgent`, `HarnessAgent`),
`openai-agents-sdk` (the Python equivalent), `claude-api` (`code_execution` parameters and
pricing). Fall back to the vendor's own documentation when they are absent.
