/**
 * Runner container lifecycle.
 *
 * This is the only module holding the Docker socket. Runner containers never see it —
 * mounting that socket is equivalent to host root.
 *
 * Containers publish NO ports. They dial out to the orchestrator, which removes
 * port allocation and behaves the same on Windows and Linux.
 */

import Docker from "dockerode";
import type { Duplex } from "node:stream";

export const LABEL_ROLE = "agent-lab.role";
export const LABEL_SESSION = "agent-lab.session";

const docker = new Docker();

export type RunnerContainerSpec = {
  sessionId: string;
  /** The track, e.g. "codex-container". Names the container. */
  runner: string;
  token: string;
  /**
   * Where the engine keeps its own state — transcripts, threads, login. A per-session
   * volume is mounted here: /home/node/.claude or /home/node/.codex.
   */
  stateDir: string;
  /** Additional host paths, as `host:container:ro` bind strings. */
  extraBinds?: string[];
  /** Host path mounted read-only at /skills. */
  skillsPath: string;
  /** WebSocket address the container uses to reach the orchestrator. */
  orchestratorWs: string;
  image: string;
  memoryMb: number;
  cpus: number;
  network?: string;
  /** Model routing and API keys, passed through as-is. */
  env: Record<string, string | undefined>;
};

export async function pingDocker(): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

export async function ensureNetwork(name: string): Promise<void> {
  const nets = await docker.listNetworks({
    filters: JSON.stringify({ name: [name] }),
  });
  if (nets.some((n) => n.Name === name)) return;
  await docker.createNetwork({ Name: name, Driver: "bridge" });
}

function volumeNames(sessionId: string) {
  return {
    workspace: `agent-lab-ws-${sessionId}`,
    state: `agent-lab-state-${sessionId}`,
  };
}

export async function createRunner(
  spec: RunnerContainerSpec,
): Promise<Docker.Container> {
  const vols = volumeNames(spec.sessionId);
  for (const name of Object.values(vols)) {
    await docker
      .createVolume({ Name: name, Labels: { [LABEL_SESSION]: spec.sessionId } })
      .catch(() => {});
  }

  const env = Object.entries({
    SESSION_ID: spec.sessionId,
    RUNNER_TOKEN: spec.token,
    ORCHESTRATOR_WS: spec.orchestratorWs,
    WORKSPACE_DIR: "/workspace",
    SKILLS_MOUNT: "/skills",
    ...spec.env,
  })
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`);

  const container = await docker.createContainer({
    Image: spec.image,
    name: `agent-lab-${spec.runner}-${spec.sessionId}`,
    Labels: { [LABEL_ROLE]: "runner", [LABEL_SESSION]: spec.sessionId },
    Env: env,
    WorkingDir: "/workspace",
    Tty: false,
    HostConfig: {
      // Hardening. The root fs cannot be read-only: the agent writes to its workspace,
      // and the state directory needs to hold transcripts.
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      Memory: spec.memoryMb * 1024 * 1024,
      NanoCpus: Math.round(spec.cpus * 1e9),
      // 256 rather than 100: a skill running `npm install` forks generously.
      PidsLimit: 256,
      Binds: [
        `${vols.workspace}:/workspace`,
        `${vols.state}:${spec.stateDir}`,
        `${spec.skillsPath}:/skills:ro`,
        ...(spec.extraBinds ?? []),
      ],
      Tmpfs: { "/tmp": "rw,nosuid,size=256m" },
      // The orchestrator owns the restart policy so cost and turns stay attributable.
      // A container never restarts itself.
      RestartPolicy: { Name: "no" },
      ...(spec.network ? { NetworkMode: spec.network } : {}),
      ExtraHosts: ["host.docker.internal:host-gateway"],
    },
  });

  await container.start();
  return container;
}

export async function stopRunner(sessionId: string): Promise<void> {
  const list = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${LABEL_SESSION}=${sessionId}`] }),
  });
  for (const info of list) {
    const c = docker.getContainer(info.Id);
    await c.stop({ t: 5 }).catch(() => {});
    await c.remove({ force: true }).catch(() => {});
  }
}

/** Also removes the volumes. The workspace is lost permanently. */
export async function destroySession(sessionId: string): Promise<void> {
  await stopRunner(sessionId);
  for (const name of Object.values(volumeNames(sessionId))) {
    await docker.getVolume(name).remove().catch(() => {});
  }
}

export type TerminalHandle = {
  stream: Duplex;
  resize(cols: number, rows: number): Promise<void>;
  close(): void;
};

/**
 * An interactive shell into the container over docker exec.
 *
 * Why this instead of node-pty in the runner: node-pty is a native module needing
 * python3/make/g++ at image build time. docker exec with Tty gives the same duplex
 * stream with no native build at all, and the orchestrator already holds the socket.
 */
export async function openTerminal(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<TerminalHandle> {
  const list = await docker.listContainers({
    filters: JSON.stringify({ label: [`${LABEL_SESSION}=${sessionId}`] }),
  });
  const info = list[0];
  if (!info) throw new Error(`No running container for session ${sessionId}`);

  const container = docker.getContainer(info.Id);
  const exec = await container.exec({
    Cmd: ["/bin/bash", "-l"],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    WorkingDir: "/workspace",
  });

  const stream = (await exec.start({ hijack: true, stdin: true })) as Duplex;
  await exec.resize({ h: rows, w: cols }).catch(() => {});

  return {
    stream,
    resize: async (c, r) => {
      await exec.resize({ h: r, w: c }).catch(() => {});
    },
    close: () => stream.end(),
  };
}

/** Removes every runner container. Called at startup to clear orphans. */
export async function reapOrphans(): Promise<number> {
  const list = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${LABEL_ROLE}=runner`] }),
  });
  for (const info of list) {
    await docker.getContainer(info.Id).remove({ force: true }).catch(() => {});
  }
  return list.length;
}
