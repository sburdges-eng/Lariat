#!/usr/bin/env bash
# install-prod-data.sh — copy the dev-tree SQLite DB into the production
# Lariat.app's data dir, then relaunch the app.
#
# The production wrapper at /Applications/Lariat.app reads from
# ~/Library/Application Support/Lariat/data/ (per desktop/dist/desktop/paths.js).
# It does NOT auto-sync from the source-of-truth ~/Dev/Lariat/data/. This
# script does the one-shot copy + restart so the production app shows the
# real recipes/BOMs/vendor-prices/sales/line-checks instead of an empty DB.
#
# Coexistence note: the dev server (`npm run dev`) and Lariat.app should
# never run against the SAME SQLite WAL file simultaneously — two writers
# corrupt the journal. This script copies the DB to a separate location;
# the two stay independent until next sync.
#
# Usage:
#   bash scripts/install-prod-data.sh                # copy + relaunch
#   bash scripts/install-prod-data.sh --no-launch    # copy only

set -euo pipefail

SRC_DIR="${HOME}/Dev/Lariat/data"
DEST_DIR="${HOME}/Library/Application Support/Lariat/data"
NO_LAUNCH=0
[ "${1:-}" = "--no-launch" ] && NO_LAUNCH=1

if [ ! -f "${SRC_DIR}/lariat.db" ]; then
  echo "FATAL: source DB missing at ${SRC_DIR}/lariat.db" >&2
  exit 1
fi

# Stop the running app so SQLite doesn't fight us mid-copy.
if pgrep -x Lariat >/dev/null 2>&1; then
  echo "[install-prod-data] stopping Lariat.app…"
  pkill -x Lariat 2>/dev/null || true
  # Wait up to 10s for clean exit.
  for _ in $(seq 1 20); do
    pgrep -x Lariat >/dev/null 2>&1 || break
    sleep 0.5
  done
fi

mkdir -p "${DEST_DIR}" "${DEST_DIR}/cache" "${DEST_DIR}/uploads"

echo "[install-prod-data] copying ${SRC_DIR}/lariat.db* → ${DEST_DIR}/"
# Drop any stale WAL/SHM at the destination before copying. If the source DB
# is checkpoint-clean (no WAL/SHM) but the destination has leftovers from a
# previous install, SQLite would replay the stale journal against the new
# DB on first open — silent corruption.
rm -f "${DEST_DIR}/lariat.db-wal" "${DEST_DIR}/lariat.db-shm"
cp "${SRC_DIR}/lariat.db" "${DEST_DIR}/lariat.db"
# WAL + SHM may not exist if the dev DB is checkpoint-clean; that's fine.
[ -f "${SRC_DIR}/lariat.db-wal" ] && cp "${SRC_DIR}/lariat.db-wal" "${DEST_DIR}/lariat.db-wal" || true
[ -f "${SRC_DIR}/lariat.db-shm" ] && cp "${SRC_DIR}/lariat.db-shm" "${DEST_DIR}/lariat.db-shm" || true

# Cache tier — JSON templates that drive /recipes, /menu, /food-safety,
# /line-checks, /allergen-lookup, /command (preshift), etc. Without
# these the pages render "No recipes" / "Loading" indefinitely.
echo "[install-prod-data] copying ${SRC_DIR}/cache/*.json + compliance.db → ${DEST_DIR}/cache/"
cp "${SRC_DIR}/cache/"*.json "${DEST_DIR}/cache/" 2>/dev/null || true
[ -f "${SRC_DIR}/cache/compliance.db" ] && cp "${SRC_DIR}/cache/compliance.db" "${DEST_DIR}/cache/compliance.db" || true

# Recipe / product photo uploads (off-tree but small enough to ship).
if [ -d "${SRC_DIR}/uploads" ]; then
  cp -R "${SRC_DIR}/uploads/." "${DEST_DIR}/uploads/" 2>/dev/null || true
fi

LINE_CHECKS=$(sqlite3 "${DEST_DIR}/lariat.db" "SELECT COUNT(*) FROM line_check_entries;" 2>/dev/null || echo "?")
RECIPES=$(python3 -c "import json,sys; d=json.load(open('${DEST_DIR}/cache/recipes.json')); print(len(d))" 2>/dev/null || echo "?")
MENU=$(python3 -c "import json,sys; d=json.load(open('${DEST_DIR}/cache/menu.json')); print(len(d) if isinstance(d,list) else len(d.get('items',[])))" 2>/dev/null || echo "?")
echo "[install-prod-data] copied. line_check_entries=${LINE_CHECKS}, recipes.json=${RECIPES}, menu.json=${MENU}"

if [ "${NO_LAUNCH}" = "0" ]; then
  echo "[install-prod-data] relaunching Lariat.app…"
  open -a Lariat
fi
