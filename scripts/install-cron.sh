#!/usr/bin/env bash
# install-cron.sh — idempotent installer for the Lariat cron block.
#
# What it does:
#   1. Reads the operator's current crontab (empty is fine).
#   2. Removes any existing block bounded by the markers
#      `# LARIAT_CRON_BEGIN` and `# LARIAT_CRON_END`.
#   3. Appends the contents of examples/lariat.crontab.
#   4. Loads the merged crontab via `crontab -`.
#
# Non-Lariat lines are preserved verbatim. Run as many times as you
# want; the markers make it idempotent.
#
# Usage:
#   bash scripts/install-cron.sh           # install or update
#   bash scripts/install-cron.sh --dry     # print the merged crontab to stdout, don't install
#   bash scripts/install-cron.sh --remove  # remove the Lariat block entirely
#
# Verify after install:
#   crontab -l                             # see the merged crontab
#   tail -f /tmp/lariat-cron.log           # watch live cron output
#   npm run job:status                     # check if any jobs are currently locked

set -e
set -u
set -o pipefail

DRY=0
REMOVE=0
for a in "$@"; do
  case "$a" in
    --dry|--dry-run) DRY=1 ;;
    --remove|--uninstall) REMOVE=1 ;;
    --help|-h)
      sed -n '2,/^$/p' "$0" | sed 's/^# //;s/^#//'
      exit 0 ;;
    *) echo "install-cron: unknown flag '$a'" >&2; exit 64 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE="${REPO_ROOT}/examples/lariat.crontab"

if [[ ! -f "${TEMPLATE}" ]]; then
  echo "install-cron: template not found at ${TEMPLATE}" >&2
  exit 1
fi

# Capture existing crontab (empty if none).
CURRENT="$(crontab -l 2>/dev/null || true)"

# Strip any prior LARIAT_CRON_BEGIN..LARIAT_CRON_END block. awk is the
# right tool here — it's standard on every macOS and Linux install we
# care about, and inline sed range deletion across patterns is finicky.
STRIPPED="$(printf '%s' "${CURRENT}" | awk '
  /^# LARIAT_CRON_BEGIN([[:space:]]|$)/ { in_block = 1; next }
  /^# LARIAT_CRON_END([[:space:]]|$)/   { in_block = 0; next }
  !in_block { print }
')"

if [[ "${REMOVE}" -eq 1 ]]; then
  if [[ "${DRY}" -eq 1 ]]; then
    printf '%s\n' "${STRIPPED}"
  else
    printf '%s\n' "${STRIPPED}" | crontab -
    echo "install-cron: removed the Lariat block"
  fi
  exit 0
fi

# Pull just the managed block (markers + content) from the template, in
# case the template has any header comments above LARIAT_CRON_BEGIN that
# we don't want to duplicate on each install.
BLOCK="$(awk '
  /^# LARIAT_CRON_BEGIN([[:space:]]|$)/ { keep = 1 }
  keep { print }
  /^# LARIAT_CRON_END([[:space:]]|$)/   { keep = 0 }
' "${TEMPLATE}")"

# Compose the merged crontab. Trim trailing whitespace then add the block.
MERGED="$(printf '%s\n\n%s\n' "$(printf '%s' "${STRIPPED}" | sed -e 's/[[:space:]]*$//')" "${BLOCK}")"

if [[ "${DRY}" -eq 1 ]]; then
  printf '%s' "${MERGED}"
  exit 0
fi

printf '%s' "${MERGED}" | crontab -
echo "install-cron: installed/updated the Lariat block"
echo "install-cron: run 'crontab -l' to verify, 'tail -f /tmp/lariat-cron.log' to watch output"
