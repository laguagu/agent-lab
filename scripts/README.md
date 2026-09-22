# Verification scripts

Plain Node scripts, no test framework, no dependencies — they use the native `WebSocket`
in Node 24. Each exits 0 on success.

Start the orchestrator first, then:

```bash
node scripts/verify-session.mjs                 # session -> container -> skills -> file API
node scripts/verify-clone.mjs <repo-url>        # a public repo lands in the workspace
node scripts/verify-turn.mjs [repo] [prompt]    # the agent runs tools and edits files
node scripts/verify-terminal.mjs <sessionId>    # terminal over docker exec
node scripts/verify-codex-translator.mjs        # Codex event mapping, offline
```

`RUNNER=codex-container` starts the Codex track instead of the Claude one in
`verify-session` and `verify-turn`. `verify-codex-translator` needs neither the orchestrator
nor a model: it replays Codex thread events through the translator, which is the only check
of that mapping when no model is reachable.

The orchestrator scripts read `ORCHESTRATOR_PORT` and default to 8080. Node does not load `.env` on its own,
so pass the variable or use `bun run verify`, which loads the file the orchestrator uses.

`sync-skills.sh` is not a check — it materialises the skill library into `.skills-cache/`
and must run before the first session.
