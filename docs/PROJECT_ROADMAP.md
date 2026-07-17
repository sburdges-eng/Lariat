# Lariat Project Roadmap — 2026-05-16 (updated 2026-06-07)

A grounded read on what's left to make the bundled app function correctly and reach its potential. Written after the LaRi-expansion + integration-audit session — the work shipped on `feat/lari-expansion-and-audit` cleared a single slice of the surface; the rest is enumerated here.

## 2026-05-26 ERP planning completion alignment

The ERP master proposal is now captured in `docs/LARIAT_ERP_MASTER_PROPOSAL.md`. That proposal updates the practical next lane without rewriting this roadmap's audit backlog:

| Priority | Lane | Completion criteria |
|----------|------|---------------------|
| P0 | Stabilize receiving-to-inventory master contract | Delivery check-in writes audited inventory truth, ambiguous vendor matches fail closed, and management rollup can trust on-hand state |
| P1 | Harden `/management` rollup | Existing computes are composed into manager-readable tiles with PIN/audit behavior preserved |
| P1 | Pin KDS protocol drift | KDS response fields are regression-tested against the protocol before any Toast authoritative bump work |
| P2 | Continue audit backlog | Untested routes, nav gaps, env-var naming, and `@ts-nocheck` cleanup continue in the existing cadence |
| Deferred | Postgres/MySQL migration and microservices split | Revisit only after local contracts and multi-venue pressure justify the added operational burden |

Architecture impact: this alignment keeps the bundled app local-first and deterministic. It does not authorize runtime cloud AI, schema drift, or a service split.

## 2026-06-04 post-merge roadmap execution

Current baseline: `main` is at `6d9eec0` after PR #275 merged the runtime UX fixes and the three draft branches were folded into the integration branch. The stale feature branches and extra worktrees from that merge train were cleaned up before this roadmap pass.

This update records four decisions for the next freeze slice:

| Area | Decision | Roadmap impact |
|------|----------|----------------|
| `cad-kernel/` | Treat as out-of-scope for Lariat v2. Move it to a CAD/FloorPlanDesigner lane in a separate cleanup; do not build Lariat runtime coupling to it. | Keeps the restaurant app reproducible and avoids carrying an unwired C++ subsystem in the freeze story. |
| Shows / venue arm | Production-active, not deprecated. The route-hardening gap is now closed; preserve the focused coverage before changing behavior. | Roadmap 2.14 is closed by `npm run test:event-ops` plus focused settlement/capacity route tests. |
| Venue target | Single-venue first for v2. Multi-venue remains a later management UX and rollout problem after local contracts are stable. | Roadmap 3.1 stays deferred; do not expand this slice into venue switching or consolidated rollups. |
| `labor/certs` | Informational-only for v2. No regulated certification write/audit workflow is claimed until requirements are formalized. | Removes the freeze ambiguity without inventing a half-regulated module. |

LaRi status after this pass: multi-turn conversation memory is implemented and merged; `db_query` already includes the top roadmap entries (`recipe_with_bom`, `sales_depletion_unresolved`, `beo_prep_status`) and this branch adds regression coverage plus tighter location-boundary checks for those entries.

## 2026-06-16 v2.0.0 freeze close-out

The v2 freeze-fixes plan (`.hermes/plans/2026-05-24_v2-freeze-fixes.md`, T1–T8) is
closed out on `chore/v2-freeze-closeout`. T1–T6 were already shipped; T7 full
verification now passes on a clean tree (eslint 0 err · tsc app+scripts 0 err ·
jest 139 · node tests 4398/4399 — the lone failure is the known `peers-route` mDNS
concurrent-sweep flake, green in isolation · pytest 339 · `next build` clean). Two
pre-existing test defects were fixed (BeoBoard `.jsx`→`.tsx` source-guard path;
gold-stars `created_at` double-localtime flake) and `lxml`+`pdfplumber` were declared
in `requirements-tools.txt`. `CHANGELOG.md` is written. The `v2.0.0` tag is pending
operator go-ahead plus the environment-gated checks that can't run headless (Electron
notarize, PWA offline smoke, `lari-qwen` fresh-Ollama check, SageMaker teardown).

## 2026-07-04 BEO cascade completion + KDS protocol-conformance audit

Two work-streams landed on `main` this session, neither previously reflected here:

**BEO cascade chain** (#421–#424): menu-recipe coverage reached 100% on the 7-real-event
stress test (#421); on-hand inventory now actually subtracts from the order guide (#422 —
`GET /api/beo/cascade` previously always ordered the full amount regardless of stock on
hand); the cascade engine gained recipe-side `pack_size` conversions, an explicit
`(sub-recipe=slug)` pin, and `find_manifest_warnings()` for declared-but-unreferenced
sub-recipes (#423); and those warnings are now surfaced end-to-end through the web UI and
LariatNative (#424). The predecessor branch `feat/beo-scoping-cascade-onhand` (PR #369,
270 commits stale) was **closed, not merged** — a capability audit found roughly half its
logic had already shipped elsewhere (location-scope T1 via #409, same-dimension unit
conversion already generalized into `convert_qty`); the rest was re-landed fresh in #423/#424
rather than rebased, since `bom_expand.py` had structurally moved on.

**KDS protocol-conformance audit** (PR #425, open as of this writing): this directly
continues **Tier 1 row 1.3** ("Pin KDS protocol drift") above — 1.3 pinned the bump route's
response *field names* against `Lariat-KDS/docs/lariat-kds-protocol.md`, but a deeper audit
against the protocol's actual value formats and the Swift client's real parsing code found
1.3's pinning had missed 4 real drift bugs, one a live production defect: **every bump
carrying a `bumped_at` timestamp was silently 422'd**, because the server required
millisecond-precision ISO-8601 while the protocol's own documented example (and the Swift
client's default formatter) is bare-seconds. Also fixed: a re-bump's correction audit row
recorded the wrong `entity_id` (stale `lastInsertRowid` on the UPDATE path of the upsert); a
transient 5xx was cached under the idempotency key for 24h, permanently blocking retries; and
a same-body in-flight race returned 409 (reserved for a different-body conflict) instead of a
retriable 503. The last two touch the shared `withIdempotency` wrapper (19 HACCP-regulated
callers) — impact-analyzed CRITICAL, confirmed safe before editing (none of those routes
exercise the idempotency-key path in their own tests). **Not yet ported**: the identical
stale-rowid bug also exists in `LariatNative/Sources/LariatDB/KdsTicketRepository.swift` —
out of this audit's web-only scope.

**Unrelated, noticed in passing**: `test-idempotency-coverage.mjs`'s regulated-route sweep
currently fails on 2 violations (`purchasing/vendor-link/attach` + `pair`, from #360) — a
*different* pair of routes than the 3 the tier-3 PR (#316) reported as pre-existing back on
2026-06-11 (`manager-pins` + two `recipe-photos` routes, since fixed). The violated set
rotates as new mutation routes ship without the wrapper; worth a sweep, not itself a roadmap
item.

## How this was scoped

I read every doc in `docs/`, the last 30 commits, the schema, the nav registry, the API routes, the audit document I produced this session, and the recent audit-cycle history (the M/L/H-numbered hardening sweeps). I excluded recommendations I couldn't ground in observed evidence. Effort estimates: **XS** = <1hr, **S** = half-day, **M** = 1–2 days, **L** = week, **XL** = sprint+.

The team already runs disciplined audit cycles (H1–H9, M1–M11, L1–L4, C5 visible in recent commits). This roadmap is shaped to slot into that cadence rather than displace it.

---

## Tier 0 — Pre-flight (before anything else)

This is the work to actually land this session's deliverables.

| ID  | Effort | Item |
|-----|--------|------|
| 0.1 | XS     | **Closed (stale, 2026-06-11):** no `.git/index.lock` present; the four-commit split from the 2026-05-16 handoff was long since superseded by merged PRs. |
| 0.2 | XS     | **Closed (2026-06-11):** `npm run validate:db-query-registry` all OK + `test:db-query-tool` 22/22 green on macOS. |
| 0.3 | XS     | Manual smoke: ask LaRi "any cooling cycles in progress?" cook-tier, then "what did we sell today?" manager-tier. Confirm audit_events has new `db_query` rows. *(Still open — needs a human at the keyboard with Ollama running.)* |
| 0.4 | S      | **Closed (obsolete, 2026-06-13):** the premise no longer holds. `/api/specials` now sends `CREATIVE_SYSTEM` (not `GROUNDED_SYSTEM`) and no longer imports the grounded prompt, so the specials sandbox never sees the `db_query` rule #11. `CREATIVE_SYSTEM` contains no `db_query` content. No prompt-slimming refactor needed — the separation the handoff proposed already exists. |
| 0.5 | S      | **Closed (2026-06-11):** full backend sweep 4,313/4,313 (all `tests/js/*.mjs` incl. schema/datapack/compute-engine), jest 136/136, e2e 15/15 — see PRs #318/#320. |

---

## Tier 1 — This sprint (correctness + completeness gaps already identified)

Stuff the audit surfaced that should land before next ship. Each row has a clear acceptance criterion.

### 1A. Audit cleanup (the six findings I didn't fix)

| ID  | Effort | Item | Acceptance |
|-----|--------|------|------------|
| 1.1 | S      | **Closed:** `LARIAT_LOCATION_ID` is canonical; the older location alias still falls back with a one-shot warning, and operator docs show only the canonical name. | `tests/js/test-env-canonical-vars.mjs` and `tests/js/test-location-from-body-or-request.mjs` pin docs, fallback, canonical precedence, and one-shot warning behavior. |
| 1.2 | S      | **Closed:** `LARIAT_7SHIFTS_API_KEY` is canonical; the older 7shifts alias still falls back with a one-shot warning, and operator docs show only the canonical name. | `tests/js/test-env-canonical-vars.mjs` and `tests/js/test-health-route.mjs` pin docs, fallback, and one-shot warning behavior. |
| 1.3 | M      | **Closed:** `/api/kds/tickets/[id]/bump` response fields are pinned against `Lariat-KDS/docs/lariat-kds-protocol.md`. | `tests/js/test-kds-bump-route.mjs` parses the protocol doc's `Response schema (200)` JSON block and asserts the route response keys match exactly; local runs prefer the sibling `Lariat-KDS` doc, and CI runs `npm run test:kds-bump` against a source-pinned fixture so route/contract drift fails the build without a private-repo token. |
| 1.4 | M      | **Closed:** `/api/health` response is pinned across happy, degraded, down, optional-credential, mDNS-conflict, and test-release paths. | `tests/js/test-health-route.mjs` keeps the happy path offline by stubbing Ollama and temp-dir local probes, and asserts `503/down` when required probes fail. |
| 1.5 | M      | **Closed:** BEO share-flow tests now pin `/api/beo/[id]/share-token`, `/api/beo/share/[token]`, and `/api/beo/share/[token]/sign` across valid, expired, revoked, cross-location, and signature paths. | `tests/js/test-beo-share-api.mjs` covers token mint/idempotency/re-mint, valid public reads, expired/revoked 404s, cross-BEO line isolation, signature validation, and signature/audit insertion. |
| 1.6 | S      | **Closed:** `/concept-layout` was deleted by PR #263 (`7caead3`, 2026-05-18); follow-up checks confirmed `app/concept-layout/` is absent and app/test references are gone. | `node --experimental-strip-types --test tests/js/test-nav-shortcuts.mjs`, `npm run build`, and focused `rg` checks validate route removal, nav coverage, and a clean build. |
| 1.7 | M      | **Closed:** `/costing/price-shocks` is palette-registered and renders a 14-day / 10% price-move table with a per-row sparkline; the touched page is migrated to `// @ts-check`. | `tests/js/test-price-shocks.mjs` pins the page contract and helper behavior; `tests/js/test-db-query-tool.mjs` pins `vendor_price_shocks` as manager-tier, request-location scoped, and page-compatible. |
| 1.8 | L      | **Closed:** F4 — start the `@ts-nocheck` cleanup as touch-on-edit policy: every PR that touches a `@ts-nocheck` file migrates it to `@ts-check` + JSDoc typedefs in the same commit. No big-bang; expect ~20 files migrated per sprint. | `app/api/kitchen-assistant/route.js` is migrated to `@ts-check` with JSDoc typedefs; the conversation-memory route fixture now seeds live-in-TTL turns so the route's expiry sweep remains covered. |

### 1B. Add the missing nav entries I didn't get to

The audit F1 route list is now covered: labor, inventory, admin, and menu-engineering static pages are registered in navRegistry; `/install` and `/login-pin` have explicit setup/auth exclusions; `/management/pins` is now registered as the remaining static Management page.

| 1.9 | M | **Closed:** navRegistry now includes the missing static management PIN page and `tests/js/test-nav-shortcuts.mjs` sweeps every non-dynamic app page. | All non-dynamic pages either in navRegistry OR explicitly excluded with a code comment. |

### 1C. The integration depth the audit didn't have time for

| ID   | Effort | Item |
|------|--------|------|
| 1.10 | M | **Closed:** Toast OAuth refresh-token handling is covered by `scripts/toast_api/auth.mjs`; `isCacheStale()` refreshes 5 minutes early and `tests/js/test-toast-api-helpers.mjs` pins the boundary. |
| 1.11 | M | **Closed:** 7shifts rate-limit handling now lives in `scripts/sevenshifts_api/client.mjs`; HTTP 429 retries honor `Retry-After` with bounded fallback backoff, pinned by fake-fetch coverage in `tests/js/test-sevenshifts.mjs`. |
| 1.12 | L | **Closed:** `Lariat-KDS` PR #2 merged at `84adff3` (head `c694206`), adding the Core `BumpResponse` parser and protocol-doc sentinel tests for `id` + `bumped_at`; `swift test` is 27/27. |
| 1.13 | M | **Closed:** Cloud-bridge replay determinism is pinned by `tests/js/test-cloud-bridge-replay-determinism.mjs`, which captures outbox batches, replays them into a fresh local projection, replays the same capture again, and asserts canonical state-equivalence plus location-scoped dedup. |
| 1.13a | S | **Closed (2026-07-16):** The venue→cloud push envelope is now `/v2` canonical + per-table `schema_version`, single-sourced across web/native with byte-parity fixtures (C.3 of the 2026-07-16 parity-harness spec). |
| 1.14 | S | **Closed:** idempotency-key TTL is the lazy `sweepExpired()` path in `lib/idempotency.ts`, covered by `tests/js/test-idempotency-wrapper.mjs` case 5. |

---

## Tier 2 — Next quarter (real depth + the deferred Phase 3)

Larger work that requires its own design conversation up-front.

### 2A. LaRi reaches its potential

The `db_query` action is the foundation. To reach the potential the project_instructions implied:

| ID  | Effort | Item |
|-----|--------|------|
| 2.1 | M  | **Closed 2026-06-04:** Multi-turn conversations. Browser-managed `conversation_session_id`, explicit New Chat reset, bounded SQLite history, and final visible-answer storage are merged on `main` via PR #275. |
| 2.2 | M  | **Closed:** Summarization pass. When a `db_query` returns >20 rows, route the table back through the same local Ollama model with a tighter prompt to produce a 2-sentence summary alongside the raw table. | `tests/js/test-kitchen-assistant-db-query-summary.mjs` pins the >20-row summary call, preserves the raw table, records a `db_query_summary` source, and confirms the 20-row threshold does not trigger a second model call. |
| 2.3 | L  | **Closed:** Semantic search over recipes + BEOs. The cook-tier `semantic_search` read action now searches the local recipe book, location-scoped BEO line/prep rows, safe kitchen audit payloads, and fuses Data Pack recipe hits when the off-tree BGE index is available. | `tests/js/test-kitchen-semantic-search.mjs` pins fuzzy "wedding cake ... cherry filling" retrieval across recipes, BEOs, and safe audit payloads without cross-location or manager-only audit leakage; `tests/js/test-kitchen-assistant-semantic-search.mjs` pins route execution on the question path without a manager PIN. |
| 2.4 | M  | **Closed:** Registered query expansion now includes `recipe_with_bom`, `sales_depletion_unresolved`, `beo_prep_status`, `equipment_maintenance_due`, and `peer_trust_status` in `lib/dbQueryRegistry.ts`. `tests/js/test-db-query-tool.mjs` pins execution, tier gating, schema preparation, location-boundary canaries where applicable, and the peer-trust output contract without exposing full peer pubkeys. |
| 2.5 | M  | **Closed:** Dev-mode `code_search` action is env-gated (`LARIAT_DEV_CODE_SEARCH=1`), manager-tier, and ripgrep-backed. It is advertised only to PIN-authenticated local dev sessions, emits relative paths only, blocks cook-tier or disabled hallucinated payloads before ripgrep, and records a redacted `code_search` audit view row without raw search text. | `npm run test:dev-code-search` pins the pure tool boundaries plus `/api/kitchen-assistant` route discovery/execution behavior. |
| 2.6 | L  | **Closed (2026-06-12):** Long-press push-to-talk shipped via Web Speech (PR #320), and the local Whisper backend landed behind `LARIAT_WHISPER=1` — `lib/whisperTranscribe.ts` (whisper-tiny ONNX via the existing transformers stack, server-local inference) + `POST /api/transcribe` + Web Audio PCM capture in the composer, with Web Speech as the automatic fallback when the flag is off. No cloud Whisper (freeze note respected — inference is on the venue host). Operator enablement: `docs/OPERATIONS_HANDOFF.md` §6. |
| 2.7 | M  | **Closed:** Action confirmation surfaces. Single-row LaRi write actions (`eighty_six`, `update_inventory`, `line_check`, `haccp_receive`, `maintenance`, `update_order_guide`, `give_gold_star`) now return 30-second `undo` metadata, and `POST /api/kitchen-assistant/undo` reverses the visible write (86 rows are resolved; other rows are deleted) inside the same transaction as an append-only `audit_events` `action='correction'` row linked by `replaces_id`. Batch actions (`scale_recipe`, `beo_add_prep`, `generate_prep`) never offer undo. The client shows a toast-like card with the label, a live countdown, and an Undo button that auto-expires at 30s and clears on a new question. | `tests/js/test-kitchen-assistant-undo.mjs` pins undo metadata, 86 resolve + correction linkage, line-check delete + correction, 30s expiry rejection, double-undo rejection, and the no-undo batch contract; `app/__tests__/KitchenAssistantClient.conversation.test.jsx` pins the card, countdown, undo request, expiry, clear-on-new-question, and error copy. |
| 2.8 | M  | **Closed (2026-06-09, PR #312):** Manager-safe morning digest at `/morning` + `/api/morning` assembles 86s, price shocks, certs expiring, maintenance due, and BEO prep from existing tables, with paste-ready Slack webhook text. Automated Slack *posting* is intentionally not wired — it requires an operator-supplied webhook URL. `tests/js/test-morning-digest.mjs` pins the contract. |

### 2B. UI v2 migration (real, not just the demo)

The `docs/redesign/lari-ui-demo.html` is a prototype. A real migration needs:

| ID  | Effort | Item |
|-----|--------|------|
| 2.9  | XS | **Closed:** Design tokens are extracted into `styles/tokens.css` and loaded before the current authoritative `styles/globals.css` definitions so shipped UI can opt in without visual regression; `tests/js/test-design-tokens.mjs` pins the token file, core paper/ember/sage/brass/rust tokens, `.k-dark`/`.k-night`, font import, and import order. |
| 2.10 | L  | **Closed:** The first `/v2` shell is implemented as a cookie-gated side-by-side route tree. `/v2` reads the stable `lariat_v2=1` preview cookie, hides v1 cockpit chrome only inside the v2 subtree, keeps v1 as default, and lists the cook-tier migration anchors without replacing v1 routes. |
| 2.11 | XL | **Code complete; Stage 1 ready to start (as of 2026-07-04):** Cook-tier v2 routes exist behind the preview cookie — `/v2/today`, `/v2/kds/punch`, `/v2/eighty-six`, `/v2/stations/*` — with structure tests (`tests/js/test-v2-*.mjs`). Full-shift parity (`docs/V2_CUTOVER_PLAN.md` entry criterion 2) was declared satisfied 2026-06-12 (PRs #322/#331/#332) and Stage 0's internal shift smoke passed the same day (`docs/audit/2026-06-11-v2-stage0-readiness-evidence.md`). Rollback owner named 2026-07-04 (Sean Burdges) — the last blocker on Stage 1. `/v2/enable` + `/v2/disable` routes (2026-07-04) give each pilot device a one-tap bootstrap/rollback instead of devtools. Only remaining step is in-person, not code: visit `/v2/enable` on the pilot device(s). |
| 2.12 | XL | **Code complete; waiting on Stage 1 (as of 2026-07-04):** Manager-tier v2 routes exist — `/v2/command`, `/v2/management`, `/v2/analytics` — wrapping the live v1 pages with awaited `searchParams` (Next 16). Same status as 2.11: full-shift parity satisfied 2026-06-12, rollback owner named 2026-07-04. Stage 2 (manager pilot) can't start until Stage 1 has a clean cook-tier pilot window first, per `docs/V2_CUTOVER_PLAN.md`. |
| 2.13 | M  | **Closed:** The v1→v2 rollout + rollback plan now lives in `docs/V2_CUTOVER_PLAN.md`. It keeps `/v2` side-by-side during rollout, defines cutover entry gates and rollback triggers, and explicitly forbids deleting v1 routes until v2 has 30 clean production days. |

### 2C. Test coverage to production-ready

37 untested API routes (per audit F3). Beyond the three I called out as P1 (KDS bump, health, BEO share):

| ID  | Effort | Item |
|-----|--------|------|
| 2.14 | L  | **Closed:** Show/box-office route family is pinned across stage setup, sound scenes, SPL readings, box-office lines, deal terms, settlement reads/print view, and capacity overrides. Product call on 2026-06-04 still stands: the live-music venue arm is production-active, so future changes must preserve this coverage rather than deprecate the surface. `npm run test:event-ops` covers stage/sound/SPL/box-office, while `tests/js/test-settlement-route.mjs`, `tests/js/test-settlement-pdf.mjs`, `tests/js/test-settlement-deal-parser.mjs`, and `tests/js/test-show-capacity-api.mjs` cover the focused settlement/deal/capacity routes. |
| 2.15 | M  | **Closed:** Inventory count routes are pinned across open, line upsert, closed-count rejection, close/reopen, location scoping, GET detail, schema migration, and cross-location line-count/detail leakage canaries. `tests/js/test-inventory-counts-api.mjs` covers `/api/inventory/counts`, `/api/inventory/counts/[id]`, and `/api/inventory/counts/[id]/lines`; summary/detail reads now filter count lines by count location. |
| 2.16 | M  | **Closed:** Recipe-photo + raw routes are pinned across upload validation, PIN-gated mutations, list/delete visibility, raw reads, hero pinning, caption edits, cleanup retention, and raw-path containment. `readPhoto()` now only serves files under `data/uploads/recipes`, so a bad `recipe_photos.stored_path` row cannot stream arbitrary local files. |
| 2.17 | M  | **Closed:** Cloud-bridge DLQ admin routes are pinned for PIN-gated reads, location-scoped listing, requeue/drop success paths, 400/404 handling, audit rows, alive-row refusal, and cross-location IDOR guards. `tests/js/test-cloud-bridge-dead-letters-api.mjs` covers `/api/cloud-bridge/dead-letters` plus `/api/cloud-bridge/dead-letters/[id]/{drop,requeue}`, and `tests/js/test-cloud-bridge-queue.mjs` covers the queue primitives behind those handlers. |

### 2D. Performance + scale work I didn't audit

| ID  | Effort | Item |
|-----|--------|------|
| 2.18 | M  | **Closed:** DB index audit is measured and pinned for the named `db_query` suspects. `tests/js/test-db-query-indexes.mjs` seeds realistic vendor-price history and audit-event rows, runs `EXPLAIN QUERY PLAN` against the registered SQL, and proves `vendor_price_shocks` uses `idx_vph_loc_snapshot_shock (location_id, snapshot_at DESC)` while `audit_log_recent` uses `idx_audit_recent_loc_created (location_id, created_at DESC)` with and without optional filters. |
| 2.19 | M  | **Closed:** better-sqlite3 WAL checkpoint policy is explicit and pinned. `lib/db.ts` opens the shared app DB in WAL mode, enables foreign keys, keeps `synchronous = FULL`, and sets `wal_autocheckpoint = 1000` (~4MB at the default page size); `tests/js/test-db-connection-pragmas.mjs` now covers those connection PRAGMAs through the CI-backed `npm run test:schema` gate. |
| 2.20 | L  | **Closed:** Bundle-size audit is measured against the pre-bump parent of `30d9232`. `scripts/bundle-size-audit.mjs` reads local `.next` and desktop wizard build artifacts, emits deterministic `schemaVersion` JSON, and fails closed when the production build is missing. Current post-bump baseline: Next static JS 1,509,334 B / 506,209 gzip, Next server JS 8,473,695 B / 2,289,706 gzip, edge runtime 278,291 B / 81,079 gzip, desktop wizard JS 194,626 B / 60,768 gzip. See `docs/audit/2026-06-07-bundle-size-audit.md`; `npm run test:bundle-audit` pins the parser and path invariants. |
| 2.21 | M  | **Closed by operator waiver (2026-06-12):** the physical gen-7 iPad run is waived for cutover entry. Closure evidence is the WebKit software acceptance on `/v2` (`npm run profile:ipad -- --route-prefix /v2 --browser webkit --no-hardware`, 10 iterations — all flows p95 ≤ 71 ms vs the 100 ms threshold; `docs/audit/2026-06-12-ipad-profile-software-v2.json`). The chromium 4× stress preflight (86-add p95 ~130 ms) is recorded as a residual risk with Stage-1 responsiveness rollback as the operational guard. Harness + runbook remain available for an optional future device run. |

---

## Tier 3 — Strategic (one or two quarters out)

| ID  | Effort | Item |
|-----|--------|------|
| 3.1 | XL | **Multi-venue rollout.** `location_id` exists everywhere but the multi-venue management UX (which venue am I, switch venues, consolidated rollup) hasn't been built. Cloud-bridge sync already supports the data plane. |
| 3.2 | XL | **Closed (merged 2026-06-11 via PR #316–#318; live on `main`, tests passing as of 2026-07-04):** `/costing/variance-attribution` answers "the variance moved — what changed?" between two accounting_variance periods: in-window vendor price moves, dish-component composition edits, count corrections/closes (audit-backed), and unresolved sales depletions, with an honest directional caveat (sections are evidence, not a sum). `tests/js/test-variance-attribution.mjs` pins window selection, per-section evidence, and location scoping. |
| 3.3 | L  | **Closed (merged 2026-06-11 via PR #316–#318; live on `main`, tests passing as of 2026-07-04):** append-only `allergen_attestations` with manager-PIN signoff via `POST /api/allergens/attestations` (idempotency-wrapped, audit_events row in-transaction). Status per recipe is `unattested` / `attested` / `stale` — staleness via a sha256 fingerprint of the full sub-recipe ingredient tree the allergen heuristic reads. Allergen-lookup shows status chips + an Attest form. `tests/js/test-allergen-attestations.mjs` pins it. Recipe-browser surfacing is a follow-up. |
| 3.4 | XL | **Closed (merged 2026-06-11 via PR #316–#318; live on `main`, tests passing as of 2026-07-04):** in-app `/setup` first-run flow with live step detection: manager PIN (links `/login-pin?setup=1`), location seed (new `POST /api/locations`), first vendor prices + first recipes (detected; command blocks for the ingest scripts), Toast marked optional-requires-credentials (no OAuth shipped — needs API keys), and a "you're live" handoff to `/today` + `/install`. Desktop Electron wizard unchanged. `tests/js/test-setup-flow.mjs` pins detection + the locations POST. |
| 3.5 | XL | **Closed (merged 2026-06-11 via PR #316–#318; live on `main`, tests passing as of 2026-07-04):** `/analytics/operators` manager dashboard (PIN-gated via existing `/analytics` prefix): audit-event volume by actor + trend, corrective actions by operator and subject, equipment failure frequency, gold stars by cook, and management-actions JSONL counts, over 7/30/90-day windows. `tests/js/test-operator-analytics.mjs` pins aggregation, window edges, and location scoping. |
| 3.6 | XL | **Closed (merged 2026-06-11 via PR #316–#318; live on `main`, tests passing as of 2026-07-04):** "Promote to menu" on saved specials (`POST /api/specials/saved/[id]/promote`, PIN + idempotency + audit): materializes per-serving `dish_components` vendor_item rows from the special's cost_breakdown into a new `specials_promotions` linkage, so `computeMenuEngineering` picks the dish up with real cost the moment it sells — no menu-engineering code changes needed. Re-promote refreshes only promotion-owned rows. `tests/js/test-specials-promotion.mjs` pins cost flow-through end to end. |
| 3.7 | L  | **Closed (merged 2026-06-11 via PR #316–#318; live on `main`, tests passing as of 2026-07-04):** `/food-safety/haccp-plan` inspector-ready printable plan built on demand from local data: CCP inventory with FDA citations, rule-module evidence counts, 30-day corrective-action log, calibration records + probe status board, signature block; browser print-to-PDF per the settlement pattern (no PDF library, no nightly job — on-demand needs no scheduling config). `tests/js/test-haccp-plan.mjs` pins it. |
| 3.8 | L  | **Closed (2026-06-12, PRs #327/#328/#329):** Cook-tier i18n shipped with Spanish first — hand-rolled `lib/i18n` catalog (next-intl deferred: zero new deps; the cook corpus needs only token interpolation + `_one`/`_other` plurals; key drift is typecheck-enforced via `Messages = typeof en`). Locale rides the `lariat_locale` cookie (v2-topbar EN/ES picker + the kitchen-assistant language picker dual-writes it, so LLM answers and chrome stay in step). Translated: `/v2/today`, the four cook hero shells, EightySixBoard, PunchTicketPage, StationChecklist — chrome only, DB data verbatim, 86 reason codes stay API values. Residuals: `app/v2/page.jsx` nav hub + manager tier stay English by design; **Spanish copy is machine-draft pending operator review** (`docs/OPERATIONS_HANDOFF.md` §5) — the picker stays v2-preview-gated until signed off. |

---

## Product defaults for the v2 freeze slice

These are the defaults used for this roadmap branch. Reopen them only with a specific product change request.

| Decision | Default | Effect |
|----------|---------|--------|
| Shows / box-office | Active; route-hardened | 2.14 complete: restored active handlers/repos and pins stage, sound, SPL, and box-office with `npm run test:event-ops`. |
| Venue target | Single-venue v2 | Keep 3.1 deferred; no venue switcher in this slice. |
| `cad-kernel/` | Out-of-scope for Lariat v2 | Move out only in a dedicated cleanup; no runtime coupling. |
| `labor/certs` | Informational-only | No regulated cert write/audit claim in v2. |
| Local model | DeepSeek default | Qwen remains deferred until eval-gated. |
| iPad hardware / voice | Unknown | Keep 2.6 deferred; do not introduce cloud Whisper to satisfy old iPads. |
| i18n | Shipped post-freeze (2026-06-12) | 3.8 closed via the cookie-scoped `lib/i18n` catalog; es copy gated on operator review. |
| v2 UI rollout shape | Cookie-gated side-by-side `/v2` shell | Build 2.10 as an opt-in route tree; do not replace v1 routes or expose an install-time cutover toggle in this freeze slice. |

---

## 2026-06-07 status of the prior 1-5 sprint sequence

The old five-item sequence is now reconciled so future agents do not redo finished work:

1. **1.9** — closed; navRegistry coverage and install/login exclusions are pinned.
2. **P0 ERP lane** — closed for the receiving/inventory replay proof; receiving-to-inventory now preserves match/master truth in sync payloads and remaps replayed inventory credits back to the local replayed receiving row, so matched, unmatched, or ambiguous receiving state does not drift across peers.
3. **2.9** — closed; design tokens are extracted and import-order tested.
4. **2.10** — closed; the first `/v2` shell is cookie-gated, side-by-side, and leaves v1 as default with no route replacement.
5. **3.1** — remains deferred; no venue switcher or consolidated multi-venue rollup belongs in this freeze slice.

The next implementation work should start from the remaining open rows, not from the stale sequence above: continue row 2.21 with the required low-power iPad gen 7 hardware profile run.

---

## What I'd avoid

A few things I considered putting on this list and decided against, in case anyone reaches the same conclusion:

- **Don't redo the cloud-bridge audit.** The recent commits (H1–H9, M1–M11, L1–L4) close that surface comprehensively. Adding new audit cycles here is busy-work.
- **Don't migrate `@ts-nocheck` in a single sweep.** 256 files in one PR is unreviewable. The on-touch policy is the right shape.
- **Don't ship the UI v2 before the v1 nav-registry cleanup.** Building on top of an inconsistent nav doubles the work.
- **Don't add a `code_search` action without env-gating.** The temptation to expose code-aware Q&A in production is real and the blast radius is unbounded.
