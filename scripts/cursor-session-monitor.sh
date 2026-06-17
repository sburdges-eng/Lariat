#!/usr/bin/env bash
# Babysit tmux + Claude sessions and PR CI for a fixed window.
# Usage: scripts/cursor-session-monitor.sh [duration_sec] [interval_sec]
# Log: .agent-sessions/cursor-monitor.log (append)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

DURATION="${1:-5400}"   # 90 minutes
INTERVAL="${2:-300}"    # 5 minutes
LOG="$REPO_ROOT/.agent-sessions/cursor-monitor.log"
PR="${MONITOR_PR:-340}"
mkdir -p "$REPO_ROOT/.agent-sessions"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
}

alert() {
  log "ALERT: $*"
}

capture_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    log "tmux: not installed"
    return
  fi
  local sessions
  sessions="$(tmux list-sessions -F '#{session_name}' 2>/dev/null || true)"
  if [[ -z "$sessions" ]]; then
    log "tmux: no sessions"
    return
  fi
  while IFS= read -r s; do
    [[ -z "$s" ]] && continue
    local tail
    tail="$(tmux capture-pane -t "$s:0" -p 2>/dev/null | tail -8 | tr '\n' ' | ')"
    log "tmux[$s]: ${tail:-<empty>}"
    if echo "$tail" | grep -qiE 'API failed|HTTP 404|model: \\|command not found|error|fatal'; then
      alert "tmux[$s] shows error — inspect pane"
    fi
  done <<< "$sessions"
}

check_pr() {
  if ! command -v gh >/dev/null 2>&1; then
    log "gh: not installed — skip PR checks"
    return
  fi
  local checks state
  checks="$(gh pr checks "$PR" 2>&1 || true)"
  state="$(gh pr view "$PR" --json state,mergeable,mergeStateStatus,url --jq '[.state,.mergeable,.mergeStateStatus,.url]|@tsv' 2>/dev/null || echo 'unknown')"
  log "PR#$PR state: $state"
  echo "$checks" | while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    log "PR#$PR check: $line"
    if echo "$line" | grep -qiE '\tfail\b|\tfailure\b'; then
      alert "PR#$PR required check failed: $line"
    fi
  done
}

check_worktree() {
  local wt="$REPO_ROOT/../Lariat-p0-build"
  if [[ -d "$wt/LariatNative" ]]; then
    local branch tests
    branch="$(git -C "$wt" branch --show-current 2>/dev/null || echo '?')"
    log "worktree Lariat-p0-build branch=$branch"
  fi
}

log "=== monitor start duration=${DURATION}s interval=${INTERVAL}s PR=${PR} ==="
end=$((SECONDS + DURATION))
cycle=0

while (( SECONDS < end )); do
  cycle=$((cycle + 1))
  log "--- cycle $cycle ---"
  check_pr
  capture_tmux
  check_worktree
  remaining=$(( end - SECONDS ))
  log "next check in ${INTERVAL}s (${remaining}s remaining)"
  sleep "$INTERVAL"
done

log "=== monitor end (90m window complete) ==="
