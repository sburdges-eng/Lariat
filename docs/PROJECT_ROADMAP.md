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

## How this was scoped

I read every doc in `docs/`, the last 30 commits, the schema, the nav registry, the API routes, the audit document I produced this session, and the recent audit-cycle history (the M/L/H-numbered hardening sweeps). I excluded recommendations I couldn't ground in observed evidence. Effort estimates: **XS** = <1hr, **S** = half-day, **M** = 1–2 days, **L** = week, **XL** = sprint+.

The team already runs disciplined audit cycles (H1–H9, M1–M11, L1–L4, C5 visible in recent commits). This roadmap is shaped to slot into that cadence rather than displace it.

---

## Tier 0 — Pre-flight (before anything else)

This is the work to actually land this session's deliverables.

| ID  | Effort | Item |
|-----|--------|------|
| 0.1 | XS     | `rm -f .git/index.lock`, commit the four-commit split in `docs/redesign/SESSION_HANDOFF_2026-05-16.md`. |
| 0.2 | XS     | Run `npm run validate:db-query-registry` and `npm run test:db-query-tool` on macOS — confirm 24/24 SQL passes and the test suite is green. |
| 0.3 | XS     | Manual smoke: ask LaRi "any cooling cycles in progress?" cook-tier, then "what did we sell today?" manager-tier. Confirm audit_events has new `db_query` rows. |
| 0.4 | S      | Decide on the open question in the handoff doc: slim `GROUNDED_SYSTEM` for `/api/specials` or accept it sees rule #11 too. |
| 0.5 | S      | Run the full test suite (`test:unit`, `test:rules`, `test:schema`, `test:datapack`, `test:compute-engine`) to catch anything my changes broke transitively. |

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
| 2.4 | M  | **Mostly closed 2026-06-04:** Registered query expansion. `recipe_with_bom`, `sales_depletion_unresolved`, `beo_prep_status`, and `equipment_maintenance_due` are in `lib/dbQueryRegistry.ts`; this branch pins the top three with execution tests and location-boundary canaries. Remaining candidate: `peer_trust_status` for multi-tablet sync peer health. |
| 2.5 | M  | **Dev-mode code search action** (deferred Phase 1.2 from this session). Env-gated, manager-tier, ripgrep-backed. |
| 2.6 | L  | **Voice input.** Cooks have wet/dirty hands — typing on an iPad isn't always realistic. Whisper-tiny is ~75MB and runs locally on M-series; wire it into the LaRi composer as a long-press push-to-talk. |
| 2.7 | M  | **Action confirmation surfaces.** When LaRi takes a write action (86 an item, log a corrective), there's no "undo" window. Build a 30-second undo toast that issues a correction-row to `audit_events`. |
| 2.8 | M  | **LaRi-driven daily digest.** Every morning at open, LaRi assembles a manager-tier digest from the existing queries: what got 86'd, vendor price shocks, certs expiring this week, equipment maintenance due, BEOs prep status. Posts to a `/morning` page + optional Slack webhook. |

### 2B. UI v2 migration (real, not just the demo)

The `docs/redesign/lari-ui-demo.html` is a prototype. A real migration needs:

| ID  | Effort | Item |
|-----|--------|------|
| 2.9  | XS | **Closed:** Design tokens are extracted into `styles/tokens.css` and loaded before the current authoritative `styles/globals.css` definitions so shipped UI can opt in without visual regression; `tests/js/test-design-tokens.mjs` pins the token file, core paper/ember/sage/brass/rust tokens, `.k-dark`/`.k-night`, font import, and import order. |
| 2.10 | L  | **Closed:** The first `/v2` shell is implemented as a cookie-gated side-by-side route tree. `/v2` reads the stable `lariat_v2=1` preview cookie, hides v1 cockpit chrome only inside the v2 subtree, keeps v1 as default, and lists the cook-tier migration anchors without replacing v1 routes. |
| 2.11 | XL | **Migrate cook-tier surfaces first.** Order: `/today` → `/kds/punch` → `/eighty-six` → station boards. These are the screens cooks touch every shift; they should be the proof of concept. |
| 2.12 | XL | **Migrate manager-tier surfaces.** `/command` → `/management` → `/analytics`. These have less time pressure but more density. |
| 2.13 | M  | **Cutover plan.** When v2 is shippable, write the v1→v2 rollout doc with rollback criteria. Don't delete v1 routes until v2 has 30 days of clean operation. |

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
| 2.19 | M  | **better-sqlite3 WAL checkpoint policy.** WAL is mentioned in CLAUDE.md but I didn't see an explicit checkpoint config. Under heavy write load (busy service), uncontrolled WAL growth can cause latency spikes. |
| 2.20 | L  | **Bundle-size audit.** Next 16 + React 19 + Electron 42 just happened (commit `30d9232`). Re-measure the production bundle vs. pre-bump; the Turbopack vs. webpack split (`next.config.mjs` does dual-runtime aliasing for three Node-only chains) may have created drift. |
| 2.21 | M  | **iPad performance.** Cook-tier surfaces run on iPads. Profile under low-power mode on an iPad gen 7 (slowest fleet device). Anything > 100ms tap-to-feedback is too slow for line use. |

---

## Tier 3 — Strategic (one or two quarters out)

| ID  | Effort | Item |
|-----|--------|------|
| 3.1 | XL | **Multi-venue rollout.** `location_id` exists everywhere but the multi-venue management UX (which venue am I, switch venues, consolidated rollup) hasn't been built. Cloud-bridge sync already supports the data plane. |
| 3.2 | XL | **Inventory-counts → accounting-variance closed loop.** Today: counts are entered manually, BOM-based depletions are computed by Phase 3, accounting_variance compares to actuals. The loop is open: there's no "the variance dropped 5%, what did we change?" attribution surface. |
| 3.3 | L  | **Allergen verification layer.** CLAUDE.md and the system prompt are explicit that allergen flags are heuristic. A real fix is a per-recipe allergen-attestation workflow with manager signoff before serving allergen-restricted guests. |
| 3.4 | XL | **First-run wizard.** `/install` page exists but is orphan (audit F1). A real first-run flow should walk a new restaurant through: PIN setup, location seed, first vendor import, first recipe import, Toast OAuth, then a "you're live" handoff. |
| 3.5 | XL | **Operator analytics.** `data/audit/management-actions.jsonl` accumulates every manager action. There's no dashboard that surfaces patterns (who's logging the most corrective actions, which equipment fails most often, which cook gets the most gold stars). |
| 3.6 | XL | **Specials sandbox → menu engineering pipeline.** Specials creates recipes; menu engineering analyzes margin. They don't talk. A "promote special to menu" flow would close that loop and pull cost data through automatically. |
| 3.7 | L  | **HACCP plan generator.** All the food-safety rule modules encode FDA citations. A nightly job could produce a PDF HACCP plan tailored to the venue's actual data (which CCPs are active, last 30 days of corrective actions, calibration records). Health-inspector-ready. |
| 3.8 | L  | **i18n for cook-tier surfaces.** The kitchen-assistant route already accepts `body.language` and emits a translation directive to the LLM. The UI shell hasn't been internationalized. Adding `next-intl` with Spanish first (common in BOH) would unlock that. |

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
| i18n | Unknown | Keep 3.8 deferred. |
| v2 UI rollout shape | Cookie-gated side-by-side `/v2` shell | Build 2.10 as an opt-in route tree; do not replace v1 routes or expose an install-time cutover toggle in this freeze slice. |

---

## 2026-06-07 status of the prior 1-5 sprint sequence

The old five-item sequence is now reconciled so future agents do not redo finished work:

1. **1.9** — closed; navRegistry coverage and install/login exclusions are pinned.
2. **P0 ERP lane** — closed for the receiving/inventory replay proof; receiving-to-inventory now preserves match/master truth in sync payloads and remaps replayed inventory credits back to the local replayed receiving row, so matched, unmatched, or ambiguous receiving state does not drift across peers.
3. **2.9** — closed; design tokens are extracted and import-order tested.
4. **2.10** — closed; the first `/v2` shell is cookie-gated, side-by-side, and leaves v1 as default with no route replacement.
5. **3.1** — remains deferred; no venue switcher or consolidated multi-venue rollup belongs in this freeze slice.

The next implementation work should start from the remaining open rows, not from the stale sequence above: move into the still-open scale/readiness rows such as 2.19 WAL checkpoint policy, 2.20 bundle-size audit, and 2.21 iPad performance.

---

## What I'd avoid

A few things I considered putting on this list and decided against, in case anyone reaches the same conclusion:

- **Don't redo the cloud-bridge audit.** The recent commits (H1–H9, M1–M11, L1–L4) close that surface comprehensively. Adding new audit cycles here is busy-work.
- **Don't migrate `@ts-nocheck` in a single sweep.** 256 files in one PR is unreviewable. The on-touch policy is the right shape.
- **Don't ship the UI v2 before the v1 nav-registry cleanup.** Building on top of an inconsistent nav doubles the work.
- **Don't add a `code_search` action without env-gating.** The temptation to expose code-aware Q&A in production is real and the blast radius is unbounded.
