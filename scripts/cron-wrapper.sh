#!/usr/bin/env bash
# cron-wrapper.sh — robust shim between cron's sparse environment and
# `npm run job <name>`.
#
# cron typically runs with PATH=/usr/bin:/bin and no NVM, no Homebrew
# paths, no shell rc files. That breaks `node`, `npm`, `python3`, and
# anything installed via Homebrew. This wrapper:
#
#   - sets PATH to include the standard Mac-with-Homebrew locations
#   - cd's to the repo root (resolved relative to this script's path)
#   - exec's `npm run job <name>` so signals propagate
#
# Usage (from crontab):
#   0 6 * * * /Users/<you>/Dev/Lariat/scripts/cron-wrapper.sh ingest-costing >> /tmp/lariat-cron.log 2>&1
#
# Exit codes are forwarded from `npm run job`:
#   0  — job ok
#   1  — job failed
#   64 — usage (unknown job, etc.)
#   75 — already locked (cron will retry next tick)

set -e
set -u
set -o pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: cron-wrapper.sh <job-name>" >&2
  exit 64
fi

JOB_NAME="$1"

# Resolve repo root from the script's own location so the wrapper works
# from anywhere cron places it. `realpath` is BSD on macOS and
# may not exist on minimal Linux installs — fall back to a portable
# expansion.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Compose a PATH that finds tools installed by Homebrew (Apple Silicon
# uses /opt/homebrew, Intel uses /usr/local), plus the standard system
# directories. NVM-installed node is often at ~/.nvm/versions/node/<v>/bin;
# operators using NVM should adjust LARIAT_NODE_BIN to point there.
DEFAULT_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
if [[ -n "${LARIAT_NODE_BIN:-}" ]]; then
  export PATH="${LARIAT_NODE_BIN}:${DEFAULT_PATH}"
else
  export PATH="${DEFAULT_PATH}"
fi

# Cron's TZ is system-default; explicitly setting it makes ingest_runs
# timestamps consistent regardless of how cron was started. Override
# with LARIAT_TZ if the operator wants something other than America/Denver.
export TZ="${LARIAT_TZ:-America/Denver}"

cd "${REPO_ROOT}"

# Verbose preamble — useful when redirected to /tmp/lariat-cron.log so
# the operator can see why a wrapper invocation behaved as it did.
echo "[$(date -Iseconds)] cron-wrapper: job=${JOB_NAME} cwd=${REPO_ROOT} PATH=${PATH}"

exec npm run --silent job "${JOB_NAME}"
