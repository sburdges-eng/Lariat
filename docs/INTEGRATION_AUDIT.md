# Lariat Integration Audit — 2026-05-16

Cross-cutting audit of the bundled Lariat app. Looking for orphan code, integration drift, half-finished features, and documentation gaps. Each finding tagged with a severity and a one-paragraph remediation sketch.

**Method.** Combined `find` / `rg` passes over `app/`, `lib/`, `scripts/`, `docs/`, plus comparison of declared env vars, nav-registry entries, page files, API routes, and test files. SQL-level audit of the new `db_query` registry against the real schema. Conducted from a feature branch (`feat/lari-expansion-and-audit`) without making any fixes in the audit pass itself — fixes are listed per finding and would land as separate commits.

**Scope caveat.** This is a static audit. Some apparent orphans may be reachable via dynamic links not captured by a literal-href grep, and some "untested" API routes may be covered by Playwright e2e or by the cook-flow integration tests. Each finding lists what I verified vs. what I inferred so you can triage.

---

## Severity legend

- **S1 (binding rule violation)** — Contradicts a hard rule in `CLAUDE.md` / `AGENTS.md`. Should be fixed before next ship.
- **S2 (integration drift)** — Code works, but a guardrail / surface is degraded. Fix in the next sprint.
- **S3 (debt / hygiene)** — Tech debt visible in metrics. Worth a planned cleanup window.

---

## Findings

### F1. 26 pages exist but are not in `navRegistry.js` — S1

**What.** `app/_components/navRegistry.js` is documented in `CLAUDE.md` as "the single source of truth for nav links, command palette, and floorplan zones." 26 of the app's page files don't appear in the registry, including 7 of the 11 food-safety surfaces.

Concrete examples:
- `/food-safety/cooling` (page exists; reachable from the Food Safety hub via `<Link>` tile; **not** in the command palette so `cmd+K → "cooling"` fails)
- `/food-safety/sds`, `/food-safety/sanitizer`, `/food-safety/date-marks`, `/food-safety/sick-worker`, `/food-safety/pest`, `/food-safety/cleaning` — same pattern
- `/labor/breaks`, `/labor/sick-leave`, `/labor/wage-notices`, `/labor/certs`, `/labor/tip-pool`
- `/inventory/waste`, `/inventory/counts`, `/inventory/par`, `/bar/par`
- `/admin/cleaning-schedule`, `/admin/service-hours`
- `/menu-engineering/margin-deltas`, `/menu-engineering/components`
- `/costing/price-shocks`
- `/management/peers`
- `/concept-layout` — looks like a prototype (`/Pan` component, `activeModal` demo)
- `/install`, `/login-pin` — meta surfaces that may intentionally be hidden, but at least `/install` should be reachable from an admin nav for the first-run wizard

**Why it matters.** Cook-tier surfaces like `/food-safety/cooling` are HACCP-critical. If a cook can't find the cooling board via the palette, they fall back to the hub-tile path — slower, more taps under pressure, and prone to "did anybody check cooling today?" misses.

**Fix sketch.** One commit per logical group (food-safety, labor, inventory, menu-engineering, admin). For each: add a `NAV_ITEMS` entry with `id`, `href`, `title`, `palette` (true for searchable), and the right `roles` array. The `/concept-layout` page should be deleted as dead code if confirmed unused (one commit). `/install` and `/login-pin` should be reviewed for whether they belong in an "admin/setup" cluster.

**Verification I performed.** Grepped for literal `'/path'` and `"/path"` strings in `navRegistry.js`. Did not check for dynamic registration (e.g., entries built from a loop) — I checked the file is mostly literal entries. Cross-verified that food-safety pages ARE linked from `app/food-safety/page.*` so they're reachable, just not via palette.

---

### F2. 30+ env vars referenced in code but missing from `.env.example` — S1

**What.** Code reads 30+ `process.env.LARIAT_*` variables, but `.env.example` lists only `LARIAT_PIN` and `LARIAT_PIN_SECRET`. `docs/OPERATIONS.md` documents 15 of them. The delta:

Documented in OPERATIONS.md but NOT in .env.example:
- `LARIAT_ANALYTICS`, `LARIAT_COSTING`, `LARIAT_OPS`, `LARIAT_UNIFIED` (ingest run kinds)
- `LARIAT_OLLAMA_URL`, `LARIAT_OLLAMA_MODEL`, `LARIAT_OLLAMA_TIMEOUT_MS`
- `LARIAT_ASSISTANT_*` (3 vars)
- `LARIAT_LOCATION`, `LARIAT_EXPORT_LOCATION`, `LARIAT_PDF`

In code but NOWHERE documented:
- `LARIAT_7SHIFTS_API_KEY`, `LARIAT_SEVENSHIFTS_API_KEY` (looks like a rename mid-flight — both names referenced)
- `LARIAT_PRISM_USERNAME`, `LARIAT_PRISM_PASSWORD`
- `LARIAT_TOAST_CLIENT_ID`, `LARIAT_TOAST_CLIENT_SECRET`
- `LARIAT_CLOUD_BRIDGE_URL`, `LARIAT_CLOUD_BRIDGE_SECRET`
- `LARIAT_SYNC_PEERS`, `LARIAT_SYNC_PEER_KEY`, `LARIAT_SYNC_TICK_MS`, `LARIAT_SYNC_MAX_BODY_BYTES`, `LARIAT_SYNC_ALLOW_PRIVATE`
- `LARIAT_DRAINER_TICK_MS`, `LARIAT_DRAINER_STALE_AGE_S`
- `LARIAT_AUDIT_PATH`, `LARIAT_DATA_DIR`, `LARIAT_DB`, `LARIAT_ROOT`, `LARIAT_PYTHON`
- `LARIAT_BASE_URL`, `LARIAT_TRUST_PROXY`
- `LARIAT_LOCATION_ID` (note the `_ID` suffix — possible drift from `LARIAT_LOCATION`)

**Why it matters.** Onboarding hazard. A new install can't be told "copy .env.example to .env and fill in the blanks" because most of the surface is missing. Also a security-posture issue: integration credentials (`LARIAT_TOAST_CLIENT_SECRET`, `LARIAT_PRISM_PASSWORD`, `LARIAT_CLOUD_BRIDGE_SECRET`) need explicit "this is a secret" framing so operators know which lines to handle carefully.

**Fix sketch.** One commit: rebuild `.env.example` from the union of all `process.env.LARIAT_*` reads, group by integration (Ollama / Toast / 7shifts / Prism / Cloud Bridge / Sync), comment each with whether it's a secret, optional, or required. Cross-link from `docs/OPERATIONS.md`. Separately, file an issue to resolve the `LARIAT_LOCATION` vs `LARIAT_LOCATION_ID` and `LARIAT_7SHIFTS_API_KEY` vs `LARIAT_SEVENSHIFTS_API_KEY` collisions — pick one canonical name and migrate references.

---

### F3. 37 of 112 API routes have no matching `test-*-api*.mjs` file — S2

**What.** A literal-route-string grep across `tests/js/` shows 37 API routes with no test reference. Some are simple CRUD ID-routes (`/api/reservations/[id]`, `/api/gold-stars/[id]`) that may be exercised transitively by their collection-route tests, but several are first-class surfaces:

- `/api/kds/tickets/[id]/bump` — the protocol that the Lariat-KDS Swift sibling repo depends on (CLAUDE.md: "Do not change `BumpResponse` field names in `lib/kds.ts` without updating the protocol doc first"). The bump-route handler itself has no test guarding the response shape.
- `/api/dish-coverage` — exposed surface, no test
- `/api/dish-components` — Phase 1 entity-layer surface, no test
- `/api/health` — the aggregated launch health probe, no test
- `/api/inventory/counts/[id]` and `/api/inventory/counts/[id]/lines` — count-flow CRUD, no test
- `/api/beo/courses/[id]`, `/api/beo/[id]/share-token`, `/api/beo/share/[token]`, `/api/beo/share/[token]/sign` — share-flow CRUD
- 9 `/api/shows/[id]/*` routes (settlement, deal, box-office, capacity, stage, sound) — the live-music venue surface
- `/api/cloud-bridge/dead-letters/[id]/{drop,requeue}` — DLQ admin actions

**Why it matters.** Variable. The KDS bump route is HIGH-impact (binary protocol with an external Swift client). The shows/* surface is HIGH-impact if you have live music dates; otherwise lower. Dead-letter admin actions are LOW frequency but consequential per-call. CRUD ID-routes are mostly LOW if their collection-route counterparts are well-tested (which they generally are).

**Fix sketch.** Triage in two passes. Pass 1 (this sprint): add tests for `/api/kds/tickets/[id]/bump` (mandatory per CLAUDE.md's KDS protocol rule), `/api/health` (one happy path + one degraded-probe path), and the BEO share-flow (security-sensitive — anonymous-token reads). Pass 2 (later sprint): build a fixture harness for the shows-route family if the venue arm is in active use; if not, mark the routes as deprecated/feature-flagged.

**Verification I performed.** Literal-string grep for `/api/<route>` in `tests/js/`. Did not check Playwright e2e (`tests/e2e/`) or `app/__tests__/` Jest tests. Some of these routes may have e2e coverage; this count is a UPPER bound on truly-untested.

---

### F4. 256 source files carry `// @ts-nocheck` ("pre-#250 baseline") — S3

**What.** A migration is underway per a code comment (`pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md`). 256 files still carry the bypass. Distribution:

- `app/api` — 91 (the largest cluster)
- `app/food-safety` — 23
- `app/shows` — 16
- `app/__tests__` — 15
- `app/_components` — 13
- `app/recipes` — 11
- `app/labor` — 11
- `app/costing` — 10

**Why it matters.** Each `@ts-nocheck` file hides whatever TS would catch — null-deref, prop-type mismatches, missing-arg bugs. The risk is cumulative: routes like `app/api/kitchen-assistant/route.js` (which has the new `db_query` integration I just added) carry the bypass, so if my new wire-up has a type error TS won't catch it at build time.

**Fix sketch.** Migration is its own project. Short-term hygiene win: any time you touch a `@ts-nocheck` file, migrate it to `// @ts-check` plus JSDoc typedefs in the same commit. That's how the team historically chips at this kind of debt; the file count goes down by 1 per PR with no big-bang risk. Specifically, the kitchen-assistant route is now a hot file (just added new logic) and is a high-value migration target.

---

### F5. `app/concept-layout/page.tsx` looks like an orphan prototype — S3

**What.** Contains a `Pan` size-mapping component and an `activeModal` demo. Not linked from anywhere in the navRegistry, not referenced from other components per a quick grep, and the filename `concept-layout` is unusual (Lariat's pages are domain-noun, not "concept-X"). Reads like a leftover from an earlier design exploration that should have been deleted.

**Fix sketch.** Confirm with `git log app/concept-layout/page.tsx` (I can't from this sandbox — the index.lock is stuck) — if last commit is > 90 days old with no recent edits, delete the page in a `chore/delete-concept-layout` commit. If it's recent and you want to keep it for reference, move it to `docs/explorations/` and remove the live route.

---

### F6. `vendor_price_history` snapshots not user-visible at all — S2 (UX gap)

**What.** `vendor_prices_history` was added per the `Price-trend invariant` documented in CLAUDE.md ("`scripts/ingest-costing.mjs` snapshots every current row into append-only `vendor_prices_history` keyed on `run_id`+`snapshot_at`"). The table accumulates real data — but there's no UI surface that reads from it. `app/costing/price-shocks/page.jsx` (orphan per F1) exists; whether it reads from `vendor_prices_history` is unclear without opening it. Other operator-facing costing pages display the live `vendor_prices` table only.

**Why it matters.** The history was added to enable trend analysis ("which vendors are slowly drifting up?"). Without a UI, the data is operationally invisible. The new `db_query` actions `vendor_price_history` and `vendor_price_shocks` (this PR) at least give LaRi a way to surface it via chat, but a dedicated page (heatmap / sparkline per ingredient × vendor) would be the right operator surface.

**Fix sketch.** Three options, increasing scope:
1. (S — done in this PR) LaRi can now answer "which Sysco prices changed > 10% in the last 14 days" via `vendor_price_shocks`.
2. (M) Wire `app/costing/price-shocks/page.jsx` into the registry and confirm it reads `vendor_prices_history`. If not, build a minimal page that does.
3. (L) Build the trend dashboard — sortable table per ingredient × vendor with sparkline of unit_price over the snapshot window, plus a "subscribe" toggle that flags ingredients to a daily-digest queue.

---

### F7. `LARIAT_LOCATION` vs `LARIAT_LOCATION_ID` naming collision — S2

**What.** Both names are read from `process.env`. Likely a rename mid-flight. The location-scoping pattern (`docs/PATTERNS.md §4`) is binding — having two env var names for the same concept invites bugs where one process reads the old name and another reads the new.

**Fix sketch.** Pick one canonical name (`LARIAT_LOCATION_ID` is more conventional). Add a back-compat read in `lib/location.ts` that warns once at startup if the old name is set and falls through to the new name. Update `.env.example` and `docs/OPERATIONS.md` together. Delete the old name after one release cycle.

---

### F8. `LARIAT_7SHIFTS_API_KEY` vs `LARIAT_SEVENSHIFTS_API_KEY` — S2

**What.** Same pattern as F7 — two names for the 7shifts API key. Same fix shape.

---

## What I checked and found CLEAN

- **`scripts/*` script-target consistency** — All 200 `package.json` scripts reference files that exist. No dangling `npm run foo` → "file not found." This is a real strength; many large repos accumulate stale scripts and Lariat hasn't.
- **TODO/FIXME density** — Only 1 across all of `app/` + `lib/`. Either the team has been disciplined OR comments live elsewhere (commit messages, docs). Either way, no obvious debt smell.
- **Branch naming** — Current branch (`feat/lari-expansion-and-audit`) conforms to AGENTS.md.
- **DB-query registry SQL** — All 24 newly-added queries prepare and execute against the real schema (verified via `scripts/validate-db-query-registry.py`).

---

## Recommended fix order

If I were to pick three things to land before next ship:

1. **F1 (nav registry)** — fastest fix, biggest visible improvement (palette finds everything). One commit per cluster.
2. **F2 (.env.example)** — straight rewrite, no risk. Unblocks new-install onboarding.
3. **F3 / KDS bump test** — only the kitchen-assistant route + the KDS bump route need tests *immediately*; the rest of the 37 can wait for next sprint.

Everything else is debt-paydown that benefits from compound shipping, not a single hero-commit.
