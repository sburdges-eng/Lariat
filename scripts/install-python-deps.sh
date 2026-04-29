#!/usr/bin/env bash
# Creates .venv (if missing) and installs Python test-time deps.
# Run once after cloning, or after pulling a requirements-dev.txt update:
#
#   bash scripts/install-python-deps.sh
#
# The venv is gitignored.  npm run test:shows-py and the three
# test:shows-{ingest,repo,api} suites all rely on .venv/bin/python3.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -d ".venv" ]; then
  echo "→ creating .venv …"
  python3 -m venv .venv
fi

echo "→ installing Python deps into .venv …"
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements-dev.txt

echo "✓ .venv ready — Python test deps installed."
echo "  Run tests:  npm run test:shows"
