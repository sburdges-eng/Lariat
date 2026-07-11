#!/usr/bin/env bash
# KA v2 preflight — verifies every local dependency the pipeline needs,
# and snapshots the live DB so nothing downstream ever touches it.
# Usage: bash training/gcp/preflight.sh [--skip-snapshot]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CANON="${LARIAT_CANONICAL_REPO:-$HOME/Dev/hospitality/Lariat}"
fail() { echo "PREFLIGHT FAIL: $1" >&2; exit 1; }

command -v node >/dev/null || fail "node not on PATH"
node -e 'process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)' || fail "node >= 22 required"
command -v gcloud >/dev/null || fail "gcloud not installed"
command -v sqlite3 >/dev/null || fail "sqlite3 not installed"
command -v ollama >/dev/null || fail "ollama not installed"
command -v hermes >/dev/null || fail "hermes CLI not installed (eval grader)"
hermes config show >/dev/null 2>&1 || fail "hermes not configured (eval grader)"
gcloud config get-value project 2>/dev/null | grep -q devvy-490312 || fail "gcloud project != devvy-490312"

# .ts import bridge — same mechanism run-eval.mjs uses
node --experimental-strip-types --no-warnings -e \
  "import('$REPO/lib/ollama.ts').then(m => { if (!m.GROUNDED_SYSTEM) throw new Error('no GROUNDED_SYSTEM'); })" \
  || fail "cannot import lib/ollama.ts via --experimental-strip-types"

if [[ "${1:-}" != "--skip-snapshot" ]]; then
  [[ -f "$CANON/data/lariat.db" ]] || fail "live DB not found at $CANON/data/lariat.db"
  mkdir -p "$HERE/snapshot"
  # .backup takes a consistent read snapshot even with WAL active
  sqlite3 "file:$CANON/data/lariat.db?mode=ro" ".backup '$HERE/snapshot/lariat.db'"
  # the generator resolves LARIAT_DATA_DIR as a full data/ view — copy the
  # tracked satellites (cache json, seeds, templates) next to the snapshot DB
  for d in cache normalized seeds templates inventory; do
    if [[ -d "$REPO/data/$d" ]]; then
      rm -rf "$HERE/snapshot/$d"
      cp -R "$REPO/data/$d" "$HERE/snapshot/$d"
    fi
  done
  echo "snapshot: $(du -h "$HERE/snapshot/lariat.db" | cut -f1) at $HERE/snapshot/lariat.db"
fi
echo "PREFLIGHT OK"
