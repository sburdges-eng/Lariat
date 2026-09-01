#!/usr/bin/env bash
# Full web verify gate with explicit exit-code capture (CLAUDE.md §4).
# - Forces Node 24 (repo pin, .nvmrc) regardless of shell PATH: package.json
#   scripts do not handle the version themselves, and better-sqlite3 is
#   compiled for NODE_MODULE_VERSION 137.
# - Stamps version.json first: `verify` is not hermetic on a fresh checkout
#   (test-discover-route asserts the stamped version).
# - Prints VERIFY_EXIT on its own line and exits with it; nothing here can
#   mask a non-zero status with a trailing echo.
set -u
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1

NODE24_BIN=$(dirname "$(npx -y node@24 -p process.execPath)")
if [ -z "$NODE24_BIN" ] || [ ! -x "$NODE24_BIN/node" ]; then
  echo "ERROR: could not resolve node@24 via npx" >&2
  exit 1
fi
export PATH="$NODE24_BIN:$PATH"

LOG="${TMPDIR:-/tmp}/lariat-verify-$(date +%Y%m%d-%H%M%S).log"
echo "log=$LOG"

npm run version:stamp >>"$LOG" 2>&1
STAMP_EXIT=$?
if [ "$STAMP_EXIT" != 0 ]; then
  echo "version:stamp failed (exit=$STAMP_EXIT)"
  tail -40 "$LOG"
  exit "$STAMP_EXIT"
fi

npm run verify >>"$LOG" 2>&1
VERIFY_EXIT=$?
echo "VERIFY_EXIT=$VERIFY_EXIT"
if [ "$VERIFY_EXIT" != 0 ]; then
  tail -60 "$LOG"
fi
exit "$VERIFY_EXIT"
