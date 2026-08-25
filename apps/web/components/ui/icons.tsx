"use client";

/**
 * One icon library for the whole project: lucide. Families are never mixed and no path
 * is ever hand-drawn.
 */

import {
  Braces,
  Container,
  FileCode,
  FileJson,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  GitBranch,
  Hash,
  Image,
  Lock,
  Settings,
  Sparkles,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";

const BY_NAME: Record<string, LucideIcon> = {
  dockerfile: Container,
  "docker-compose.yml": Container,
  "package.json": Braces,
  "tsconfig.json": Settings,
  ".gitignore": GitBranch,
  ".gitattributes": GitBranch,
  ".env": Lock,
  ".env.local": Lock,
  ".editorconfig": Settings,
  ".npmrc": Settings,
  license: FileText,
  "skill.md": Sparkles,
};

const BY_EXT: Record<string, LucideIcon> = {
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  mjs: FileCode,
  cjs: FileCode,
  py: FileCode,
  rs: FileCode,
  go: FileCode,
  sh: SquareTerminal,
  json: FileJson,
  yml: Settings,
  yaml: Settings,
  toml: Settings,
  md: FileText,
  mdx: FileText,
  txt: FileText,
  css: FileType,
  scss: FileType,
  html: FileType,
  png: Image,
  jpg: Image,
  jpeg: Image,
  svg: Image,
  webp: Image,
  gif: Image,
};

/** Picks an icon by filename or extension, falling back to a generic file. */
export function iconForFile(name: string): LucideIcon {
  const lower = name.toLowerCase();
  const byName = BY_NAME[lower];
  if (byName) return byName;

  const ext = lower.includes(".") ? lower.split(".").pop()! : "";
  return BY_EXT[ext] ?? Hash;
}

export function iconForDir(open: boolean): LucideIcon {
  return open ? FolderOpen : Folder;
}

export {
  Braces,
  Container,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Sparkles,
  SquareTerminal,
};
export type { LucideIcon };
