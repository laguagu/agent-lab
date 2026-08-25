#!/bin/sh
# Link the mounted skill library where the Claude Agent SDK looks for it.
#
# /skills is a read-only mount. ~/.claude is a writable volume (it holds transcripts), so
# creating the symlink there works. Symlinks inside a container are perfectly fine — the
# problem is only with build contexts and host bind mounts.
set -e

SKILLS_MOUNT="${SKILLS_MOUNT:-/skills}"
TARGET="$HOME/.claude/skills"

mkdir -p "$HOME/.claude"

if [ -d "$SKILLS_MOUNT" ]; then
  rm -rf "$TARGET"
  ln -s "$SKILLS_MOUNT" "$TARGET"
  count=$(find "$SKILLS_MOUNT" -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l | tr -d ' ')
  echo "[entrypoint] linked $count skills: $SKILLS_MOUNT -> $TARGET"
else
  echo "[entrypoint] WARNING: $SKILLS_MOUNT is missing, session runs without skills"
  mkdir -p "$TARGET"
fi

mkdir -p "$WORKSPACE_DIR"
cd "$WORKSPACE_DIR"

exec "$@"
