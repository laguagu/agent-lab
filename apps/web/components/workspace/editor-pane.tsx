"use client";

import dynamic from "next/dynamic";

/**
 * Monaco needs document, so it loads in the browser only.
 *
 * Next 16 forbids an ssr:false dynamic import inside a Server Component, so this wrapper
 * must itself be a client component, or the build fails.
 */
export const MonacoEditor = dynamic(
  () => import("./monaco").then((m) => m.MonacoEditor),
  { ssr: false, loading: () => <Placeholder label="editor" /> },
);

export const MonacoDiff = dynamic(
  () => import("./monaco").then((m) => m.MonacoDiff),
  { ssr: false, loading: () => <Placeholder label="diff" /> },
);

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-muted">
      Loading {label}…
    </div>
  );
}
