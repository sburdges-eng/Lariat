# Codebase audit — 2026-05-08

**Methodology.** Five parallel read-only sub-agents, each scoped to one non-overlapping domain, dispatched against `main` at commit `34085db`. Each agent produced its own findings list with `file:line` refs and one-sentence fix recommendations. No code modified.

**Scope of agents:**
1. HACCP rule modules + audit subsystem (`feature-dev:code-reviewer`)
2. Compute engine + costing pipeline (`feature-dev:code-explorer`)
3. Cloud-bridge + multi-instance LAN (`feature-dev:code-reviewer`)
4. Whole-codebase security audit (`security-reviewer`)
5. Kitchen Assistant + Specials + Data Pack (`feature-dev:code-explorer`)

**Verification status.** The 4 security HIGH findings were spot-checked against live source by the orchestrator after agent return; all 4 confirmed real. Other HIGH findings are agent-claimed and should be triaged with a fresh `Read` before action — agents occasionally misread line numbers or conflate adjacent files.

> **Note on auditor tooling (added 2026-05-09):** the 2026-05-08 audit's tooling silently stripped NUL bytes when reading source files. This affected at least the `lib/marginDeltas.ts` review (claim #203 about `skuGroups` map key separator was incorrect for this reason). Future audit runs against this codebase should use binary-safe file readers and verify any "separator" or "key joiner" claims via `od -c` or `git diff --text` first.

---

## Severity summary

| Domain | HIGH | MEDIUM | LOW/INFO | Tech debt | Test gaps |
|---|---:|---:|---:|---:|---:|
| Security (whole repo) | **4** | 6 | 5 | 4 | (folded) |
| HACCP + audit | 3 | 4 | 3 | — | 4 |
| Cloud-bridge + LAN | 3 | 5 | 4 | 3 | 5 |
| Compute engine + costing | 2 | 4 | 4 | 4 | 5 |
| Kitchen Assistant + Specials | 2 | 4 | 7 | 4 | 6 |
| **Total** | **14** | **23** | **23** | **15** | **20** |

**Recommended ship-block (Tier 1) — exploitable security defects:**
1. KA `x-lariat-pin` header bypass
2. Temp-PIN raw PIN cached in `idempotency_keys`
3. Temp-PIN login has no rate limiter
4. Cleaning-schedule PATCH allows cross-location row rewrites with no PIN gate

**Recommended Tier 2 — correctness HIGHs that risk silent regression:**
5. TPHC PATCH TOCTOU race
6. `postAuditEvent` warning-only outside-transaction guard
7. `pestControl.ts` missing FDA citation
8. `recomputeMarginAnalysis` ignores threaded `db` handle
9. `sales_lines` has no per-row date — theoretical COGS silently double-counts on partial-ingest abort
10. `claim()` / `nack()` TOCTOU races (cloud-bridge queue)

**Tier 3 — reliability/UX HIGHs:**
11. Drainer keepalive in standalone script may exit silently
12. KA `give_gold_star` `stars` fallback silently writes on garbage input
13. KA `line_check` `reading_f` coercion before isFinite guard (low actual impact, pattern inconsistency)
14. KA action-engine outer `try/catch` swallows all handler exceptions

---

## 1. Security audit (whole codebase)

### HIGH (exploitable, ship-blocker) — 4 findings, all spot-check verified

- **KA `x-lariat-pin` header bypasses HMAC-cookie path with naked-string compare** — `app/api/kitchen-assistant/route.js:190-192`. Manager-PIN gate for KA write actions checks `pin === expectedPin` (raw `===`, no `crypto.timingSafeEqual`, no rate limit), accepts plaintext PIN on every request. LAN attacker can timing-attack one byte at a time; stale fetch-log/proxy logfile leaks the PIN. Bypasses the rate limiter and cookie-rotation work landed in PR #182. **Fix:** Delete the `x-lariat-pin` path entirely; require `hasPinCookie(req)` for every KA write action — same gate as every other regulated mutation route.

- **Temp-PIN issue route caches raw PIN in idempotency cache** — `app/api/auth/temp-pin/issue/route.js:62-66, 156-159` + `lib/idempotency.ts:181-198`. The issue handler returns `{ id, pin, label, scopes, expires_at }` and is wrapped in `withIdempotency`, which writes the response body to `idempotency_keys.response_body` (24h TTL). Anyone with later DB read access (exfil, shared SQLite snapshot, backup) recovers active raw temp PINs for up to 24h. **Fix:** Skip caching for this route (special-case status 200 like the existing 401 short-circuit), redact `pin` from `response_body` before `store()`, or store only `{id, label}` and re-mint on replay.

- **Temp-PIN login has no rate limiter** — `app/api/auth/temp-pin/login/route.js:25-58, 60`. 4-digit PIN space (10000) with no IP throttle, lockout, or audit on failure (the in-code comment at L60-63 explicitly notes "to revisit if brute-force becomes a real threat" — it should be revisited now). LAN attacker bursts ~5k POSTs/s and recovers any active temp PIN within seconds; gated routes then accept that cookie until DB row expires/revokes. **Fix:** Apply the same in-memory IP rate limiter as `app/api/auth/pin/route.js` (5 attempts / 60s) and audit failures.

- **Cleaning-schedule PATCH allows cross-location row rewrites with no PIN gate** — `app/api/cleaning-schedule/route.js:105, 130-138, 178`. PATCH accepts `body.location_id` and writes it directly into the UPDATE; route has no `hasPinCookie`/`hasPinOrTempPin` check (PATCH not in middleware match either). Any LAN client can rewrite `cleaning_schedule.location_id = 'rival-site'` to surface that row in another location's UI (data poisoning + cross-tenant leak). Same shape may exist on other PATCH-with-location_id routes (audit pass needed). **Fix:** Drop `location_id` from PATCH-able fields entirely (location is a row-identity column, not mutable property); if reassign is genuinely needed, gate behind `hasPinCookie` and emit an audit event.

### MEDIUM

- **`/api/audit/log` is the only gated read of audit data; ban external `SELECT` on `audit_events`** — middleware matcher only covers `/api/audit/*`. Today the table is write-only via `lib/auditEvents.ts`; a future route adding `SELECT * FROM audit_events` would skip the gate. **Fix:** Add a comment + lint/grep CI check banning external SELECTs on `audit_events`.

- **`getAuditLogByAction` last-1000 cap silently drops history** — `lib/auditLog.mjs:98-106`. Inspector reading the UI sees "no edits" when record exists past row 1000. Integrity issue for HACCP defense. **Fix:** Stream-read JSONL or paginate.

- **CSRF: temp-PIN cookie uses `SameSite=Lax`; master PIN cookie correctly `Strict`** — `app/api/auth/temp-pin/login/route.js:93` vs `app/api/auth/pin/route.js:76`. Lax allows top-level navigation POSTs from external origins; combined with no CSRF token, a manager who clicks an attacker link could trigger gated state-changes carrying their temp-PIN cookie. **Fix:** Change temp-PIN cookie to `SameSite=Strict`.

- **`actor_cook_id` accepted from request body without scrubbing in many routes** — known-MEDIUM (memory `project_audit_actor_cook_id_caller_asserted`); confirmed unchanged in `app/api/breaks/route.js:97`, `sick-worker/route.js:100`, `eighty-six/route.js:71`, `inventory/route.js:157`. Caller can attribute audit row to any cook id. **Fix:** Resolves with future auth scaffolding (already tracked); meanwhile do not let any NEW route accept it.

- **Cloud-bridge dead-letter `[id]/drop` and `[id]/requeue` routes — PIN gate not verified by this audit** — agent did not open those files. Middleware does NOT cover `/api/cloud-bridge/*`. **Fix:** Verify both files re-check `hasPinCookie(req)`. (Orchestrator note: both DO call `requirePin(req)` per the just-landed idempotency commit — verified in scope-2 work earlier this session.)

- **`fs.appendFileSync` to user-controlled audit payloads — bounded** — `lib/auditLog.mjs:44`. Path comes from `LARIAT_AUDIT_PATH` env (not user-controlled). Risk only if an API route ever sets that env from a request. Informational.

### LOW / INFO

- `pin_signed: !!process.env.LARIAT_PIN_SECRET` exposed via `GET /api/auth/pin` — reveals deployment posture. Acceptable but document.
- `generateAuditId` uses `Math.random()` — non-cryptographic; only for log-entry id collision avoidance, not security.
- `.gitignore` has `.env.local` but not `.env` / `.env.*`. **Fix:** add `.env` and `.env.*` (with `!.env.example`).
- Sandbox costing payload guard: `app/api/specials/route.js:122-129` correctly filters by `typeof` before flow into compute. Action-engine handler wrapped in try/catch (L638-640).
- Ollama integration uses fixed env-supplied URL (`lib/ollama.ts:5`); no user-controllable URL component → no SSRF.
- All dynamic SQL UPDATEs use static column allowlists (verified in `reservations/[id]`, `specials/saved/[id]` `SAFE_COLS`, `cleaning-schedule`, `service-hours`, `certifications`, `prep-tasks/[id]`). No SQLi via column names.

### Defense-in-depth opportunities

- Replace per-route `requirePin(req)` boilerplate (16+ duplicate copies) with a single helper in `lib/pin.ts` that returns the 401 Response — easier to audit + harden uniformly.
- Add an integration test that POSTs every route in `middleware.js`'s SENSITIVE list **without** the cookie and asserts 401 — would have caught cleaning-schedule PATCH gap and any future regression.
- Document that `idempotency_keys` table holds full response bodies for 24h. Engineers must not return raw secrets/PII in any wrapped route's response. Consider per-route opt-in to caching rather than wrap-all.
- Add migration that includes `location_id` in the unique key on `idempotency_keys` (currently keyed on `key` alone — buggy client at location A could reuse a key minted at location B and get a cross-location cached response).

---

## 2. HACCP rule modules + audit subsystem

### HIGH

- **TPHC PATCH: pre-flight SELECT + UPDATE split across transaction boundary creates a TOCTOU race** — `app/api/tphc/route.js:120-135`. The `existing` row is fetched and the `discarded_at IS NULL` guard checked OUTSIDE `performUpdate`; only the UPDATE runs inside the tx. Two concurrent PATCH requests can both pass the guard and double-write `discarded_at`. Every other mutable route (cooling, date-marks, sick-worker) correctly runs SELECT + guard + UPDATE atomically. **Fix:** Move the `SELECT` and both guard checks (`!existing`, `existing.discarded_at`) inside `performUpdate`.

- **`postAuditEvent` out-of-transaction warning is advisory, not enforced** — `lib/auditEvents.ts:53-55`. The `!db.inTransaction` check logs a warning but does not throw; a future caller that mistakenly places `postAuditEvent` outside a transaction silently produces unatomic audit rows. CLAUDE.md states "an audit failure must roll back the source row." **Fix:** Convert `console.warn` to `throw new Error(...)` so the invariant is machine-enforced.

- **`lib/pestControl.ts` missing FDA citation constants** — `lib/pestControl.ts:1-26`. No exported citation constants, no module-level doc comment citing FDA §6-501.111, no validator reference to the controlling cite. Every other HACCP rule module (cleaning, sanitizer, calibrations, sds, receiving, tphc, cooling, tempLog, dateMarks, sickWorker) exports named citation constants per CLAUDE.md "the rule module is the single source of truth for thresholds and FDA/CO citations." Test file even acknowledges: "The rule module does not yet export this as a constant." **Fix:** Add `export const PEST_CITATION = 'FDA §6-501.111 — controlling pests…'` (and CO 6 CCR 1010-2 cite) and reference in validator return shape.

### MEDIUM

- **`lib/tempLog.ts` hot-hold citation mismatch — threshold hardened beyond Code without proper secondary cite** — `lib/tempLog.ts:139-142`. `hot_hold` sets `required_min_f: 140` but the citation reads `"FDA §3-501.16(A)(1) — hot-hold ≥ 135°F (house policy 140)"`. Inspector pulling citation programmatically sees `135°F` in text but `140°F` enforced. **Fix:** Add a separate house-policy field, or rewrite to `"FDA §3-501.16(A)(1) — hot-hold ≥ 135°F; house floor raised to 140°F"` + pin distinction in test.

- **`cook_eggs` shares `CCP-5` with `cook_ground_beef` — wrong CCP grouping** — `lib/tempLog.ts:129-134`. Shell eggs (§3-401.11(A)(2)) and comminuted meat are different failure contexts; an inspector grouping the tile by CCP sees them conflated. **Fix:** Assign distinct `ccp_id` (e.g. `CCP-5b` or `CCP-5e`) to `cook_eggs`; update data/cache CCP defs.

- **Receiving 422 for `rejected` lines exposes `needs_corrective_action: true` misleadingly** — `app/api/receiving/route.js:164-174`. Rejected delivery + missing `corrective_action` returns `{ needs_corrective_action: true, status: 'rejected' }`. UI may prompt "add a note and resubmit" — but rejected = outright refuse, not "drift band: add a note and accept." **Fix:** Return distinct `needs_rejection_note: true` for the rejected-without-note case.

- **`lib/sds.ts` `last_reviewed` validation accepts phantom dates** — `lib/sds.ts:239-243`. Regex `/^\d{4}-\d{2}-\d{2}$/` only checks format; subsequent `Date.parse` does not reject e.g. `2026-02-30` (Date.parse normalizes to March 2). Unlike `lib/dateMarks.ts` (UTC round-trip compare), `sds.ts` skips round-trip. Phantom dates corrupt the inspector-facing "current SDS" check. **Fix:** Apply the round-trip pattern from `lib/dateMarks.ts::parseDateStrict()`.

### LOW / INFO

- `lib/idempotency.ts:208-211` — dead export `_sweepCount()` always returns constant `0`; comment acknowledges `_swept` is never incremented. **Fix:** Remove or wire counter.
- `lib/beoFireSchedule.ts` — in HACCP scope but not actually a HACCP rule module (no citations, no thresholds). Correctly exempt from the 5-file pattern; doc as such.
- `lib/pestControl.ts:1` — missing module header; every other HACCP lib begins with multi-line block.

### Test coverage gaps

- `tests/js/test-pest-api.mjs` — no transactional rollback test (corrupt DB mid-tx, assert zero rows in both `pest_control_log` and `audit_events`). Other API tests follow this pattern; pest doesn't.
- `tests/js/test-sanitizer-api.mjs` — no rollback assertion for the `sanitizer_checks` row when audit insert fails.
- `tests/js/test-tphc-rules.mjs` — `scanActiveTphc` has no boundary test at exactly `TPHC_WARNING_MINUTES` (30) — inclusive vs exclusive at the cutoff is unpinned. Add 30-min and 31-min cases.
- `tests/js/test-date-mark-rules.mjs` — `scanExpiringBatches` exercises `discarded_at IS NULL` only in the include direction; the skip path is unasserted.

---

## 3. Cloud-bridge + multi-instance LAN

### HIGH

- **Drainer keepalive in standalone script is a no-op — process exits immediately in headless deploys** — `scripts/cloud-bridge-drainer.mjs:63-66`. Comment acknowledges `keepalive.unref()` means the interval does NOT keep the loop alive; only the SIGTERM/SIGINT listener registration holds the process open. If Node ever changes listener-keepalive behavior, or the script runs in an environment that drains handlers differently, the drainer exits silently without processing. **Fix:** Replace unref'd keepalive with `setInterval(() => {}, 2147483647)` without `.unref()`, or use `process.stdin.resume()` / `process.once('beforeExit')` guard.

- **`nack()` dead-letter is read-then-write outside a transaction — TOCTOU with `claim()`** — `lib/cloudBridgeQueue.ts:174-196`. Reads `attempts` with plain SELECT, then conditionally branches. Between SELECT and UPDATE, a concurrent `sweepStaleClaims()` could reset `claimed_at` to NULL, making the row visible to `claim()` again before the nack UPDATE fires. **Fix:** Wrap SELECT + UPDATE in a single `db.transaction(...)`.

- **`claim()` read-then-update is not atomic — double-claim race between two concurrent drainer workers** — `lib/cloudBridgeQueue.ts:110-144`. SELECT and the subsequent UPDATE transaction are two separate SQLite operations. If both the in-process drainer (instrumentation) and the standalone script run simultaneously (a documented "belt-and-suspenders" scenario), worker A's SELECT can return a row that worker B's SELECT also returns before either UPDATE fires → both push the same batch. WAL does not make this atomic. **Fix:** Use `UPDATE … WHERE claimed_at IS NULL … RETURNING id` (SQLite 3.35+) so the claim itself is the race-free lock, or serialize claim+update under EXCLUSIVE locking.

### MEDIUM

- **`bootCloudBridgeDrainer` orders `stash.booted = true` BEFORE `installSignalHandlersOnce()`** — `lib/cloudBridgeDrainerLifecycle.ts:129-131`. If installSignalHandlers ever throws (e.g. process.on limit), drainer runs without SIGTERM handler and subsequent boots no-op. **Fix:** Move `booted = true` after handler install, or wrap in try/finally.

- **`mdnsDiscovery.ts::warnOnce` shared module-level state — package-load warning suppresses all subsequent unrelated warnings** — `lib/mdnsDiscovery.ts:81-91`. Single `warned` boolean; if Bonjour constructor fails after package loads fine, the publish-failure warning is silently swallowed. **Fix:** `Map<string,boolean>` keyed by warning category, or per-site booleans.

- **`startDrainer()` singleton silently ignores `opts` on second call** — `lib/cloudBridgeDrainer.ts:213-222`. Calling once from instrumentation with `tickMs:5000` then once from standalone script with `tickMs:60000` silently keeps the first config. **Fix:** Log warning when handle already exists and incoming opts materially differ.

- **`instrumentation.ts` dynamic-imports `mdnsAdvertiseLifecycle.ts` with `.ts` extension** — `instrumentation.ts:41,44`. Requires `--experimental-strip-types` active for the Node process; Next.js does not guarantee. CLAUDE.md flags this for `node --test` paths. **Fix:** Verify Next process invocation includes the flag or use compiled paths; add CI assertion that instrumentation hook fires without error.

- **`/api/peers` not PIN-gated but exposes `pubkey_fp` fingerprints + full mDNS metadata** — `app/api/peers/route.js:26-52`. Skipped PIN gate intentionally ("peer discovery has to work before a user has entered a PIN"). `pubkey_fp` was added later (Item 13). Lets unauthenticated attacker enumerate all peer fingerprints + topology (host, port, location_id, version). **Fix:** Strip `pubkey_fp` from the unauthenticated response; only return it to authenticated sync handshakes.

### LOW / INFO

- `lib/cloudBridgeQueue.ts:183-187` — DLQ rows stamp `claimed_at = datetime('now')` as a tombstone; field name misleading. **Fix:** rename or add `dead_lettered_at` column in a future migration.
- `lib/cloudBridgeDrainerLifecycle.ts:133-135` — reads `LARIAT_DRAINER_TICK_MS` for log message but does NOT pass it to `startDrainer()`. Env var has no effect when booted via instrumentation. **Fix:** thread `{tickMs}` into `startDrainer()`.
- ~~`ops/launchd/com.seanburdges.lariat.mdns-responder.plist:27` — runs `npm run mdns:advertise` but `scripts/mdns-advertise.mjs` was not found via glob.~~ **Resolved (stale finding):** `npm run mdns:advertise` maps to `node --experimental-strip-types scripts/start-mdns.mjs` via package.json's `scripts` block — that file exists, calls `lib/mdnsDiscovery::advertise()`, and handles SIGTERM cleanly. The orchestrator-note hedge in the original finding turned out to be the right call. A clarifying comment was added to the plist (above `ProgramArguments`) so the next reader doesn't repeat the same investigation.
- `lib/cloudBridgeDrainerLifecycle.ts:26` — header section titled "Mutual exclusion" but actual behavior is "coexistence under claim/ack dedup." Misleading. **Fix:** rename to "Coexistence."

### Tech-debt / refactor opportunities

- `claim()` + `nack`/`ack` use separate prepared statements per call — no statement caching. Better-sqlite3 caches per-instance only when same string is reused. Extract module-level `const` prepared statements.
- `peerKey()` fallback chain in `hubFailover.ts` produces theoretically prefix-colliding keys if host value starts with `s:` and started_at-only path is taken. Low probability but latent.
- `cloudBridgeQueue.ts` comment on `requeueDeadLetter` references `docs/data-governance.md` — that doc doesn't exist. Track as follow-on.

### Test coverage gaps

- No test for retry-budget exhaustion via the drainer's `tick()` loop — `test-cloud-bridge-drainer.mjs` doesn't pin the boundary at exactly attempt 5.
- No test for `sweepStaleClaims()` running concurrently with a fresh claim within `staleClaimAgeSec`.
- No test for `pushBatch` with a 4xx response body > 500 bytes — the 500-byte slice guard at `cloudBridgePush.ts:142` is untested.
- No test exercises `LARIAT_DRAINER_TICK_MS` env-var wiring (and would catch the bug above where it's read but not passed).
- No test for `hubFailover.ts::detectHubChange` — `test-hub-election.mjs` covers `electHub` but not the failover classification layer (5 HubChange variants).

---

## 4. Compute engine + costing pipeline

### HIGH

- **`recomputeMarginAnalysis` calls `computeMenuEngineering(locationId)` which calls `getDb()` internally, bypassing the threaded `db` handle** — `lib/computeEngine/marginAnalysis.ts:6` / `lib/menuEngineering.ts:1,57`. In a WAL test context this opens a second DB connection; in fire-and-forget production inside `setImmediate`, could race a concurrent WAL write between response flush and callback execution. The `db` parameter is honored by `recomputeRecipeCosts` and `computeAccountingVariance` but silently ignored by margin step. **Fix:** Extend `computeMenuEngineering` to accept optional `db` and thread through `buildDishComponentMap` / `computeDishCost`, or open a dedicated connection in `recomputeMarginAnalysis` with explicit lifecycle.

- **`sales_lines` has no per-row date column; `computeAccountingVariance` sums all rows for a location and trusts "latest ingest = current period"** — `lib/computeEngine/accountingVariance.ts:156-160`. Code documents this as a known gap (C3 follow-up schema change). If analytics ingest writes a new period without fully deleting prior period's rows (partial ingest abort), theoretical COGS silently double-counts. The variance row's `period_start`/`period_end` constrains actual COGS but NOT theoretical COGS. **Fix:** Add `sale_date` or `period_label` column to `sales_lines` and filter the theoretical query — this is the documented C3 schema change; schedule, don't defer indefinitely.

### MEDIUM

- **`#10 can` parity comment is wrong in fixture generator** — `scripts/lib/generate_unit_convert_fixture.py:152`. Fixture comment says "unknown left → null" but `#10 can` is actually count-rejected (it's in SYNONYMS → `'can'` → in `COUNT_TO_EA`). No production bug; doc-rot in fixture would mislead future debugger. **Fix:** Correct fixture comment to "count synonym → count-rejected → null."

- **`recomputeMarginAnalysis` silently drops rows where `quadrant === 'unknown'`** — `lib/computeEngine/marginAnalysis.ts:19`. `if (row.quadrant && row.margin_pct != null)` skips dishes with no costing data; `margin_snapshots` shrinks as costing coverage drops with no signal. **Fix:** Persist unknown-quadrant rows with `margin_pct=null`; filter at query time in UI.

- **`computeStatusPostHandler` ignores request body** — `app/api/compute/status/route.js:61-62`. POST handler reads `period_start`/`period_end` from query string only; `curl -d '{"period_start":"2026-04-01"}'` silently ignored. **Fix:** Parse body or document URL-only as deliberate.

- **`import-vendor-prices.mjs` uses `category: null` unconditionally** — `scripts/import-vendor-prices.mjs:226`. Beverage rows survive costing DELETE only when `LOWER(category) IN (BEVERAGE_CATEGORIES)`. With null category, the COALESCE guard evaluates to `''` → not in beverage list → wiped on next `npm run ingest:costing`. CSV template comment acknowledges "category not surfaced yet" but no operator warning. **Fix:** Surface `category` in CSV template, or add pre-DELETE guard counting null-category rows that match beverage names.

### LOW / INFO

- `lib/ingredientKey.ts:22` — JS does not call `.trim()` after final `WHITESPACE` replace; Python (`scripts/lib/ingredient_key.py:30`) does. Inputs ending in punctuation (e.g. `"Poblano!"`) produce `"poblano "` (JS) vs `"poblano"` (Py). Fixture should expose this if regenerated. **Fix:** Add `.trim()` after final replace; regenerate fixture; add punctuation-tail test.
  - **[RESOLVED-INVALID 2026-05-09]** — JS `lib/ingredientKey.ts:21`'s inner `.trim()` (after the `NONALNUM` replace) handles the punctuation-tail case before the final `WHITESPACE` replace, which becomes a no-op. Both implementations produce identical output for all 6 traced edge cases including `"Poblano!"` → `"poblano"`. PR #213 added 5 regression test cases via the existing fixture-generator pinning the parity.
- `lib/costingBenchmarks.mjs:87` — `resolveMergedCost` computes `mean(pack_price/pack_size)`, not `(Σ pack_price)/(Σ pack_size)`. Algebraically different when pack sizes vary. Comment says "simple mean" without flagging the volume-weighting limitation. **Fix:** Expand comment.
- `lib/computeEngine/index.ts:68-77` — `pruneSnapshotTable` uses `id NOT IN (SELECT id … LIMIT ?)` subquery scan. Cheap at default 365 retention; flag for awareness if scaled.
- `scripts/ingest-costing.mjs:778` — D4 Excel-drift threshold hard-coded `$0.10` with comment promising future `$1.00` hard-fail. No tracked ticket. **Fix:** Add issue number; consider promoting to non-zero exit code.

### Tech-debt / refactor opportunities

- `recomputeMarginAnalysis` accepts unused `db` param (related to HIGH above).
- `computeAccountingVariance` does DB reads inside the write transaction (`computeActualCogsBreakdown` at `accountingVariance.ts:191,205`). Externalize as pure read step before the write tx for composability.
- `sandboxCosting.ts:62` — `LIKE '%ingredient%'` per-ingredient against `vendor_prices`. O(N) per call on every Specials-sandbox submission. Main engine uses `Map` lookups; sandbox should follow.
- `lib/marginDeltas.ts:171` — `skuGroups` map key uses plain space separator (`${ingredient} ${vendor} ${sku}`) while file's other keys use NUL byte. Inconsistent; latent collision risk if values contain matching substrings.
  - **[RESOLVED-INVALID 2026-05-09]** — claim is WRONG: `od -c` of `lib/marginDeltas.ts:171` confirms `${s.ingredient}\0${s.vendor}\0${s.sku}` with NUL bytes throughout the file (consistent with the rest of marginDeltas). Audit tooling appears to have silently stripped NUL bytes when reading the source. See project memory `project_margindeltas_nul_byte_key_joiner.md` and the new top-level "Note on auditor tooling" callout.

### Test coverage gaps

- **No `tests/js/test-vendor-prices-history.mjs`** — invariant (snapshot before DELETE, run_id keying, BEVERAGE preservation) is exercised only indirectly via `test-compute-engine.mjs`. Add dedicated test asserting (a) row-count parity, (b) run_id matches `ingest_runs.id`, (c) `snapshot_at` populated, (d) beverage rows survive DELETE.
  - **[RESOLVED-INVALID 2026-05-09]** — dedicated test files exist (`tests/js/test-vendor-prices-history-and-beverage-preserve.mjs`, `tests/js/test-vendor-prices-history-on-upsert.mjs`) covering snapshot-before-DELETE, run_id keying, and BEVERAGE preservation. Audit may have run before these landed.
- **No `tests/js/test-costing-*.mjs`** — `scripts/ingest-costing.mjs` T3/T4/T5b/T6/T7 post-passes (yield-delta, unit convert, catch-weight backfill, pack-size detect, master-id backfill) have no isolated suite. C4 round-trip in `test-compute-engine.mjs` exercises final result only.
- `scripts/lib/generate_ingredient_key_fixture.py:19` — re-running the generator with the corrected JS `.trim()` would expose the parity drift. Manual verification step.
- `test-compute-engine.mjs` — no test for `computeActualCogsBreakdown` multi-vendor precedence (Shamrock-preferred over `spend_monthly`; Sysco no-fallback paths untested).
- `test-price-shocks.mjs` — does not test `listMarginDeltas` from `lib/marginDeltas.ts`. Margin deltas have no test file.
  - **[RESOLVED-INVALID 2026-05-09]** — `tests/js/test-margin-deltas.mjs` has shipped since 2026-04-25 (commit `ef22a5e`) with 10 cases; PR #214 (`87b7165`) added 4 more (empty-input, NUL collision, top-3 trim). Audit ran before #214 but the original 10-case file already existed at audit time.

---

## 5. Kitchen Assistant + Specials + Data Pack

### HIGH

- **`give_gold_star` `stars` field uses `|| 1` fallback instead of `Number.isFinite` guard** — `app/api/kitchen-assistant/route.js:476`. `Math.min(Math.max(Number(payload.stars) || 1, 1), 3)` silently coerces `null`, `undefined`, `NaN`, or `"three"` to 1 and writes a gold-star row. Inconsistent with `Number.isFinite` guards on `delta`/`qty` from the 2026-05-08 hardening pass. **Fix:** `Number.isFinite(Number(payload.stars)) ? Math.min(Math.max(Number(payload.stars), 1), 3) : null` + soft-reject path.

- **`line_check` action: `payload.reading_f` coerced via bare `Number()` before isFinite check** — `app/api/kitchen-assistant/route.js:269,271`. `let readingF = Number(payload.reading_f)` runs before isFinite. Object/array → `NaN` is caught by the gate, but pattern is inconsistent with peer actions. **Fix:** Add `typeof payload.reading_f === 'number'` check before coercing, matching `haccp_receive` at L534.

### MEDIUM

- **`scratch_notes`, `pantry_text`, `prompt_text`, `ai_answer` stored with no length cap** — `app/api/specials/saved/route.js:44-46,61` + `saved/[id]/route.js:73`. No `MAX_*` constant or `.slice()` before INSERT/UPDATE. `scratch_notes` is user-editable and unbounded. **Fix:** Add `SCRATCH_NOTES_MAX` (e.g. 4000); document intentional unbounded `ai_answer` (or cap that too).

- **`buildGroundedContext` is a 400-line monolith; vendor / labor / compliance / 86 sections not exported as `renderXxx` helpers** — `lib/kitchenAssistantContext.ts:114-519`. HACCP block (318-343), USDA (352-358), vendor (386-402), labor (405-432) inline. Project memory (`pattern_ka_context_render_helpers.md`) prescribes the extracted form. **Fix:** Extract each conditional section as exported `renderVendorContext` etc. matching `OversightSection` return shape.

- **Action engine outer `try/catch` swallows handler exceptions silently** — `app/api/kitchen-assistant/route.js:638-640`. `console.error` on the server, but caller gets a 200 with stripped LLM answer and no `actionExecuted` flag — DB write error looks like successful inference. **Fix:** Return `{ action_error: true, answer: "..." }` so client UI surfaces "action failed, check with a manager."

- **`specials/saved` POST uses `logAuditAction` (file-audit) not `postAuditEvent` (DB audit)** — `app/api/specials/saved/route.js:82`, `[id]/route.js:96`, `[id]/export/route.js:113`. Architecturally correct (specials not HACCP-regulated), but export route stamps `last_exported_at` on the specials row and the trail lands only in JSONL — invisible to `audit_events` query surface. **Fix:** Document the split; if export is ever cost-compliance attestation, promote to `postAuditEvent`.

### LOW / INFO

- `LARIAT_ASSISTANT_ENABLED` fully removed — confirmed zero matches in routes/lib/middleware. Two refs in plan docs are historical.
- `think: false` correctly hardcoded in `lib/ollama.ts:144`. Not caller-overridable.
- Specials sandbox v1 ephemeral contract holds — `app/api/specials/route.js` has no DB writes; persistence only via `saved/` sub-routes (PIN-gated).
- Data Pack graceful-degrade confirmed correct in `lib/datapackSearch.ts:36-48,64-89` — every exported function gates on `getConn() !== null` and returns `[]`/`null` without throwing. `_setAvailableOverrideForTest` hook present.
- Modelfile correctly has no baked SYSTEM block — system prompt source-of-truth in `lib/ollama.ts`.
- `extractAction` duplicated verbatim in KA + Specials routes (`route.js:39-64` / `specials/route.js:20-45`) — byte-identical 26 lines. Future fixes must apply twice.
- `USDA_NUTRIENT_PRIORITY`, `formatUnit`, `PRIORITY_DISPLAY` documented as duplicated at `app/kitchen-assistant/citationHelpers.js:1241,1282,1307`. Guarded by `test-kitchen-assistant-citations.mjs`. Acceptable.
  - **[RESOLVED-INVALID 2026-05-09]** — duplication is documented as deliberate per `app/kitchen-assistant/citationHelpers.js:8-14`'s prior-task comment ("It's OK to copy the small constants/helpers into the client component — don't refactor lib/kitchenAssistantContext.ts to share them"), with parity pinned by `test-kitchen-assistant-citations.mjs`. The audit's MEDIUM rating predates that decision.

### Tech-debt / refactor opportunities

- `buildGroundedContext` runs all "always-on" sections unconditionally — ~15 synchronous SQLite queries per inference. WAL keeps each fast but consider batched read or short-lived per-request cache.
- `extractAction` hand-rolled brace-scanner doesn't handle `\\\"` (escaped backslash before escaped quote). Low probability but consider `JSON.parse` with sentinel-prefix approach.
- `beo_prep_history` consumer hooks (project memory) — `renderBeoPrepHistory` wired into context but BeoBoard sidebar / recipes tab / menu-engineering hooks open. Tracked tech debt.
- `INGREDIENT_KEYWORDS` cold-load (~20s on first ingredients-bucket call) — no pre-warm. First cook on a quiet night waits 20+s. Consider `setImmediate` startup preload or `/api/datapack/warm` endpoint.

### Test coverage gaps

- No test for `give_gold_star` non-finite `stars` coercion path.
- No test for outer action-engine `catch` (DB write error inside handler).
- No Ollama-down 502 path test for either route — `route.js:657` / `specials/route.js:167` untested. GET ping `ollamaReachable: false` also untested.
- No `extractAction` test with nested JSON objects (`{"action":"beo_add_prep","recipes":[{...}]}`).
- `test-specials-cost-action-shape.mjs` uses source-regex pattern matching rather than exercising runtime filtering with an Ollama stub. Stronger integration test parallel to `test-kitchen-assistant-action-hardening.mjs` would catch malformed-payload cases.
- No test for `renderFdaFoodCode` / `renderUsdaIngredients` with `deps.available = () => false` (datapack-unavailable path).

---

## Notes for triage

- **Tier 1 security HIGHs** are the only items worth halting on. Each is a small focused PR (single route + test).
- **Tier 2 correctness HIGHs** mostly need a follow-up plan + scheduled work, not panic fixes. The `postAuditEvent` enforcement promotion is the cheapest win (one-line `console.warn → throw`). The `recomputeMarginAnalysis` `db` threading needs coordination with `lib/menuEngineering.ts`.
- **Tier 3 reliability HIGHs** can roll into existing follow-up PRs (drainer keepalive in the next cloud-bridge touch; gold-star isFinite in the next KA hardening pass).
- **Test-coverage gaps** are mostly "add the test next time you touch the surface" — not a separate sprint.
- **MEDIUM and LOW** findings are graphable backlog material — pick the ones that fit the next free PR.

Five agents totalled ~565k tokens, ~10 minutes wall-clock, zero code modified. GitNexus index used incidentally by some agents; most findings came from direct file reads. Repo state at audit start: `34085db` on `main`.
