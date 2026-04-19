#!/usr/bin/env bash
# Launch iTerm2 with 4 tabs: workspace (zsh), Codex, Gemini, Claude — run in parallel on the same repo root.
# Usage: ./scripts/launch-food-bev-lab.sh
# Env overrides: FOOD_BEV_LAB_ROOT, CODEX_CMD, GEMINI_CMD, CLAUDE_CMD

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${FOOD_BEV_LAB_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

# Default CLIs (install separately; override if your binaries differ)
CODEX_CMD="${CODEX_CMD:-codex}"
GEMINI_CMD="${GEMINI_CMD:-gemini}"
CLAUDE_CMD="${CLAUDE_CMD:-claude}"

if [[ ! -d "$ROOT" ]]; then
  echo "FOOD_BEV_LAB_ROOT is not a directory: $ROOT" >&2
  exit 1
fi

if ! command -v osascript &>/dev/null; then
  echo "osascript not found (macOS required for iTerm2 automation)." >&2
  exit 1
fi

ITERM_SCRIPT="$SCRIPT_DIR/iterm-food-bev-lab.applescript"
TERM_SCRIPT="$SCRIPT_DIR/terminal-food-bev-lab.applescript"
for f in "$ITERM_SCRIPT" "$TERM_SCRIPT"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing $f" >&2
    exit 1
  fi
done

# iTerm’s AppleScript verbs only compile when iTerm2 is installed (scripting dictionary).
# Without it, osascript fails to parse; fall back to Terminal.app (four windows).
if osascript -e 'tell application "iTerm" to get version' &>/dev/null; then
  exec osascript "$ITERM_SCRIPT" "$ROOT" "$CODEX_CMD" "$GEMINI_CMD" "$CLAUDE_CMD"
else
  echo "iTerm2 not found — opening four Terminal windows (install iTerm2 for a single window with four tabs)." >&2
  exec osascript "$TERM_SCRIPT" "$ROOT" "$CODEX_CMD" "$GEMINI_CMD" "$CLAUDE_CMD"
fi
