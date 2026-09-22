// Uses the native WebSocket in Node 24 - no dependencies.
const PORT = process.env.ORCHESTRATOR_PORT ?? "8080";
const sid = process.argv[2];
const ws = new WebSocket(`ws://localhost:${PORT}/ws/client?session=${sid}`);
const ptyId = "t1";
let got = "";
const t = setTimeout(() => {
  console.log(got ? "RESULT: received data\n---\n" + got.slice(0, 500) : "RESULT: no data within 20 s");
  process.exit(got ? 0 : 2);
}, 20000);
ws.addEventListener("open", () => {
  console.log("WS open, opening pty");
  ws.send(JSON.stringify({ type: "pty.open", ptyId, cols: 80, rows: 24 }));
  setTimeout(() => {
    ws.send(JSON.stringify({ type: "pty.input", ptyId, data: Buffer.from("whoami && pwd && ls /skills | head -3\n").toString("base64") }));
  }, 1500);
});
ws.addEventListener("message", (raw) => {
  const ev = JSON.parse(raw.data);
  if (ev.type === "pty.output") got += Buffer.from(ev.data, "base64").toString("utf8");
  if (ev.type === "error") console.log("ERROR:", ev.code, ev.message);
});
ws.addEventListener("error", (e) => { console.log("WS error:", e.message); process.exit(3); });
