/**
 * Workspace setup before the agent starts.
 *
 * Without this /workspace is empty and the agent has nothing to read or edit — which
 * makes the whole UI incomprehensible. Cloning gives it a subject.
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Only http(s) and git@ are accepted — no file paths, no other schemes. */
export function isPlausibleRepoUrl(url: string): boolean {
  if (/^https?:\/\/[^\s]+$/i.test(url)) return true;
  if (/^git@[\w.-]+:[\w./-]+$/i.test(url)) return true;
  return false;
}

export type CloneResult =
  | { ok: true; files: number; branch: string }
  | { ok: false; error: string };

export async function cloneInto(
  repoUrl: string,
  dir: string,
): Promise<CloneResult> {
  if (!isPlausibleRepoUrl(repoUrl)) {
    return { ok: false, error: `Invalid repository URL: ${repoUrl}` };
  }

  // Cloning into an existing directory: /workspace is a volume and already exists.
  const entries = await fs.readdir(dir).catch(() => []);
  if (entries.length > 0) {
    return { ok: false, error: "Workspace is not empty, skipped cloning" };
  }

  try {
    // --depth 1 is enough: this is a workspace, not an archive. No submodules by default.
    await execFileAsync("git", ["clone", "--depth", "1", repoUrl, "."], {
      cwd: dir,
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        // Without this git blocks waiting for a username when the repo does not exist
        // or is private, and the clone hangs until the timeout.
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "",
        GCM_INTERACTIVE: "never",
      },
    });

    const [{ stdout: branch }, files] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir }),
      fs.readdir(dir).then((e) => e.length),
    ]);

    return { ok: true, files, branch: branch.trim() };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    // Git writes the error to stderr; that is the more informative message.
    const raw = (e.stderr ?? e.message ?? String(err)).trim();
    return { ok: false, error: raw.split("\n").slice(-2).join(" ").slice(0, 300) };
  }
}
