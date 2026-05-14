#!/bin/bash
# scripts/demo-smoke.sh — combined-app demo smoke
#
# Authenticates with the PIN, then GETs every surface in navRegistry,
# reporting status + size per route. Exits non-zero if any route 5xx's
# or returns an unexpected status, and tails the dev-server log for
# runtime errors.
#
# Pre-reqs: dev server running on http://localhost:3000 with
# LARIAT_PIN set in .env.local. Run `npm run dev` first.
#
# Usage:
#   scripts/demo-smoke.sh                          # default base URL + .env.local
#   BASE=http://192.168.1.42:3000 scripts/demo-smoke.sh
#   PIN=0708 LOG=/tmp/lariat-dev.log scripts/demo-smoke.sh

set -u

BASE="${BASE:-http://localhost:3000}"
LOG="${LOG:-/tmp/lariat-dev.log}"
COOKIES="$(mktemp -t lariat-pin-cookies.XXXXXX)"
trap 'rm -f "$COOKIES"' EXIT

# Resolve PIN: env > .env.local
if [ -z "${PIN:-}" ]; then
  if [ -f .env.local ]; then
    PIN="$(grep -E '^LARIAT_PIN=' .env.local | head -1 | cut -d= -f2-)"
  fi
fi
if [ -z "${PIN:-}" ]; then
  echo "Set LARIAT_PIN in .env.local or pass PIN=… to this script." >&2
  exit 2
fi

# Confirm dev server is up before doing anything else.
if ! curl -sf -o /dev/null "$BASE/"; then
  echo "Dev server not reachable at $BASE. Run \`npm run dev\` first." >&2
  exit 2
fi

# Authenticate.
auth=$(curl -s -c "$COOKIES" -X POST "$BASE/api/auth/pin" \
  -H "Content-Type: application/json" \
  -d "{\"pin\":\"$PIN\"}")
if ! echo "$auth" | grep -q '"ok":true'; then
  echo "PIN auth failed: $auth" >&2
  exit 2
fi

# Marker so we can read only NEW dev-log lines for this run.
log_mark=0
if [ -f "$LOG" ]; then
  log_mark=$(wc -l < "$LOG" | tr -d ' ')
fi

# Public + gated surfaces. Public: 200. Gated-without-PIN would be 307,
# but we authenticated, so everything should be 200.
URLS=(
  "/"
  "/command"
  "/stations"
  "/host"
  "/kds/punch"
  "/eighty-six"
  "/recipes"
  "/inventory"
  "/prep"
  "/prep/fire-schedule"
  "/reservations"
  "/floor"
  "/kitchen-assistant"
  "/specials"
  "/specials/saved"
  "/gold-stars"
  "/food-safety"
  "/food-safety/temp-log"
  "/food-safety/receiving"
  "/food-safety/calibrations"
  "/food-safety/tphc"
  "/labor"
  "/analytics"
  "/costing"
  "/purchasing"
  "/menu-engineering"
  "/costing/depletion-exceptions"
  "/costing/pack-changes"
  "/beo"
  "/equipment"
  "/bar"
  "/datapack-search"
  "/allergen-lookup"
  "/shows/tonight"
  "/booking"
  "/playbook"
  "/shows/archive"
  "/management"
  "/management/temp-pins"
)

printf "%-44s %-5s %-10s %s\n" "ROUTE" "CODE" "BYTES" "NOTE"
printf '%.0s-' {1..78}; printf "\n"

resp="$(mktemp -t lariat-resp.XXXXXX)"
fails=0
total=${#URLS[@]}
for u in "${URLS[@]}"; do
  code=$(curl -s -b "$COOKIES" -o "$resp" -w "%{http_code}" "$BASE$u")
  size=$(wc -c < "$resp" | tr -d ' ')
  note=""
  if [ "$code" != "200" ]; then
    note="!= 200"
    fails=$((fails + 1))
  fi
  if grep -q "Application error" "$resp" 2>/dev/null; then
    note="APP-ERROR"
    fails=$((fails + 1))
  fi
  printf "%-44s %-5s %-10s %s\n" "$u" "$code" "${size}B" "$note"
done
rm -f "$resp"

printf '%.0s-' {1..78}; printf "\n"
echo "Surfaces: $total · OK: $((total - fails)) · Failed: $fails"

# Tail new dev-log lines for runtime spew.
if [ -f "$LOG" ]; then
  errs=$(awk -v m="$log_mark" 'NR>m' "$LOG" \
    | grep -E "⨯|SqliteError|TypeError|ReferenceError|UnhandledPromise|Error:" \
    || true)
  if [ -n "$errs" ]; then
    echo
    echo "Runtime errors in dev log since smoke started:"
    echo "$errs" | head -20
    fails=$((fails + 1))
  fi
fi

if [ "$fails" -gt 0 ]; then
  echo
  echo "FAIL ($fails issues)"
  exit 1
fi

echo
echo "OK — all $total surfaces returned 200 with no runtime errors"
