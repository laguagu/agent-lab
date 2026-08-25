#!/usr/bin/env bash
# Build the skill set that gets mounted into runner containers.
#
# Layering, in order:
#   1. skills/          — committed to this repo, travels with the source. A fresh clone
#                         works with no setup at all.
#   2. $SKILLS_SRC      — optional. Your own library, overlaid on top. Never committed.
#
# The result lands in .skills-cache/, which is gitignored. Without this script the
# orchestrator falls back to skills/ directly, so running it is optional.
#
# Why an explicit copy rather than mounting a library in place:
#   Skill libraries are commonly a tree of symlinks pointing at a synced folder, and that
#   folder may itself be a junction. Docker does not follow symlinks out of the build
#   context, and bind-mounting through a junction on Docker Desktop is unreliable.
#
#   `tar -ch | tar -x` dereferences the whole chain in one pass. robocopy will NOT do: it
#   copies symlinks as symlinks. `cp -rL` chokes on cloud placeholder files.
#
# Usage:
#   bun run sync-skills                          # repo skills only
#   SKILLS_SRC=~/my-skills bun run sync-skills   # repo skills + your library

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_SKILLS="$ROOT/skills"
DST="${SKILLS_DST:-$ROOT/.skills-cache}"

rm -rf "$DST"
mkdir -p "$DST"

# --- layer 1: this repo -------------------------------------------------------
if [ -d "$REPO_SKILLS" ]; then
  tar -C "$REPO_SKILLS" -chf - . | tar -C "$DST" -xf -
  repo_count=$(find "$DST" -name SKILL.md | wc -l | tr -d ' ')
  echo "repo skills     : $repo_count  ($REPO_SKILLS)"
else
  repo_count=0
  echo "repo skills     : none ($REPO_SKILLS is missing)"
fi

# --- layer 2: your own library, if you pointed at one -------------------------
if [ -n "${SKILLS_SRC:-}" ]; then
  if [ ! -d "$SKILLS_SRC" ]; then
    echo "ERROR: SKILLS_SRC is set but not a directory: $SKILLS_SRC" >&2
    exit 1
  fi
  # -h dereferences symlinks and junctions; later files win on name collision.
  tar -C "$SKILLS_SRC" -chf - . | tar -C "$DST" -xf -
  total=$(find "$DST" -name SKILL.md | wc -l | tr -d ' ')
  echo "personal skills : $((total - repo_count))  ($SKILLS_SRC)"
else
  echo "personal skills : none (set SKILLS_SRC to overlay your own)"
fi

# --- checks -------------------------------------------------------------------
skill_count=$(find "$DST" -name SKILL.md | wc -l | tr -d ' ')
link_count=$(find "$DST" -type l | wc -l | tr -d ' ')

echo
echo "total SKILL.md  : $skill_count"
echo "symlinks left   : $link_count"
echo "size            : $(du -sh "$DST" | cut -f1)"
echo "mounted from    : $DST"

if [ "$link_count" -ne 0 ]; then
  echo "ERROR: symlinks remain in the tree — dereferencing failed." >&2
  find "$DST" -type l | head >&2
  exit 1
fi

if [ "$skill_count" -eq 0 ]; then
  echo "ERROR: no SKILL.md files found." >&2
  exit 1
fi

echo "Done."
