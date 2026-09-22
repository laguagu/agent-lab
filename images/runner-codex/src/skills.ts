/**
 * Skill discovery for the session.init event.
 *
 * The Codex SDK has no call that lists the skills Codex found — the app-server protocol
 * does, `codex exec` does not. Codex reads the same SKILL.md files from the same mount,
 * so reading their frontmatter here gives the UI the list Codex will see, before the
 * first turn and without a model call.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export type SkillInfo = { name: string; description: string; path: string };

export async function scanSkills(root: string): Promise<SkillInfo[]> {
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const out: SkillInfo[] = [];
  for (const d of dirs) {
    if (d.name.startsWith(".")) continue;
    const file = path.join(root, d.name, "SKILL.md");
    const raw = await fs.readFile(file, "utf8").catch(() => null);
    if (raw === null) continue;
    const fm = frontmatter(raw);
    out.push({
      name: fm.name || d.name,
      description: fm.description,
      path: path.join(root, d.name),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** `name` and `description` only. Handles quoted scalars and `>` / `|` block scalars. */
function frontmatter(raw: string): { name: string; description: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { name: "", description: "" };
  const lines = m[1].split(/\r?\n/);
  const field = (key: string): string => {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (i < 0) return "";
    const value = lines[i].slice(key.length + 1).trim();
    if (/^[>|][-+]?$/.test(value)) {
      const block: string[] = [];
      for (const l of lines.slice(i + 1)) {
        if (l.trim() && !/^\s/.test(l)) break;
        block.push(l.trim());
      }
      return block.join(" ").trim();
    }
    return value.replace(/^["']|["']$/g, "");
  };
  return { name: field("name"), description: field("description") };
}
