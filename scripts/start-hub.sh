#!/usr/bin/env bash
# Start the Lariat production server detached, so it survives the terminal
# (or agent session) that launched it. Safe to re-run: refuses if already up.
set -u
REPO="/Users/seanburdges/lariat_dev/Lariat"
LOG="$HOME/Library/Logs/lariat-server.log"
cd "$REPO" || exit 1
if lsof -ti:3000 >/dev/null 2>&1; then
  echo "Lariat is already running on port 3000 — nothing to do."
  echo "Check it: curl -s localhost:3000/api/health"
  exit 0
fi
mkdir -p "$(dirname "$LOG")"
nohup npm run start >> "$LOG" 2>&1 &
disown
echo "Lariat starting (log: $LOG)"
for i in $(seq 1 20); do
  sleep 1
  if curl -fsS -o /dev/null http://localhost:3000/api/health 2>/dev/null; then
    echo "Lariat is up: http://localhost:3000"
    exit 0
  fi
done
echo "Lariat did not answer within 20s — check $LOG" >&2
exit 1
