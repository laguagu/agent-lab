// Replays Codex thread events through the codex-container translator — offline, no model,
// no container. The one check that still runs when no model is reachable.
//
// Two sequences:
// - FAILED was recorded from a real run on 2026-09-22 — a ChatGPT plan at its usage
//   limit — with the limit message shortened.
// - SUCCEEDED follows @openai/codex-sdk 0.155.1's own types. No successful turn could be
//   recorded that day, so it proves the mapping, not Codex's behaviour. Replace it with a
//   recording (see probe notes in docs/01-options.md) once a turn has run for real.
//
// Node strips the types from translate.ts itself; it has no runtime imports.

import assert from "node:assert/strict";
import { Translator } from "../images/runner-codex/src/translate.ts";

const FAILED = [
  { type: "thread.started", thread_id: "01a0ca23-5f56-7d33-8340-8994c0dac497" },
  { type: "turn.started" },
  {
    type: "item.completed",
    item: {
      id: "item_0",
      type: "error",
      message:
        "Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.",
    },
  },
  { type: "error", message: "You’ve hit your usage limit." },
  { type: "turn.failed", error: { message: "You’ve hit your usage limit." } },
];

const cmd = (id, command, extra) => ({
  id,
  type: "command_execution",
  command,
  aggregated_output: "",
  status: "in_progress",
  ...extra,
});

const SUCCEEDED = [
  { type: "thread.started", thread_id: "t1" },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "r0", type: "reasoning", text: "Read the README first." } },
  { type: "item.started", item: cmd("c1", "bash -lc 'cat README'") },
  {
    type: "item.completed",
    item: cmd("c1", "bash -lc 'cat README'", {
      aggregated_output: "Hello World!\n",
      exit_code: 0,
      status: "completed",
    }),
  },
  { type: "item.started", item: cmd("c2", "bash -lc 'node missing.js'") },
  {
    type: "item.completed",
    item: cmd("c2", "bash -lc 'node missing.js'", {
      aggregated_output: "Error: Cannot find module '/workspace/missing.js'\n",
      exit_code: 1,
      status: "failed",
    }),
  },
  {
    type: "item.completed",
    item: {
      id: "p1",
      type: "file_change",
      changes: [{ path: "/workspace/NOTES.md", kind: "add" }],
      status: "completed",
    },
  },
  { type: "item.started", item: { id: "m1", type: "agent_message", text: "Wrote " } },
  { type: "item.updated", item: { id: "m1", type: "agent_message", text: "Wrote NOTES.md" } },
  { type: "item.completed", item: { id: "m1", type: "agent_message", text: "Wrote NOTES.md." } },
  {
    type: "turn.completed",
    usage: {
      input_tokens: 1200,
      cached_input_tokens: 800,
      cache_write_input_tokens: 0,
      output_tokens: 90,
      reasoning_output_tokens: 40,
    },
  },
];

function replay(events, after) {
  const t = new Translator();
  t.beginTurn();
  const out = events.flatMap((ev) => t.translate(ev));
  if (after) out.push(...after(t));
  return out;
}

const only = (out, type) => out.filter((e) => e.type === type);

// --- the recorded failure: one error, one finish, nothing more -------------------
{
  // The SDK throws after turn.failed when codex exits 1; the runner then calls fail().
  const out = replay(FAILED, (t) => t.fail("Codex Exec exited with code 1"));
  assert.equal(only(out, "error").length, 1, "exactly one error event");
  assert.equal(only(out, "error")[0].message, "You’ve hit your usage limit.");
  assert.deepEqual(only(out, "finish").map((e) => e.reason), ["error"]);
  assert.equal(out.at(-1).status, "awaiting-input");
  // The non-fatal error item is a status line, not a failure.
  assert.match(only(out, "session.status")[0].detail, /Skill descriptions/);
  console.log("ok  recorded failure  ->", out.map((e) => e.type).join(", "));
}

// --- the success mapping ----------------------------------------------------------
{
  const out = replay(SUCCEEDED);

  const starts = only(out, "tool.start");
  assert.deepEqual(
    starts.map((e) => [e.toolName, e.kind, e.title]),
    [
      ["shell", "bash", "cat README"],
      ["shell", "bash", "node missing.js"],
      ["apply_patch", "edit", "NOTES.md"],
    ],
    "one tool.start per item, shell wrapper stripped from the title",
  );

  assert.equal(only(out, "tool.result")[0].output, "Hello World!\n");
  const err = only(out, "tool.error")[0];
  assert.equal(err.toolCallId, "c2");
  assert.match(err.errorText, /Cannot find module[\s\S]*\[exit 1\]$/, "stderr and exit code kept");

  assert.deepEqual(
    only(out, "file.changed").map((e) => [e.path, e.op]),
    [["NOTES.md", "create"]],
    "patch paths made workspace-relative",
  );
  assert.ok(only(out, "file.tree-invalidated").length >= 3, "every command invalidates the tree");

  assert.deepEqual(
    only(out, "text.delta").map((e) => e.delta),
    ["Wrote ", "NOTES.md", "."],
    "updates yield only the new suffix",
  );
  assert.equal(only(out, "text.start").length, 1);
  assert.equal(only(out, "text.end").length, 1);
  assert.equal(only(out, "reasoning.delta")[0].delta, "Read the README first.");

  const usage = only(out, "usage")[0];
  assert.equal(usage.inputTokens, 1200);
  assert.equal(usage.cacheReadTokens, 800);
  assert.deepEqual(only(out, "finish").map((e) => e.reason), ["end_turn"]);
  assert.equal(out.at(-1).status, "awaiting-input");
  console.log(`ok  success mapping   -> ${out.length} events, ${starts.length} tool calls`);
}

// --- interrupt ----------------------------------------------------------------------
{
  const out = replay(SUCCEEDED.slice(0, 4), (t) => [...t.stopped(), ...t.fail("aborted")]);
  assert.deepEqual(only(out, "finish").map((e) => e.reason), ["stopped"], "abort finishes once");
  assert.equal(only(out, "error").length, 0, "an interrupt is not an error");
  console.log("ok  interrupt         -> finish(stopped), no error");
}

console.log("\nThe codex-container translator maps all three sequences.");
