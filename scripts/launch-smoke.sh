#!/usr/bin/env bash
# launch-smoke.sh — critical-path smoke test for production launch.
#
# Hits the running Lariat server (default http://127.0.0.1:3001 — the
# desktop wrapper's port; override with LARIAT_URL=http://...) and
# walks through the must-work flows before declaring the kitchen open
# for service:
#
#   1.  Home page renders                           (operator can see anything)
#   2.  /api/health reports ok                      (all required probes green)
#   3.  Recipes load (browser + detail + API)       (cookbook visible)
#   4.  Stations load (browser + detail)            (line check accessible)
#   5.  Line-check entries readable                 (the regulated audit trail)
#   6.  86 board readable                           (manager can update visibility)
#   7.  Specials board renders                      (specials UI alive)
#   8.  LaRi answers a grounded question            (kitchen assistant alive)
#   9.  Compliance lookup answers a real rule       (FDA Food Code grounding)
#   10. KDS tickets endpoint serves                 (FoH→BoH protocol intact)
#
# Exit non-zero on any failure so the launch checklist can gate go-live
# (`bash scripts/launch-smoke.sh && open -a Lariat`).
#
# Not a replacement for Playwright's full e2e suite — this is the
# 30-second sanity check the operator runs before flipping the open
# sign. Run `npm run test:e2e` for the deep pass.

set -euo pipefail

URL="${LARIAT_URL:-http://127.0.0.1:3001}"
SMOKE_SESSION_ID="${LARIAT_SMOKE_SESSION_ID:-00000000-0000-4000-8000-000000000001}"
PASS=0
FAIL=0
WARN=0

green() { printf "\033[32m✓\033[0m %s\n" "$1"; PASS=$((PASS + 1)); }
red()   { printf "\033[31m✗\033[0m %s — %s\n" "$1" "$2"; FAIL=$((FAIL + 1)); }
amber() { printf "\033[33m⚠\033[0m %s — %s\n" "$1" "$2"; WARN=$((WARN + 1)); }

# Helper: GET a path, echo "200 18351" or "000 0" on failure.
fetch() {
  local path="$1"
  curl -s -m 8 -o /dev/null -w "%{http_code} %{size_download}" "${URL}${path}" 2>/dev/null || echo "000 0"
}

# Helper: POST JSON, echo "<http_code>::<first-200-chars-of-body>".
post_json() {
  local path="$1" body="$2" out
  out=$(curl -s -m 30 -X POST "${URL}${path}" \
    -H 'content-type: application/json' \
    -w '\n%{http_code}' \
    -d "$body" 2>/dev/null || echo $'\n000')
  local code="${out##*$'\n'}"
  local resp="${out%$'\n'*}"
  echo "${code}::${resp:0:200}"
}

echo "Lariat launch smoke — target ${URL}"
echo "----------------------------------------------------------------"

# 1. home
read -r code bytes <<<"$(fetch /)"
if [ "$code" = "200" ] && [ "$bytes" -gt 1000 ]; then
  green "home page renders (${bytes} bytes)"
else
  red "home page" "http=${code} bytes=${bytes}"
fi

# 2. health
read -r code _ <<<"$(fetch /api/health)"
if [ "$code" = "200" ]; then
  green "/api/health reports ok"
elif [ "$code" = "503" ]; then
  red "/api/health reports DOWN" "required probe failed — curl ${URL}/api/health for detail"
else
  red "/api/health" "http=${code}"
fi

# 3. recipes
read -r code _ <<<"$(fetch /recipes)"
[ "$code" = "200" ] && green "recipes browser" || red "recipes browser" "http=${code}"
read -r code _ <<<"$(fetch /api/recipes/aji_verde)"
[ "$code" = "200" ] && green "recipe detail API (aji_verde)" || amber "recipe detail API (aji_verde)" "http=${code} — slug may not exist; expected on a fresh venue"

# 4. stations
read -r code _ <<<"$(fetch /stations)"
[ "$code" = "200" ] && green "stations browser" || red "stations browser" "http=${code}"
read -r code _ <<<"$(fetch /stations/grill_saute)"
[ "$code" = "200" ] && green "station detail (grill_saute)" || red "station detail (grill_saute)" "http=${code}"

# 5. line check entries
read -r code _ <<<"$(fetch /api/checks)"
[ "$code" = "200" ] && green "/api/checks" || red "/api/checks" "http=${code}"

# 6. 86 board
read -r code _ <<<"$(fetch /eighty-six)"
[ "$code" = "200" ] && green "86 board" || red "86 board" "http=${code}"

# 7. specials
read -r code _ <<<"$(fetch /specials)"
[ "$code" = "200" ] && green "specials board" || red "specials board" "http=${code}"

# 8. LaRi
echo "  (asking LaRi a question — may take up to 30s on first warmup)…"
result=$(post_json /api/kitchen-assistant "{\"message\":\"What stations are on the line?\",\"conversation_session_id\":\"${SMOKE_SESSION_ID}\"}")
code="${result%%::*}"
body="${result#*::}"
if [ "$code" = "200" ] && echo "$body" | grep -q '"answer"'; then
  green "LaRi POST returned a grounded answer"
elif [ "$code" = "502" ]; then
  red "LaRi POST" "Ollama unreachable (HTTP 502) — start ollama serve"
else
  red "LaRi POST" "http=${code} body=${body:0:120}"
fi

# 9. Compliance grounding
echo "  (asking LaRi a regulated question — should cite FDA Food Code)…"
result=$(post_json /api/kitchen-assistant "{\"message\":\"Quote the FDA Food Code rule on hand washing frequency.\",\"conversation_session_id\":\"${SMOKE_SESSION_ID}\"}")
code="${result%%::*}"
body="${result#*::}"
if [ "$code" = "200" ] && echo "$body" | grep -qE '"sources".*food_safety|compliance|2-301'; then
  green "LaRi cited compliance source"
elif [ "$code" = "200" ]; then
  amber "LaRi compliance grounding" "answered but did not cite a compliance source — verify compliance.db is populated and embeddings indexed"
else
  red "LaRi compliance grounding" "http=${code}"
fi

# 10. KDS tickets
read -r code _ <<<"$(fetch /api/kds/tickets)"
if [ "$code" = "200" ]; then
  green "KDS tickets endpoint serving (Swift KDS will see this)"
elif [ "$code" = "401" ] || [ "$code" = "403" ]; then
  amber "KDS tickets" "auth-gated; KDS uses the configured key — verify per Lariat-KDS/docs/lariat-kds-protocol.md"
else
  red "KDS tickets endpoint" "http=${code}"
fi

echo "----------------------------------------------------------------"
echo "PASS=${PASS}  WARN=${WARN}  FAIL=${FAIL}"
if [ "$FAIL" -gt 0 ]; then
  echo "Fix the failing checks before opening for service."
  exit 1
fi
if [ "$WARN" -gt 0 ]; then
  echo "Soft warnings present — review before opening."
  exit 0
fi
echo "Ready for service."
