// Proves the whole flow: clone a public repo into the container and list its files.
// Uses the native WebSocket in Node 24 - no dependencies.

const BASE = "http://localhost:8080";
const REPO = process.argv[2] ?? "https://github.com/sindresorhus/is-odd";

const res = await fetch(`${BASE}/api/sessions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ repoUrl: REPO }),
});
const body = await res.json();
if (!res.ok) {
  console.log("SESSION FAIL", res.status, body);
  process.exit(1);
}
console.log(`session ${body.sessionId}, malli ${body.spec.model}`);
console.log(`repo   ${REPO}`);

const ws = new WebSocket(`ws://localhost:8080/ws/client?session=${body.sessionId}`);
let listed = false;

const timer = setTimeout(() => {
  console.log("RESULT: timed out after 180 s");
  process.exit(2);
}, 180_000);

ws.addEventListener("message", (raw) => {
  const ev = JSON.parse(raw.data);

  if (ev.type === "session.status") {
    console.log(`  [${ev.status}]${ev.detail ? " " + ev.detail : ""}`);
    return;
  }

  if (ev.type === "session.init") {
    console.log(`  [init] ${ev.skills.length} skills, repo=${ev.repoUrl ?? "-"}`);
    ws.send(JSON.stringify({ type: "fs.list", requestId: "r1", path: ".", depth: 1 }));
    return;
  }

  if (ev.type === "result" && !listed) {
    listed = true;
    clearTimeout(timer);
    const names = (ev.data?.children ?? []).map((c) => c.name);
    console.log(`\nRESULT: ${names.length} entries in the workspace`);
    console.log("  " + names.join(", "));
    const ok = names.length > 0;
    console.log(ok ? "\nClone succeeded." : "\nWorkspace is empty - clone failed.");
    fetch(`${BASE}/api/sessions/${body.sessionId}?purge=1`, { method: "DELETE" }).then(
      () => {
        ws.close();
        setTimeout(() => process.exit(ok ? 0 : 3), 200);
      },
    );
    return;
  }

  if (ev.type === "error") console.log("  [error]", ev.code, ev.message);
});

ws.addEventListener("error", (e) => {
  console.log("WS-virhe:", e.message ?? e);
  process.exit(4);
});
