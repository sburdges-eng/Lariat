# Lariat Project Roadmap — 2026-05-16

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
| 1.1 | S      | F7 — pick canonical `LARIAT_LOCATION_ID`, deprecate `LARIAT_LOCATION`. Add a startup warning in `lib/location.ts` when the old name is set. | One name reads from env in prod; deprecation warning fires once per process for the old name; both `.env.example` and `docs/OPERATIONS.md` show only the canonical name. |
| 1.2 | S      | F8 — same shape for `LARIAT_7SHIFTS_API_KEY` vs `LARIAT_SEVENSHIFTS_API_KEY`. | Same shape as 1.1. |
| 1.3 | M      | F3 — write the missing test for `/api/kds/tickets/[id]/bump`. Pin `BumpResponse` field names against `Lariat-KDS/docs/lariat-kds-protocol.md`. | Test asserts every field in the protocol doc appears in the response; CI fails if either drifts. |
| 1.4 | M      | F3 — `/api/health` test (happy path + degraded-probe path). | Probe-down path returns the right shape; aggregated `ok=false` when any required probe fails. |
| 1.5 | M      | F3 — BEO share-flow tests (`/api/beo/[id]/share-token`, `/api/beo/share/[token]`, `/api/beo/share/[token]/sign`). Security-sensitive (anonymous-token reads). | Tests cover: valid token reads only that BEO; expired/revoked token rejected; cross-location BEO id doesn't bleed; signature payload validated. |
| 1.6 | S      | F5 — confirm `/concept-layout` is dead and delete the page. `git log app/concept-layout/page.tsx`; if last edit > 90d, `rm -rf app/concept-layout/`. | Page removed; navRegistry/Sidebar/CommandPalette have no references; build clean. |
| 1.7 | M      | F6 — wire `/costing/price-shocks` into navRegistry + confirm it reads from `vendor_prices_history`. If it doesn't, build a minimal page that does. | Page accessible from palette; renders 14-day shock table with sparkline per ingredient; uses the existing `vendor_price_shocks` LaRi query under the hood for parity. |
| 1.8 | L      | F4 — start the `@ts-nocheck` cleanup as touch-on-edit policy: every PR that touches a `@ts-nocheck` file migrates it to `@ts-check` + JSDoc typedefs in the same commit. No big-bang; expect ~20 files migrated per sprint. | 256 down to <200 by next quarter; `kitchen-assistant/route.js` migrated first (it's a hot file now that I added `db_query`). |

### 1B. Add the missing nav entries I didn't get to

I added the 7 food-safety boards. Still missing from navRegistry (per audit F1):

- `/labor/breaks`, `/labor/sick-leave`, `/labor/wage-notices`, `/labor/certs`, `/labor/tip-pool` — **Compliance** cluster
- `/inventory/waste`, `/inventory/counts`, `/inventory/par`, `/bar/par` — **Inventory** cluster
- `/admin/cleaning-schedule`, `/admin/service-hours` — **Admin** cluster
- `/menu-engineering/margin-deltas`, `/menu-engineering/components` — **Menu Engineering** cluster
- `/install`, `/login-pin` — review whether they belong in palette at all

| 1.9 | M | Add 13 missing nav entries in 4 commits (one per cluster). Apply `docs/UI_COPY_RULES.md` (kitchen verbs, no SaaS jargon). | All non-dynamic pages either in navRegistry OR explicitly excluded with a code comment. |

### 1C. The integration depth the audit didn't have time for

| ID   | Effort | Item |
|------|--------|------|
| 1.10 | M | **Closed:** Toast OAuth refresh-token handling is covered by `scripts/toast_api/auth.mjs`; `isCacheStale()` refreshes 5 minutes early and `tests/js/test-toast-api-helpers.mjs` pins the boundary. |
| 1.11 | M | **Closed:** 7shifts rate-limit handling now lives in `scripts/sevenshifts_api/client.mjs`; HTTP 429 retries honor `Retry-After` with bounded fallback backoff, pinned by fake-fetch coverage in `tests/js/test-sevenshifts.mjs`. |
| 1.12 | L | **KDS Swift protocol regression suite.** CLAUDE.md says the Swift parser "fails closed on any drift in the response shape." Need a fixture that round-trips every `BumpResponse` field through both sides as a build-time check. |
| 1.13 | M | **Cloud-bridge replay determinism.** Recent commits show the sync audit (H1–H8, M1–M11) is closed but I didn't see end-to-end replay tests. Build one: capture N hours of outbox writes, replay against a fresh DB, assert state-equivalence. |
| 1.14 | S | **Closed:** idempotency-key TTL is the lazy `sweepExpired()` path in `lib/idempotency.ts`, covered by `tests/js/test-idempotency-wrapper.mjs` case 5. |

---

## Tier 2 — Next quarter (real depth + the deferred Phase 3)

Larger work that requires its own design conversation up-front.

### 2A. LaRi reaches its potential

The `db_query` action is the foundation. To reach the potential the project_instructions implied:

| ID  | Effort | Item |
|-----|--------|------|
| 2.1 | M  | **Multi-turn conversations.** Today every LaRi call is stateless. Adding a short conversation buffer (last 4–6 turns) unlocks follow-ups like "show me brisket specifically" after "show me Sysco shocks." Persist per-(location, cook_id, session) keyed to a TTL. |
| 2.2 | M  | **Summarization pass.** When a `db_query` returns >20 rows, route the table back through a Haiku-class model (or the same Ollama model with a tighter prompt) to produce a 2-sentence summary alongside the raw table. The current `formatQueryResultForPrompt` is verbatim — fine for small tables, overwhelming for big ones. |
| 2.3 | L  | **Semantic search over recipes + BEOs.** The Data Pack already streams BGE embeddings (`lib/datapackSearch.ts`). Extend to index recipes, BEO line items, and audit-event payloads. New cook-tier `semantic_search` action that finds "that wedding cake recipe with the cherry filling" without needing exact-string match. |
| 2.4 | M  | **More registered queries.** Top of the wish-list I observed but didn't add this session: |
|     |    | • `recipe_with_bom` — recipe + every ingredient leaf with current vendor price (joins `recipe_costs` → `bom_lines` → `vendor_prices`). |
|     |    | • `sales_depletion_unresolved` — Toast sales that didn't map to a BOM (the "we sold something but couldn't deplete inventory for it" canary). |
|     |    | • `beo_prep_status` — given an upcoming BEO event_id, return the prep tasks + their done state. |
|     |    | • `equipment_maintenance_due` — service intervals approaching for any equipment. |
|     |    | • `peer_trust_status` — multi-tablet sync peer health. |
| 2.5 | M  | **Dev-mode code search action** (deferred Phase 1.2 from this session). Env-gated, manager-tier, ripgrep-backed. |
| 2.6 | L  | **Voice input.** Cooks have wet/dirty hands — typing on an iPad isn't always realistic. Whisper-tiny is ~75MB and runs locally on M-series; wire it into the LaRi composer as a long-press push-to-talk. |
| 2.7 | M  | **Action confirmation surfaces.** When LaRi takes a write action (86 an item, log a corrective), there's no "undo" window. Build a 30-second undo toast that issues a correction-row to `audit_events`. |
| 2.8 | M  | **LaRi-driven daily digest.** Every morning at open, LaRi assembles a manager-tier digest from the existing queries: what got 86'd, vendor price shocks, certs expiring this week, equipment maintenance due, BEOs prep status. Posts to a `/morning` page + optional Slack webhook. |

### 2B. UI v2 migration (real, not just the demo)

The `docs/redesign/lari-ui-demo.html` is a prototype. A real migration needs:

| ID  | Effort | Item |
|-----|--------|------|
| 2.9  | XS | **Extract the design tokens** (the CSS variables at the top of the demo) into `app/_styles/tokens.css`. Even before any migration, having tokens that the current UI can opt into incrementally pays dividends. |
| 2.10 | L  | **Build the v2 shell.** New route tree at `/v2/...` mirroring the current tree. Feature-flag-gated via cookie. Don't replace anything — both UIs run side-by-side while migration happens. |
| 2.11 | XL | **Migrate cook-tier surfaces first.** Order: `/today` → `/kds/punch` → `/eighty-six` → station boards. These are the screens cooks touch every shift; they should be the proof of concept. |
| 2.12 | XL | **Migrate manager-tier surfaces.** `/command` → `/management` → `/analytics`. These have less time pressure but more density. |
| 2.13 | M  | **Cutover plan.** When v2 is shippable, write the v1→v2 rollout doc with rollback criteria. Don't delete v1 routes until v2 has 30 days of clean operation. |

### 2C. Test coverage to production-ready

37 untested API routes (per audit F3). Beyond the three I called out as P1 (KDS bump, health, BEO share):

| ID  | Effort | Item |
|-----|--------|------|
| 2.14 | L  | **Show/box-office route family.** 9 untested routes under `/api/shows/[id]/*` covering settlement, deal terms, box-office lines, stage setups, sound scenes, SPL readings. If the live-music venue arm is in active use, this is genuine debt. If not, mark them deprecated. |
| 2.15 | M  | **Inventory count routes.** `/api/inventory/counts/[id]` + `/api/inventory/counts/[id]/lines` — count-flow CRUD is no-test, and counts feed `accounting_variance` so divergence here cascades to financials. |
| 2.16 | M  | **Recipe-photo + raw routes.** `/api/recipes/[slug]/photos/*` — hero pinning + raw image serving. The hero migration (T2 in `lib/db.ts::migrateLegacyColumns`) added behavior worth pinning. |
| 2.17 | M  | **Cloud-bridge DLQ admin routes.** `/api/cloud-bridge/dead-letters/[id]/{drop,requeue}` — low-frequency but consequential per-call. |

### 2D. Performance + scale work I didn't audit

| ID  | Effort | Item |
|-----|--------|------|
| 2.18 | M  | **DB index audit.** I read the schema but didn't measure query plans. Several `db_query` registry entries (`vendor_price_shocks`, `audit_log_recent`) do range scans over time-series tables — should be plan-checked against a realistic DB size. |
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

## Decisions that need to be made BEFORE work can start

These aren't engineering tasks — they're product calls that block work above.

| Decision | Why it matters | Owner suggestion |
|----------|----------------|------------------|
| Is the live-music venue arm (shows/box-office) actively used? | Decides whether 2.14 is real debt or deprecated-and-delete. | Sean |
| Multi-venue or single-venue is the target shape? | 3.1 vs. continuing to optimize single-venue. | Sean |
| Are cooks getting iPads with Apple Silicon? | Voice (2.6) is M-series-realistic; older iPads need a cloud Whisper. | Sean |
| Spanish first for i18n, or Spanish + something else? | 3.8 scope. | Sean |
| Should v2 UI ship as a parallel install (electron flag) or in-app toggle? | 2.10 architecture. | Sean |

---

## How I'd sequence the next sprint

If I had to pick 5 things for the next two weeks:

1. **0.1 → 0.5** — land this session's work cleanly (a day).
2. **1.3** — KDS bump test (critical for the Swift sibling) (a day).
3. **1.9** — finish the navRegistry cleanup in 4 small commits (half a day).
4. **2.4** — add the top 3 missing `db_query` entries (`recipe_with_bom`, `sales_depletion_unresolved`, `beo_prep_status`) (a day).
5. **2.9** — extract the design tokens from the demo into the codebase (half a day).

That's ~4 days of focused work and leaves the rest of the sprint for the existing audit cadence and whatever else is on the team's plate.

---

## What I'd avoid

A few things I considered putting on this list and decided against, in case anyone reaches the same conclusion:

- **Don't redo the cloud-bridge audit.** The recent commits (H1–H9, M1–M11, L1–L4) close that surface comprehensively. Adding new audit cycles here is busy-work.
- **Don't migrate `@ts-nocheck` in a single sweep.** 256 files in one PR is unreviewable. The on-touch policy is the right shape.
- **Don't ship the UI v2 before the v1 nav-registry cleanup.** Building on top of an inconsistent nav doubles the work.
- **Don't add a `code_search` action without env-gating.** The temptation to expose code-aware Q&A in production is real and the blast radius is unbounded.
