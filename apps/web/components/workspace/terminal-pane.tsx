"use client";

import { useEffect, useRef } from "react";
import type { RunnerClient } from "@/lib/runner-client";

/**
 * A browser terminal into the container.
 *
 * There is no node-pty in the container at all. The orchestrator opens a `docker exec`
 * connection in Tty mode and pipes the stream here, which keeps a native build out of
 * the image and leaves the terminal where the Docker socket already is.
 */
export function TerminalPane({
  client,
  ptyOutput,
  active,
}: {
  client: RunnerClient | null;
  ptyOutput: { ptyId: string; data: string } | null;
  active: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<{
    write: (d: string) => void;
    dispose: () => void;
    fit: () => void;
  } | null>(null);
  const ptyId = useRef(`pty-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    if (!active || !hostRef.current || termRef.current || !client) return;

    let disposed = false;

    // xterm touches window, so it loads only once the tab is opened.
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      await import("@xterm/xterm/css/xterm.css");
      if (disposed || !hostRef.current) return;

      const term = new Terminal({
        fontSize: 13,
        fontFamily:
          'ui-monospace, "Cascadia Code", "JetBrains Mono", Menlo, monospace',
        cursorBlink: true,
        theme: { background: "#00000000" },
        allowTransparency: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      fit.fit();

      term.onData((data) => {
        client.send({
          type: "pty.input",
          ptyId: ptyId.current,
          data: btoa(unescape(encodeURIComponent(data))),
        });
      });

      client.send({
        type: "pty.open",
        ptyId: ptyId.current,
        cols: term.cols,
        rows: term.rows,
      });

      const onResize = () => {
        fit.fit();
        client.send({
          type: "pty.resize",
          ptyId: ptyId.current,
          cols: term.cols,
          rows: term.rows,
        });
      };
      window.addEventListener("resize", onResize);

      termRef.current = {
        write: (d) => term.write(d),
        dispose: () => {
          window.removeEventListener("resize", onResize);
          term.dispose();
        },
        fit: () => fit.fit(),
      };
    })();

    return () => {
      disposed = true;
    };
  }, [active, client]);

  // The server sends base64, because the frames are JSON.
  useEffect(() => {
    if (!ptyOutput || ptyOutput.ptyId !== ptyId.current) return;
    termRef.current?.write(
      decodeURIComponent(escape(atob(ptyOutput.data))),
    );
  }, [ptyOutput]);

  useEffect(() => {
    if (active) termRef.current?.fit();
  }, [active]);

  useEffect(
    () => () => {
      termRef.current?.dispose();
      termRef.current = null;
    },
    [],
  );

  return <div ref={hostRef} className="h-full w-full px-2 py-1" />;
}
