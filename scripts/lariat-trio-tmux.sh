#!/usr/bin/env bash
# Create or attach a Codex-first trio tmux workspace for Lariat.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/lariat-trio-tmux.sh [session-name] [--attach] [--replace]

Examples:
  scripts/lariat-trio-tmux.sh
  scripts/lariat-trio-tmux.sh lariat-trio --attach
  scripts/lariat-trio-tmux.sh review-trio --replace

Behavior:
  - Creates a tmux session rooted at this repo
  - Refuses to overwrite an existing session unless --replace is passed
  - With --attach, attaches after creation (or after replacing)
  - Default session name: lariat-trio
EOF
}

SESSION_NAME="lariat-trio"
ATTACH=1
REPLACE=0

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    --attach)
      ATTACH=1
      ;;
    --replace)
      REPLACE=1
      ;;
    --detach)
      ATTACH=0
      ;;
    --*)
      echo "Unknown flag: $arg" >&2
      usage >&2
      exit 1
      ;;
    *)
      SESSION_NAME="$arg"
      ;;
  esac
done

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required but not installed." >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

HANDOFF="$REPO_ROOT/.agent-sessions/handoff.md"
mkdir -p "$REPO_ROOT/.agent-sessions"
if [[ ! -f "$HANDOFF" ]]; then
  printf '%s\n' '# Cross-tool handoff (append-only)' '' 'Policy: ../../workspace-scaffold/docs/TRIO_ORCHESTRATION.md' '' > "$HANDOFF"
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  if [[ "$REPLACE" -eq 1 ]]; then
    tmux kill-session -t "$SESSION_NAME"
  else
    echo "Session '$SESSION_NAME' already exists. Pass --replace to recreate it." >&2
    if [[ "$ATTACH" -eq 1 ]]; then
      exec tmux attach-session -t "$SESSION_NAME"
    fi
    exit 1
  fi
fi

send_cmd() {
  local target="$1"
  local command="$2"
  tmux send-keys -t "$target" C-c
  tmux send-keys -t "$target" "$command" C-m
}

start_cli() {
  local target="$1"
  local cli="$2"
  local startup="cd $(printf '%q' "$REPO_ROOT")"
  send_cmd "$target" "$startup"
  if command -v "$cli" >/dev/null 2>&1; then
    send_cmd "$target" "$cli"
  else
    send_cmd "$target" "echo '(install $cli — pane ready in $REPO_ROOT)'"
  fi
}

make_watch_loop() {
  local body="$1"
  local sleep_s="$2"
  cat <<EOF
while true; do
  clear
  $body
  sleep $sleep_s
done
EOF
}

tmux new-session -d -s "$SESSION_NAME" -n trio -c "$REPO_ROOT"
tmux split-window -h -t "$SESSION_NAME:trio" -c "$REPO_ROOT"
tmux split-window -h -t "$SESSION_NAME:trio.1" -c "$REPO_ROOT"
tmux select-layout -t "$SESSION_NAME:trio" even-horizontal

tmux select-pane -t "$SESSION_NAME:trio.0" -T "codex"
tmux select-pane -t "$SESSION_NAME:trio.1" -T "gemini"
tmux select-pane -t "$SESSION_NAME:trio.2" -T "claude"

start_cli "$SESSION_NAME:trio.0" codex
start_cli "$SESSION_NAME:trio.1" gemini
start_cli "$SESSION_NAME:trio.2" claude

tmux new-window -t "$SESSION_NAME" -n verify -c "$REPO_ROOT"
VERIFY_LOOP=$(make_watch_loop "printf 'VERIFY\n======\n'; date; printf '\n'; git status --short --branch; printf '\nSuggested checks:\n  npm run eval:assistant-prompt\n  npm run branches:list\n  npm run test:event-ops\n  npm run typecheck\n'" 12)
send_cmd "$SESSION_NAME:verify" "$VERIFY_LOOP"

tmux new-window -t "$SESSION_NAME" -n gitnexus -c "$REPO_ROOT"
send_cmd "$SESSION_NAME:gitnexus" "cd $(printf '%q' "$REPO_ROOT") && if command -v npx >/dev/null 2>&1; then npx gitnexus analyze || true; else echo 'npx not found'; fi"

tmux new-window -t "$SESSION_NAME" -n handoff -c "$REPO_ROOT"
send_cmd "$SESSION_NAME:handoff" "cd $(printf '%q' "$REPO_ROOT") && printf 'Handoff file: %s\n\n' $(printf '%q' "$HANDOFF") && tail -n 40 $(printf '%q' "$HANDOFF")"

tmux new-window -t "$SESSION_NAME" -n shell -c "$REPO_ROOT"
send_cmd "$SESSION_NAME:shell" "cd $(printf '%q' "$REPO_ROOT") && printf 'Interactive shell ready in %s\n' \"$REPO_ROOT\""

tmux select-window -t "$SESSION_NAME:trio"
tmux select-pane -t "$SESSION_NAME:trio.0"

echo "Created tmux session: $SESSION_NAME"
echo "Windows: trio | verify | gitnexus | handoff | shell"
echo "Repo: $REPO_ROOT"

if [[ "$ATTACH" -eq 1 ]]; then
  exec tmux attach-session -t "$SESSION_NAME"
fi
