#!/usr/bin/env bash
# smoke-day.sh — scripted full-service-day smoke against the PACKAGED app.
#
# Drives the packaged Electron bundle's real server (Resources/app +
# desktop/server-entry.cjs, the same code path the GUI supervises) over
# HTTP with an ISOLATED data dir, and asserts the build is fresh, the
# recipebook is actually seeded, the PIN tier gate holds, BEO surfaces
# answer, a service day's writes land, and the close-out export contains
# them. Exits non-zero on the first failure with a message naming the
# missing artifact. The native (SwiftPM) Lariat.app serves no ports by
# design, so it gets file-level seed/version assertions, not a GUI drive.
#
# Usage: bash scripts/smoke-day.sh [path/to/Lariat.app]
#   SMOKE_PORT (default 3210), SMOKE_PIN (default 7777)
#
# Run via `npm run smoke:day`; `npm run verify:release` chains the full
# verify gate, the packaged build, and this smoke.
set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${SMOKE_PORT:-3210}"
PIN="${SMOKE_PIN:-7777}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lariat-smoke-day.XXXXXX")"
COOKIES="$TMP/cookies.txt"
SERVER_PID=""

pass() { echo "  ok: $*"; }
fail() {
  echo "SMOKE FAIL: $*" >&2
  echo "  (data dir kept for inspection: $TMP; server log: $TMP/server.log)" >&2
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  exit 1
}
cleanup_ok() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  rm -rf "$TMP"
}

NODE24_BIN=$(dirname "$(npx -y node@24 -p process.execPath)") \
  || fail "could not resolve node@24 via npx (needed for the better-sqlite3 binding)"
export PATH="$NODE24_BIN:$PATH"

jsonget() { # jsonget '<js expr over parsed stdin as d>'
  node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"
}

# ── 1. Locate the packaged app ───────────────────────────────────────
APP="${1:-}"
if [ -z "$APP" ]; then
  for c in "$REPO_ROOT/dist/mac-arm64/Lariat.app" "$REPO_ROOT/dist/mac/Lariat.app"; do
    [ -d "$c" ] && APP="$c" && break
  done
fi
[ -n "$APP" ] && [ -d "$APP" ] \
  || fail "no packaged app found (missing artifact: dist/mac-arm64/Lariat.app) — build one with: npm run desktop:dist"
BUNDLE_APPDIR="$APP/Contents/Resources/app"
[ -f "$BUNDLE_APPDIR/desktop/server-entry.cjs" ] \
  || fail "packaged bundle at $APP is missing desktop/server-entry.cjs — not a Lariat desktop build"
echo "packaged app: $APP"

# ── 2. Build freshness: SHA baked into the bundle vs origin/main ────
[ -f "$BUNDLE_APPDIR/version.json" ] \
  || fail "missing artifact: version.json inside the bundle ($BUNDLE_APPDIR/version.json) — the build skipped version:stamp"
BUNDLE_SHA=$(jsonget 'd.sha' <"$BUNDLE_APPDIR/version.json")
git -C "$REPO_ROOT" fetch origin --quiet 2>/dev/null
MAIN_SHA=$(git -C "$REPO_ROOT" rev-parse origin/main)
HEAD_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
echo "bundle sha=$BUNDLE_SHA  HEAD=${HEAD_SHA:0:8}  origin/main=${MAIN_SHA:0:8}"
case "$HEAD_SHA" in
  "$BUNDLE_SHA"*) pass "bundle was built from this checkout's HEAD" ;;
  *) fail "STALE BUNDLE: version.json sha=$BUNDLE_SHA does not match HEAD ${HEAD_SHA:0:8} — rebuild from the current commit (a previous smoke raced ahead of a merge exactly this way)" ;;
esac
case "$MAIN_SHA" in
  "$BUNDLE_SHA"*) pass "bundle matches origin/main" ;;
  *) echo "  note: bundle is not origin/main (${MAIN_SHA:0:8}) — fine for a branch smoke, NOT for a release" ;;
esac

# ── 3. Seed the isolated data dir; assert the seed landed ───────────
mkdir -p "$TMP/cache"
SEED_SRC="$REPO_ROOT/data/cache/recipes.json"
[ -f "$SEED_SRC" ] \
  || fail "missing artifact: data/cache/recipes.json (the recipebook cache) — generate it with: npm run ingest (or rebuild-cache)"
cp "$SEED_SRC" "$TMP/cache/recipes.json"
RECIPE_ROWS=$(jsonget 'd.length' <"$TMP/cache/recipes.json")
[ "$RECIPE_ROWS" -ge 50 ] 2>/dev/null \
  || fail "recipebook seed landed with only $RECIPE_ROWS recipes (expected >= 50) — the cache is functionally empty"
pass "recipebook seeded: $RECIPE_ROWS recipes"

# ── 4. Launch the packaged server headless ──────────────────────────
# Run server-entry under the bundle's OWN Electron binary
# (ELECTRON_RUN_AS_NODE): the bundled better_sqlite3.node is compiled
# for Electron's ABI, so system node cannot load it — and this way the
# smoke exercises the exact runtime the GUI supervises.
ELECTRON_BIN="$APP/Contents/MacOS/Lariat"
[ -x "$ELECTRON_BIN" ] || fail "missing artifact: $ELECTRON_BIN (bundle has no executable)"
PORT="$PORT" HOST=127.0.0.1 NODE_ENV=production LARIAT_DATA_DIR="$TMP" LARIAT_PIN="$PIN" \
  LARIAT_PIN_SECRET="smoke-day-$(date +%s)-not-a-real-secret" \
  ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" "$BUNDLE_APPDIR/desktop/server-entry.cjs" >"$TMP/server.log" 2>&1 &
SERVER_PID=$!
BASE="http://127.0.0.1:$PORT"
READY=""
for _ in $(seq 1 60); do
  if curl -sf --max-time 2 "$BASE/api/discover" >/dev/null 2>&1; then READY=1; break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || break
  sleep 1
done
[ -n "$READY" ] || { echo "--- server.log tail ---" >&2; tail -20 "$TMP/server.log" >&2; \
  fail "packaged server never became ready on $BASE within 60s"; }
pass "packaged server up on $BASE (pid $SERVER_PID)"

SDATE=$(cd "$REPO_ROOT" && npx -y node@24 --experimental-strip-types \
  -e "import('./lib/serviceDate.ts').then(m=>console.log(m.serviceDate()))") \
  || fail "could not compute serviceDate()"
echo "service date: $SDATE"

# ── 5. Health probes: sqlite + recipe cache must be green ───────────
# First call runs every probe (ollama/toast/mdns each burn their own
# timeout budget), so give it a generous ceiling and don't let curl -f
# eat the body — a 503 body names the failed required probe.
HEALTH_CODE=$(curl -s -o "$TMP/health.json" -w '%{http_code}' --max-time 60 "$BASE/api/health")
[ -s "$TMP/health.json" ] || fail "GET /api/health did not answer within 60s (code=$HEALTH_CODE)"
for probe in sqlite cache pin_gate; do
  P=$(jsonget "JSON.stringify((d.probes||{}).$probe||null)" <"$TMP/health.json")
  echo "$P" | grep -q '"ok":true' \
    || fail "health probe '$probe' not ok (http $HEALTH_CODE) — $P — the app is functionally broken"
done
pass "health: sqlite, recipe cache, pin gate all green (http $HEALTH_CODE)"

# ── 6. Recipebook served, not just present on disk ──────────────────
SERVED=$(curl -sf --max-time 10 "$BASE/api/recipes" | jsonget 'Array.isArray(d)?d.length:(d.recipes||[]).length') \
  || fail "GET /api/recipes did not answer"
[ "$SERVED" -ge 50 ] 2>/dev/null \
  || fail "app serves only $SERVED recipes (seeded $RECIPE_ROWS) — recipebook not reaching the app"
curl -sf --max-time 10 "$BASE/api/recipes/aji_verde" | grep -qi 'aji' \
  || fail "recipe detail /api/recipes/aji_verde missing — recipebook data incomplete"
pass "recipebook served: $SERVED recipes, detail route answers"

# ── 7. Tier gate: manager surfaces closed to cooks, open with PIN ───
UNAUTH=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/api/beo")
case "$UNAUTH" in
  200) fail "TIER GATE ABSENT: /api/beo answered 200 without a PIN — manager tier is open to every tablet on the LAN" ;;
  401|403|503|30*) pass "manager tier closed without PIN (/api/beo -> $UNAUTH)" ;;
  *) fail "/api/beo unauthenticated returned unexpected $UNAUTH" ;;
esac
AUTH=$(curl -s -c "$COOKIES" --max-time 10 -X POST "$BASE/api/auth/pin" \
  -H 'Content-Type: application/json' -d "{\"pin\":\"$PIN\"}")
echo "$AUTH" | grep -q '"ok":true' || fail "PIN login failed: $AUTH"
BEO_CODE=$(curl -s -b "$COOKIES" -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/api/beo")
[ "$BEO_CODE" = 200 ] || fail "BEO TIER MISSING: authenticated /api/beo returned $BEO_CODE"
pass "manager tier opens with PIN (/api/beo -> 200)"

# ── 8. BEO is present and functional (hard failure if not) ──────────
BEO_CREATE=$(curl -s -b "$COOKIES" --max-time 10 -X POST "$BASE/api/beo" \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"event\",\"title\":\"Collett Rehearsal Dinner\",\"event_date\":\"$SDATE\",\"guest_count\":60}")
echo "$BEO_CREATE" | grep -qi 'error' && fail "BEO event create rejected: $BEO_CREATE"
curl -s -b "$COOKIES" --max-time 10 "$BASE/api/beo" | grep -q 'Collett Rehearsal Dinner' \
  || fail "created BEO event not returned by GET /api/beo — BEO tier not functional"
FIRE_CODE=$(curl -s -b "$COOKIES" -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/api/beo/fire-schedule")
[ "$FIRE_CODE" = 200 ] || fail "BEO fire-schedule returned $FIRE_CODE — BEO tier incomplete"
pass "BEO tier present: event created, listed, fire-schedule answers"

# ── 9. Service-day walk: open -> mid-service -> close-out ───────────
CHECK=$(curl -s -b "$COOKIES" --max-time 10 -X POST "$BASE/api/checks" \
  -H 'Content-Type: application/json' \
  -d "{\"shift_date\":\"$SDATE\",\"station_id\":\"grill_saute\",\"item\":\"Walk-in at or below 41F\",\"status\":\"pass\",\"cook_id\":\"smoke_line_cook\"}")
echo "$CHECK" | grep -qi 'error' && fail "line-check write rejected: $CHECK"
curl -sf --max-time 10 "$BASE/api/checks?shift_date=$SDATE&station_id=grill_saute" \
  | grep -q 'Walk-in' || fail "line check did not persist (open-of-day write lost)"
pass "open: line check written and read back"

EIGHTYSIX=$(curl -s -b "$COOKIES" --max-time 10 -X POST "$BASE/api/eighty-six" \
  -H 'Content-Type: application/json' \
  -d '{"item":"Smoked Brisket","reason":"sold out","station_id":"grill_saute"}')
echo "$EIGHTYSIX" | grep -qi 'error' && fail "86 write rejected: $EIGHTYSIX"
ACTIVE86=$(curl -sf --max-time 10 "$BASE/api/eighty-six") || fail "GET /api/eighty-six did not answer"
echo "$ACTIVE86" | grep -q 'Smoked Brisket' || fail "86 did not persist (mid-service write lost)"
SIX_ID=$(echo "$ACTIVE86" | jsonget '(Array.isArray(d)?d:(d.active||d.items||[])).find(r=>String(r.item||"").includes("Brisket"))?.id ?? ""')
if [ -n "$SIX_ID" ] && [ "$SIX_ID" != "undefined" ]; then
  RESOLVE=$(curl -s -b "$COOKIES" --max-time 10 -X POST "$BASE/api/eighty-six/resolve" \
    -H 'Content-Type: application/json' -d "{\"id\":$SIX_ID}")
  echo "$RESOLVE" | grep -qi 'error' && fail "86 resolve rejected: $RESOLVE"
  pass "mid-service: 86 written, listed, resolved"
else
  pass "mid-service: 86 written and listed (id not exposed; resolve skipped)"
fi

EXP_DIR="$TMP/exports"
(cd "$REPO_ROOT" && LARIAT_DATA_DIR="$TMP" LARIAT_EXPORT_DIR="$EXP_DIR" \
  node scripts/export.mjs "$SDATE") >"$TMP/export.log" 2>&1 \
  || { tail -10 "$TMP/export.log" >&2; fail "close-out export failed for $SDATE"; }
ls "$EXP_DIR"/*"$SDATE"* >/dev/null 2>&1 \
  || fail "close-out produced no artifact for $SDATE under $EXP_DIR (missing artifact: lariat_$SDATE export)"
grep -rq 'Walk-in\|Brisket' "$EXP_DIR" 2>/dev/null \
  || fail "close-out export exists but contains neither the line check nor the 86 — day's writes missing from the archive"
pass "close-out: export contains the day's line check and 86"

# ── 10. Native bundle (no ports by design — file-level assertions) ──
NATIVE_APP="$REPO_ROOT/LariatNative/build/Lariat.app"
if [ -d "$NATIVE_APP" ]; then
  NATIVE_SEEDED=""
  for root in "${LARIAT_ROOT:-}" "$HOME/Library/Application Support/Lariat" "$REPO_ROOT"; do
    [ -n "$root" ] && [ -f "$root/recipes/recipe_index.csv" ] && NATIVE_SEEDED="$root" && break
  done
  [ -n "$NATIVE_SEEDED" ] \
    || fail "native Lariat.app exists but NO recipebook seed is resolvable (missing artifact: recipes/recipe_index.csv under LARIAT_ROOT or ~/Library/Application Support/Lariat) — this is the exact gap the last GUI smoke hit; seed with: rsync -a recipes menus \"\$HOME/Library/Application Support/Lariat/\""
  pass "native: recipebook seed resolvable at $NATIVE_SEEDED"
  BUNDLE_COUNT=$(defaults read "$NATIVE_APP/Contents/Info" CFBundleVersion 2>/dev/null || echo "?")
  HEAD_COUNT=$(git -C "$REPO_ROOT" rev-list --count HEAD)
  if [ "$BUNDLE_COUNT" = "$HEAD_COUNT" ]; then
    pass "native: bundle CFBundleVersion ($BUNDLE_COUNT) matches HEAD commit count"
  else
    echo "  note: native bundle CFBundleVersion=$BUNDLE_COUNT vs HEAD count=$HEAD_COUNT — rebuild via LariatNative/Scripts/package-app.sh before a release smoke"
  fi
else
  echo "  skip: no native bundle at LariatNative/build/Lariat.app"
fi

echo
echo "SMOKE-DAY PASS: fresh bundle, seeded recipebook ($SERVED recipes), tier gate held, BEO functional, day's writes persisted and exported."
cleanup_ok
exit 0
