// Uses the native WebSocket in Node 24 - no dependencies.
// Vertical slice: create a session, wait for the container to dial back, print init.

const BASE = "http://localhost:8080";

const res = await fetch(`${BASE}/api/sessions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ permissionMode: "acceptEdits" }),
});
const body = await res.json();
if (!res.ok) {
  console.log("SESSION FAIL", res.status, body);
  process.exit(1);
}
console.log("session created:", body.sessionId);

const ws = new WebSocket(`ws://localhost:8080/ws/client?session=${body.sessionId}`);
let done = false;

const timer = setTimeout(() => {
  if (!done) {
    console.log("RESULT: timed out after 120 s - no init");
    process.exit(2);
  }
}, 120_000);

ws.addEventListener("open", () => console.log("browser WS open, waiting for the runner..."));

ws.addEventListener("message", (raw) => {
  const ev = JSON.parse(raw.data);

  if (ev.type === "session.status") {
    console.log(`  [status] ${ev.status}${ev.detail ? " — " + ev.detail : ""}`);
    return;
  }

  if (ev.type === "session.init") {
    done = true;
    clearTimeout(timer);
    console.log("\nRESULT: session.init arrived from the container");
    console.log("  runner        :", ev.runner);
    console.log("  model         :", ev.model);
    console.log("  cwd           :", ev.cwd);
    console.log("  permissionMode:", ev.permissionMode);
    console.log("  skills        :", ev.skills.length);
    console.log("  slash commands :", ev.slashCommands.length);
    console.log("  tools         :", ev.tools.length);
    console.log("  capabilities  :", JSON.stringify(ev.capabilities));
    console.log("  sample        :", ev.skills.slice(0, 6).map((s) => s.name).join(", "));

    // Also exercise the file API inside the container.
    ws.send(JSON.stringify({ type: "fs.list", requestId: "r1", path: ".", depth: 2 }));
    setTimeout(() => {
      console.log("\n(siivotaan sessio)");
      fetch(`${BASE}/api/sessions/${body.sessionId}?purge=1`, { method: "DELETE" })
        .then(() => {
          // Close the socket before exiting: on Windows libuv asserts if a handle is
          // still closing when the process is torn down.
          ws.close();
          setTimeout(() => process.exit(0), 200);
        });
    }, 4000);
    return;
  }

  if (ev.type === "result") {
    console.log(`  [fs.list] ok=${ev.ok}`, ev.ok ? `root="${ev.data?.path}" children=${ev.data?.children?.length ?? 0}` : ev.error);
    return;
  }

  if (ev.type === "error") {
    console.log("  [error]", ev.code, ev.message);
  }
});

ws.addEventListener("error", (e) => {
  console.log("WS error:", e.message);
  process.exit(3);
});
