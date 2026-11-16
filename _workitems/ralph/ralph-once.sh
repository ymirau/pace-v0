#!/bin/bash
# ralph-once.sh — run a SINGLE Ralph iteration (no loop, no circuit breaker).
# Usage: _workitems/ralph/ralph-once.sh
#
# Like ralph-loop.sh, this launches Claude Code from the repo ROOT (so it
# loads the root CLAUDE.md and shared skills) and points it at Ralph's files by
# absolute path. Use it to hand-step one story at a time; use ralph-loop.sh to
# run unattended.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || echo "$SCRIPT_DIR")"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"

cd "$REPO_ROOT"
claude --permission-mode acceptEdits -p "@$PRD_FILE @$PROGRESS_FILE
1. Find the highest-priority feature with passes:false and work only on that feature.
2. Run the project's own quality gates (typecheck, lint, tests — whatever the target app uses).
3. Update prd.json — only change 'passes' to true for the completed feature.
4. Append your progress to progress.txt. Use this to leave a note for the next iteration.
5. Make a git commit of that feature.
ONLY work on a single feature.
If all features in prd.json have passes:true, output <promise>COMPLETE</promise>."
