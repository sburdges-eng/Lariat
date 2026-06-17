#!/usr/bin/env bash
# PreToolUse gate for shell/Bash tool calls: when the command performs a
# `git commit`, require `npm run lint` and `npm run typecheck` to pass first.
#
# Wired from .claude/settings.json (also honored by Cursor). Emits a decision
# in BOTH the Cursor (`permission`) and Claude Code
# (`hookSpecificOutput.permissionDecision`) shapes so the gate behaves the
# same in either harness.
#
# Fixes over the prior inline one-liner:
#   1. Only fires on an actual `git commit` invocation (word-boundary match),
#      not any command that merely contains the substring "git commit"
#      (e.g. `grep "git commit"` or a commit-message body).
#   2. Keeps stdout pure JSON — npm output is redirected to stderr — so the
#      harness never sees "invalid JSON" and blocks the command for safety.
set -uo pipefail

INPUT="$(cat 2>/dev/null || true)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || true)"

allow() {
  printf '{"permission":"allow","hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
  exit 0
}

deny() {
  reason="$1"
  printf '{"permission":"deny","userMessage":"%s","agentMessage":"%s","hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}' \
    "$reason" "$reason" "$reason"
  echo "$reason" >&2
  exit 2
}

# Match a real `git commit` token: start-of-string or a shell separator
# (whitespace, ; & | ( ) before `git`, then `commit` as its own word.
if ! printf '%s' "$CMD" | grep -Eq '(^|[;&|(]|[[:space:]])git[[:space:]]+commit([[:space:]]|$)'; then
  allow
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-$PWD}")"

if (cd "$ROOT" && npm run lint 1>&2 && npm run typecheck 1>&2); then
  allow
else
  deny "Pre-commit gate failed: lint/typecheck must pass before committing."
fi
