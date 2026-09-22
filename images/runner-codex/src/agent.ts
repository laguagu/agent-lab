/**
 * A Codex thread driven through @openai/codex-sdk.
 *
 * The shape differs from the Claude track in one way that matters: there is no
 * long-lived subprocess. The SDK spawns `codex exec --experimental-json` once per turn
 * and resumes the thread by id, so every turn pays the CLI's startup (about 2 s on the
 * host) and conversation state lives on disk in $CODEX_HOME/sessions — which is why that
 * directory is a volume.
 */

import { Codex, type SandboxMode, type ThreadEvent } from "@openai/codex-sdk";
import type { SessionSpec } from "@agent-lab/protocol";

export type CodexAgent = {
  /** Codex's own thread id. Null until the first turn has started. */
  readonly threadId: string | null;
  readonly sandboxMode: SandboxMode;
  turn(text: string, signal: AbortSignal): AsyncGenerator<ThreadEvent>;
};

export function startAgent(spec: SessionSpec): CodexAgent {
  const sandboxMode = resolveSandboxMode();

  const codex = new Codex({
    // The same trap as the Claude SDK: `env` REPLACES the subprocess environment. Without
    // the spread PATH and HOME disappear. The runner token is the one thing held back —
    // it authenticates this container to the orchestrator and nothing the agent runs
    // needs it.
    env: withoutRunnerSecrets(process.env),
  });

  const thread = codex.startThread({
    workingDirectory: spec.cwd,
    // /workspace is a git repo only when a URL was cloned into it.
    skipGitRepoCheck: true,
    model: spec.model,
    sandboxMode,
    // `codex exec` cannot ask anyone: an approval request in non-interactive mode is a
    // turn that stalls. The sandbox mode is the only control.
    approvalPolicy: "never",
    // Only consulted under workspace-write, which otherwise denies the network — and then
    // `npm install` fails in a way the model cannot diagnose.
    networkAccessEnabled: true,
  });

  return {
    get threadId() {
      return thread.id;
    },
    sandboxMode,
    async *turn(text, signal) {
      const { events } = await thread.runStreamed(text, { signal });
      yield* events;
    },
  };
}

/**
 * Codex's own sandbox policy — `danger-full-access` unless `CODEX_SANDBOX_MODE` says
 * otherwise, whatever permission mode the session asked for.
 *
 * Measured, not assumed: Codex's Linux sandbox is bubblewrap, which needs unprivileged
 * user namespaces, and Docker's default seccomp profile denies them. Inside this
 * container `read-only` and `workspace-write` therefore fail every command with
 * "bwrap: No permissions to create a new namespace". The container is the boundary, the
 * same way it is for the Claude track. With `--security-opt seccomp=unconfined` Codex's
 * sandbox does work — at the price of weakening the container around it. See
 * docs/00-tracks.md.
 */
function resolveSandboxMode(): SandboxMode {
  const forced = process.env.CODEX_SANDBOX_MODE;
  if (forced === "read-only" || forced === "workspace-write") return forced;
  return "danger-full-access";
}

function withoutRunnerSecrets(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || k === "RUNNER_TOKEN") continue;
    out[k] = v;
  }
  return out;
}
