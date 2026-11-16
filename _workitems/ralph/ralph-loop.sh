#!/bin/bash
# Ralph Wiggum - Long-running AI agent loop for Claude Code
# Usage: _workitems/ralph/ralph-loop.sh [max_iterations] [--skip-security-check]
#
# Runs from anywhere — each iteration launches Claude Code with the repo
# ROOT as its working directory (so it picks up the root CLAUDE.md and the
# shared planning/prd/ralph skills), while reading and writing Ralph's own
# files (prd.json, progress.txt) by absolute path in this script's directory.

set -e

# Parse arguments
MAX_ITERATIONS=10
MAX_ATTEMPTS_PER_STORY="${MAX_ATTEMPTS_PER_STORY:-5}"
SKIP_SECURITY="${SKIP_SECURITY_CHECK:-false}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-security-check)
      SKIP_SECURITY="true"
      shift
      ;;
    *)
      # Assume it's max_iterations if it's a number
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        MAX_ITERATIONS="$1"
      fi
      shift
      ;;
  esac
done

# Security Pre-Flight Check
if [[ "$SKIP_SECURITY" != "true" ]]; then
  echo ""
  echo "==============================================================="
  echo "  Security Pre-Flight Check"
  echo "==============================================================="
  echo ""

  SECURITY_WARNINGS=()

  if [[ -n "${AWS_ACCESS_KEY_ID:-}" ]]; then
    SECURITY_WARNINGS+=("AWS_ACCESS_KEY_ID is set - production credentials may be exposed")
  fi

  if [[ -n "${DATABASE_URL:-}" ]]; then
    SECURITY_WARNINGS+=("DATABASE_URL is set - database credentials may be exposed")
  fi

  if [[ ${#SECURITY_WARNINGS[@]} -gt 0 ]]; then
    echo "WARNING: Potential credential exposure detected:"
    echo ""
    for warning in "${SECURITY_WARNINGS[@]}"; do
      echo "  - $warning"
    done
    echo ""
    echo "Running an autonomous agent with these credentials set could expose"
    echo "them in logs, commit messages, or API calls."
    echo ""
    echo "Unset these credentials before running an autonomous agent, or pass"
    echo "--skip-security-check if you understand the risk."
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Aborted. Unset credentials or use --skip-security-check to bypass."
      exit 1
    fi
  else
    echo "No credential exposure risks detected."
  fi
  echo ""
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || echo "$SCRIPT_DIR")"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"
ATTEMPTS_FILE="$SCRIPT_DIR/.story-attempts"
LAST_STORY_FILE="$SCRIPT_DIR/.last-story"

# The Claude Code binary. Override with RALPH_CLAUDE_BIN=/path/to/claude.
CLAUDE_BIN="${RALPH_CLAUDE_BIN:-claude}"

# Preflight: a usable Linux claude. Under WSL the first `claude` on PATH can be
# the Windows install (/mnt/c/...), which has its own login and runs its tools
# on the Windows side, so every iteration fails before doing anything.
CLAUDE_PATH="$(command -v "$CLAUDE_BIN" 2>/dev/null || true)"
if [ -z "$CLAUDE_PATH" ]; then
  echo "Error: '$CLAUDE_BIN' not found on PATH. Install Claude Code, or set RALPH_CLAUDE_BIN."
  exit 1
fi
if [[ "$CLAUDE_PATH" == /mnt/* ]]; then
  echo "Error: '$CLAUDE_BIN' resolves to a Windows install: $CLAUDE_PATH"
  echo "Install the Linux CLI in WSL (curl -fsSL https://claude.ai/install.sh | bash),"
  echo "then run 'hash -r' or open a new shell. Or set RALPH_CLAUDE_BIN."
  exit 1
fi

# Archive previous run if branch changed
if [ -f "$PRD_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
  CURRENT_BRANCH=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('branchName') or '')" "$PRD_FILE" 2>/dev/null || echo "")
  LAST_BRANCH=$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")

  if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
    # Archive the previous run
    DATE=$(date +%Y-%m-%d)
    # Strip the branch prefix (e.g. "feature/") from branch name for folder
    FOLDER_NAME=$(echo "$LAST_BRANCH" | sed 's|^[^/]*/||')
    ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"

    echo "Archiving previous run: $LAST_BRANCH"
    mkdir -p "$ARCHIVE_FOLDER"
    [ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
    [ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
    [ -f "$ATTEMPTS_FILE" ] && cp "$ATTEMPTS_FILE" "$ARCHIVE_FOLDER/"
    echo "   Archived to: $ARCHIVE_FOLDER"

    # Reset progress file for new run
    echo "# Ralph Progress Log" > "$PROGRESS_FILE"
    echo "Started: $(date)" >> "$PROGRESS_FILE"
    echo "---" >> "$PROGRESS_FILE"

    # Reset the circuit breaker. Story IDs restart at US-001 for every feature,
    # so the old counts would otherwise trip the new run's stories.
    echo "{}" > "$ATTEMPTS_FILE"
    rm -f "$LAST_STORY_FILE"
  fi
fi

# Track current branch
if [ -f "$PRD_FILE" ]; then
  CURRENT_BRANCH=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('branchName') or '')" "$PRD_FILE" 2>/dev/null || echo "")
  if [ -n "$CURRENT_BRANCH" ]; then
    echo "$CURRENT_BRANCH" > "$LAST_BRANCH_FILE"
  fi
fi

# Initialize progress file if it doesn't exist
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "# Ralph Progress Log" > "$PROGRESS_FILE"
  echo "Started: $(date)" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

# Circuit breaker: track attempts per story (files defined at the top)
if [ ! -f "$ATTEMPTS_FILE" ]; then
  echo "{}" > "$ATTEMPTS_FILE"
fi

# Function to get current story being worked on: the first one that hasn't
# passed and hasn't been skipped by the circuit breaker
get_current_story() {
  if [ -f "$PRD_FILE" ]; then
    python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(next((s['id'] for s in d['userStories'] if not s.get('passes') and not s.get('skipped')), ''))" "$PRD_FILE" 2>/dev/null
  fi
}

# Function to list the stories the circuit breaker skipped
get_skipped_stories() {
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(' '.join(s['id'] for s in d['userStories'] if not s.get('passes') and s.get('skipped')))" "$PRD_FILE" 2>/dev/null || echo ""
}

# Function to get attempts for a story
get_story_attempts() {
  local story_id="$1"
  python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], 0))" "$ATTEMPTS_FILE" "$story_id" 2>/dev/null || echo "0"
}

# Function to set the attempts for a story
set_story_attempts() {
  python3 -c "import json,sys; f=sys.argv[1]; d=json.load(open(f)); d[sys.argv[2]]=int(sys.argv[3]); json.dump(d, open(f,'w'))" "$ATTEMPTS_FILE" "$1" "$2"
}

# Function to increment attempts for a story
increment_story_attempts() {
  local story_id="$1"
  local current=$(get_story_attempts "$story_id")
  local new_count=$((current + 1))
  set_story_attempts "$story_id" "$new_count"
  echo "$new_count"
}

# Function to mark story as skipped due to max attempts
mark_story_skipped() {
  local story_id="$1"
  local max_attempts="$2"
  local note="Skipped: exceeded $max_attempts attempts without passing"
  python3 -c "import json,sys; f=sys.argv[1]; d=json.load(open(f)); [s.update(notes=sys.argv[3], skipped=True) for s in d['userStories'] if s['id']==sys.argv[2]]; json.dump(d, open(f,'w'), indent=2)" "$PRD_FILE" "$story_id" "$note"
  echo "Circuit breaker: Marked story $story_id as skipped after $max_attempts attempts"
}

# Function to check and apply circuit breaker
check_circuit_breaker() {
  local story_id="$1"
  local attempts=$(get_story_attempts "$story_id")

  if [ "$attempts" -gt "$MAX_ATTEMPTS_PER_STORY" ]; then
    echo "Circuit breaker: Story $story_id still hasn't passed after $MAX_ATTEMPTS_PER_STORY attempts"
    mark_story_skipped "$story_id" "$MAX_ATTEMPTS_PER_STORY"
    return 0  # true - circuit breaker tripped
  fi
  return 1  # false - circuit breaker not tripped
}

echo "Starting Ralph - Max iterations: $MAX_ITERATIONS - Max attempts per story: $MAX_ATTEMPTS_PER_STORY"

# Iterations count Claude Code runs only: a story the circuit breaker skips
# doesn't use one up.
i=0
while [ "$i" -lt "$MAX_ITERATIONS" ]; do
  # Get current story and check circuit breaker
  CURRENT_STORY=$(get_current_story)

  if [ -z "$CURRENT_STORY" ]; then
    SKIPPED_STORIES=$(get_skipped_stories)
    echo ""
    if [ -n "$SKIPPED_STORIES" ]; then
      echo "No runnable stories left. Skipped by the circuit breaker: $SKIPPED_STORIES"
      echo "Fix them by hand, or remove their \"skipped\" flag in $PRD_FILE and rerun."
      exit 1
    fi
    echo "All stories have passes:true. Nothing to do."
    exit 0
  fi

  # Check if this is the same story as last iteration (consecutive failure detection)
  LAST_STORY=""
  if [ -f "$LAST_STORY_FILE" ]; then
    LAST_STORY=$(cat "$LAST_STORY_FILE" 2>/dev/null || echo "")
  fi

  ATTEMPTS=$(increment_story_attempts "$CURRENT_STORY")
  if [ "$CURRENT_STORY" == "$LAST_STORY" ]; then
    echo "Consecutive attempt on story: $CURRENT_STORY"
    echo "Attempts on $CURRENT_STORY: $ATTEMPTS/$MAX_ATTEMPTS_PER_STORY"

    # Check circuit breaker
    if check_circuit_breaker "$CURRENT_STORY"; then
      echo "Skipping to next story..."
      rm -f "$LAST_STORY_FILE"
      continue
    fi
  else
    echo "Starting story: $CURRENT_STORY (attempt $ATTEMPTS/$MAX_ATTEMPTS_PER_STORY)"
  fi

  # Record current story for next iteration
  echo "$CURRENT_STORY" > "$LAST_STORY_FILE"

  i=$((i + 1))
  echo ""
  echo "==============================================================="
  echo "  Ralph Iteration $i of $MAX_ITERATIONS ($CURRENT_STORY)"
  echo "==============================================================="

  # Run Claude Code with the ralph prompt, from the repo ROOT so it loads the
  # root CLAUDE.md and shared skills. Ralph's files are passed by absolute path.
  PROMPT=$(cat <<EOF
You are running from the repo root: $REPO_ROOT
Your PRD is at: $PRD_FILE
Your progress log is at: $PROGRESS_FILE
When the instructions below say "prd.json" or "progress.txt", use those absolute paths.

$(cat "$SCRIPT_DIR/CLAUDE.md")
EOF
)
  set +e
  OUTPUT=$(set -o pipefail; (cd "$REPO_ROOT" && printf '%s' "$PROMPT" | "$CLAUDE_BIN" --dangerously-skip-permissions --print) 2>&1 | tee /dev/stderr)
  CLAUDE_STATUS=$?
  set -e

  # A run that failed outright (not logged in, bad key, API error) did no work:
  # stop rather than count it as an attempt and burn the remaining iterations.
  # The auth phrases are only checked on a short reply, so a normal run that
  # happens to mention them in its report isn't mistaken for a failure.
  OUTPUT_LINES=$(printf '%s\n' "$OUTPUT" | grep -c . || true)
  if [ "$CLAUDE_STATUS" -ne 0 ] || { [ "$OUTPUT_LINES" -le 3 ] && printf '%s' "$OUTPUT" | grep -qiE "not logged in|please run /login|invalid api key|authentication_error|credit balance is too low"; }; then
    set_story_attempts "$CURRENT_STORY" "$((ATTEMPTS - 1))"
    echo ""
    echo "Error: Claude Code failed (exit $CLAUDE_STATUS) on $CURRENT_STORY; stopping."
    echo "Fix the cause above (e.g. run '$CLAUDE_BIN' once and /login), then rerun to resume."
    exit 1
  fi

  # Check for completion signal
  if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
    echo ""
    echo "COMPLETE signal received. Verifying all stories pass..."

    # Verify all stories actually have passes:true
    INCOMPLETE_STORIES=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('\n'.join(s['id'] for s in d['userStories'] if not s.get('passes')))" "$PRD_FILE" 2>/dev/null || echo "")

    if [ -z "$INCOMPLETE_STORIES" ]; then
      echo "Verification passed: All stories have passes:true"
      echo ""
      echo "Ralph completed all tasks!"
      echo "Completed at iteration $i of $MAX_ITERATIONS"
      exit 0
    else
      echo ""
      echo "WARNING: COMPLETE claimed but verification failed!"
      echo "The following stories still have passes:false:"
      echo "$INCOMPLETE_STORIES" | while read -r story_id; do
        echo "  - $story_id"
      done
      echo ""
      echo "Continuing iteration to fix incomplete stories..."
    fi
  fi

  echo "Iteration $i complete. Continuing..."
  sleep 2
done

echo ""
echo "Ralph reached max iterations ($MAX_ITERATIONS) without completing all tasks."
echo "Check $PROGRESS_FILE for status."
exit 1
