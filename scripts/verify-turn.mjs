// Proves the agent actually answers and touches files.
// Clones a repo, asks for one concrete task, follows the tool calls.

const BASE = "http://localhost:8080";
const REPO = process.argv[2] ?? "https://github.com/octocat/Hello-World";
const PROMPT =
  process.argv[3] ??
  "Read the README and write a NOTES.md next to it with a one-sentence summary. Do not ask for permission.";

const res = await fetch(`${BASE}/api/sessions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ repoUrl: REPO, permissionMode: "bypassPermissions" }),
});
const body = await res.json();
if (!res.ok) {
  console.log("SESSION FAIL", res.status, body);
  process.exit(1);
}
console.log(`session ${body.sessionId}, model ${body.spec.model}\n`);

const ws = new WebSocket(`ws://localhost:8080/ws/client?session=${body.sessionId}`);
let text = "";
const tools = [];
let finished = false;

const timer = setTimeout(() => {
  console.log("\nRESULT: timed out after 240 s");
  cleanup(2);
}, 240_000);

function cleanup(code) {
  clearTimeout(timer);
  fetch(`${BASE}/api/sessions/${body.sessionId}?purge=1`, { method: "DELETE" })
    .catch(() => {})
    .then(() => {
      ws.close();
      setTimeout(() => process.exit(code), 200);
    });
}

ws.addEventListener("message", (raw) => {
  const ev = JSON.parse(raw.data);

  switch (ev.type) {
    case "session.status":
      if (ev.detail) console.log(`  [${ev.status}] ${ev.detail}`);
      return;

    case "session.init":
      console.log(`  [init] ${ev.skills.length} skills\n  sending: ${PROMPT}\n`);
      ws.send(JSON.stringify({ type: "prompt", text: PROMPT }));
      return;

    case "tool.start":
      tools.push(ev.toolName);
      process.stdout.write(`  [${ev.toolName}]`);
      return;

    case "tool.result":
      process.stdout.write(" ok\n");
      return;

    case "tool.error":
      process.stdout.write(` ERROR: ${String(ev.errorText).slice(0, 100)}\n`);
      return;

    case "text.delta":
      text += ev.delta;
      return;

    case "error":
      console.log(`\n  [error] ${ev.code}: ${ev.message}`);
      return;

    case "finish": {
      if (finished) return;
      finished = true;
      console.log(`\n--- answer ---\n${text.trim().slice(0, 600)}`);
      console.log(`\nTool calls: ${tools.length} (${[...new Set(tools)].join(", ")})`);
      console.log(`Turns: ${ev.turns}, cost: $${ev.totalCostUsd?.toFixed?.(4) ?? "0"}`);
      const ok = text.trim().length > 0 && !text.includes("Credit balance");
      console.log(ok ? "\nThe agent answered." : "\nThe agent did NOT answer.");
      cleanup(ok ? 0 : 3);
      return;
    }
  }
});

ws.addEventListener("error", (e) => {
  console.log("WS error:", e.message ?? e);
  process.exit(4);
});
