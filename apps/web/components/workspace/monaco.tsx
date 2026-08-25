"use client";

import { DiffEditor, Editor } from "@monaco-editor/react";

const OPTIONS = {
  fontSize: 13,
  fontFamily:
    'ui-monospace, "Cascadia Code", "JetBrains Mono", Menlo, monospace',
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  renderLineHighlight: "none" as const,
  padding: { top: 12, bottom: 12 },
  automaticLayout: true,
};

export function MonacoEditor({
  path,
  value,
  onChange,
}: {
  path: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Editor
      path={path}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      theme="vs-dark"
      options={OPTIONS}
      loading={<span className="p-4 text-muted">Loading editor…</span>}
    />
  );
}

export function MonacoDiff({
  original,
  modified,
  language,
}: {
  original: string;
  modified: string;
  language?: string;
}) {
  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={language}
      theme="vs-dark"
      options={{ ...OPTIONS, readOnly: true, renderSideBySide: false }}
      loading={<span className="p-4 text-muted">Loading diff…</span>}
    />
  );
}
