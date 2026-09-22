#!/bin/sh
# Link the mounted skill library where Codex looks for user-level skills, and seed the
# ChatGPT login when the orchestrator mounted one.
#
# Codex reads user skills from ~/.agents/skills, not from $CODEX_HOME. /skills is a
# read-only mount; ~/.agents lives in the image layer, so a symlink there is fine.
set -e

SKILLS_MOUNT="${SKILLS_MOUNT:-/skills}"
TARGET="$HOME/.agents/skills"

mkdir -p "$HOME/.agents" "$CODEX_HOME"

if [ -d "$SKILLS_MOUNT" ]; then
  rm -rf "$TARGET"
  ln -s "$SKILLS_MOUNT" "$TARGET"
  count=$(find "$SKILLS_MOUNT" -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l | tr -d ' ')
  echo "[entrypoint] linked $count skills: $SKILLS_MOUNT -> $TARGET"
else
  echo "[entrypoint] WARNING: $SKILLS_MOUNT is missing, session runs without skills"
fi

# Copied, not linked: Codex rewrites auth.json when it refreshes the token, and the
# mount is read-only. The copy lives in this session's own volume.
if [ -f /run/secrets/codex-auth.json ]; then
  cp /run/secrets/codex-auth.json "$CODEX_HOME/auth.json"
  chmod 600 "$CODEX_HOME/auth.json"
  echo "[entrypoint] seeded ChatGPT login into $CODEX_HOME"
fi

mkdir -p "$WORKSPACE_DIR"
cd "$WORKSPACE_DIR"

exec "$@"
