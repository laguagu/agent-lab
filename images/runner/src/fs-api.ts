/**
 * Workspace file operations for the editor and the file tree.
 *
 * Every path is relative to the workspace. Escaping the root is blocked by resolving
 * and comparing — the agent may only write inside its own workspace.
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { FsNode } from "@skill-lab/protocol";

const execFileAsync = promisify(execFile);

/** Directories never listed — they would drown the tree. */
const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  "__pycache__",
  ".venv",
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export class WorkspaceFs {
  // No parameter property: Node's strip-only mode rejects it
  // (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX), because it would require code generation.
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** Resolve safely inside the workspace. Throws if the path escapes the root. */
  #resolve(rel: string): string {
    const clean = rel.replace(/^\/+/, "");
    const abs = path.resolve(this.root, clean);
    const rootWithSep = this.root.endsWith(path.sep)
      ? this.root
      : this.root + path.sep;
    if (abs !== this.root && !abs.startsWith(rootWithSep)) {
      throw new Error(`Path escapes the workspace: ${rel}`);
    }
    return abs;
  }

  #rel(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join("/");
  }

  async list(rel = ".", depth = 4): Promise<FsNode> {
    const abs = this.#resolve(rel);
    return this.#walk(abs, depth);
  }

  async #walk(abs: string, depth: number): Promise<FsNode> {
    const name = path.basename(abs) || ".";
    const stat = await fs.stat(abs);

    if (!stat.isDirectory()) {
      return { name, path: this.#rel(abs), kind: "file", size: stat.size };
    }

    const node: FsNode = {
      name,
      path: this.#rel(abs) || ".",
      kind: "dir",
      children: [],
    };
    if (depth <= 0) return node;

    const entries = await fs.readdir(abs, { withFileTypes: true });
    const kept = entries
      .filter((e) => !SKIP.has(e.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    for (const e of kept) {
      const child = path.join(abs, e.name);
      if (e.isDirectory()) {
        node.children!.push(await this.#walk(child, depth - 1));
      } else if (e.isFile()) {
        const s = await fs.stat(child).catch(() => null);
        node.children!.push({
          name: e.name,
          path: this.#rel(child),
          kind: "file",
          size: s?.size,
        });
      }
    }
    return node;
  }

  async read(rel: string): Promise<{ content: string; truncated: boolean }> {
    const abs = this.#resolve(rel);
    const stat = await fs.stat(abs);
    if (stat.size > MAX_FILE_BYTES) {
      const handle = await fs.open(abs, "r");
      try {
        const buf = Buffer.alloc(MAX_FILE_BYTES);
        await handle.read(buf, 0, MAX_FILE_BYTES, 0);
        return { content: buf.toString("utf8"), truncated: true };
      } finally {
        await handle.close();
      }
    }
    return { content: await fs.readFile(abs, "utf8"), truncated: false };
  }

  async write(rel: string, content: string): Promise<{ bytes: number }> {
    const abs = this.#resolve(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return { bytes: Buffer.byteLength(content, "utf8") };
  }

  async remove(rel: string): Promise<void> {
    const abs = this.#resolve(rel);
    if (abs === this.root) throw new Error("Refusing to delete the workspace root.");
    await fs.rm(abs, { recursive: true, force: true });
  }

  /**
   * A diff for the DiffEditor. Returns the original and the current content, because
   * Monaco's DiffEditor wants two whole texts rather than a patch.
   */
  async diff(rel: string): Promise<{ original: string; modified: string }> {
    const abs = this.#resolve(rel);
    const modified = await fs.readFile(abs, "utf8").catch(() => "");

    try {
      const { stdout } = await execFileAsync(
        "git",
        ["show", `HEAD:${this.#rel(abs)}`],
        { cwd: this.root, maxBuffer: MAX_FILE_BYTES },
      );
      return { original: stdout, modified };
    } catch {
      // Not a git repo, or the file is new — the whole content is an addition.
      return { original: "", modified };
    }
  }

  /** Is the workspace a git repo? Decides whether the diff tab is shown. */
  async isGitRepo(): Promise<boolean> {
    return fs
      .stat(path.join(this.root, ".git"))
      .then(() => true)
      .catch(() => false);
  }
}
