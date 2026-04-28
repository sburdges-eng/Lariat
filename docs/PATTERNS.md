# Canonical Patterns — Lariat Cockpit

Patterns that new work (human or AI) must follow so the codebase stays coherent.
If a change feels like it needs a new pattern, update this doc first.

---

## 1. HACCP rule module

Every regulated food-safety concept lands as the same five-part shape.
Example: cooling (F1, §3-501.14).

1. **Pure rule module** at `lib/<concept>.ts` — zero I/O, zero DB.
   Exports enums (e.g. `RECEIVING_CATEGORIES`), threshold constants
   (`STAGE1_CEILING_F = 70`), an `Input` interface, and a pure
   `validate<Concept>()` or `classify<Concept>()` function that returns
   `{ status, reason, citation, ... }`.
2. **API route** at `app/api/<concept>/route.js` — runs the rule module,
   persists through `lib/db.ts::getDb()`, wraps the INSERT and the
   `postAuditEvent()` call in the **same** `db.transaction(() => { … })`
   so a stranded source row is impossible.
   Uses `locationFromRequest()` + `pinRequiredForPic()` where appropriate.
   Writes `403` on PIN-required breaches, `422 { needs_corrective_action: true }`
   on valid-reading / out-of-band writes that demand a corrective note.
3. **Board UI** at `app/food-safety/<concept>/` — `page.jsx` (server, `force-dynamic`,
   reads DB directly via `getDb().prepare(...).all()`) + `<Concept>Board.jsx`
   (client, posts to the API; renders per-point tile grid colored
   green / yellow / red / gray using the rule module's classifier).
4. **Hub tile** on `app/food-safety/page.jsx` summarising today's state
   (calls the same classifier against the same rows).
5. **Tests**: `tests/js/test-<concept>-rules.mjs` for the pure module
   (every threshold boundary exercised) + `tests/js/test-<concept>-api.mjs`
   for the route (audit-event emission, transactional rollback, PIN gate,
   422 needs-corrective-action).

**Invariants:**
- FDA/CO citation is on the rule-module constant **and** the response
  status, never hand-typed in UI copy.
- An out-of-range reading with a corrective note = **yellow** (compliant;
  caught and fixed). An out-of-range reading with no note = **red**
  (inspector red-flag). The 422 enforces this at write time.
- `LARIAT_ELEVATION_FT` (or similar site constants) live in the rule
  module, not in the UI — see `lib/calibrations.ts:LARIAT_ELEVATION_FT = 7800`
  for the altitude-aware boiling-point target.
- The rule module is the single source of truth for the threshold. A
  yellow/red-band tweak touches one file, not three.

---

## 2. Ingest delegation (Excel/PDF → SQLite)

Node wrapper calls Python for parsing; Node owns SQLite and post-pass
math.

1. **`scripts/<name>.mjs`** (Node entry, listed in `package.json` scripts):
   - Resolves env-overridable workbook path (`LARIAT_SOURCE`, `LARIAT_COSTING`,
     `LARIAT_UNIFIED`, `LARIAT_ANALYTICS`, `LARIAT_PDF`).
   - `execSync('python3 scripts/<name>.py …')` with a hard timeout.
   - Parses JSON from stdout. Hard-errors on missing workbook (no
     `try/catch` swallow).
   - Opens `getDb()`, wraps SQLite writes in `db.transaction(...)`.
   - Runs post-pass math here: T3 (yield delta), T4 (unit convert),
     T5b (catch-weight backfill), T6 (pack-size detect), T7 (master
     rebuild via `rebuildIngredientMasters`), T8 (shrinkage).
   - Inserts one row into `ingest_runs` at start, updates at end
     (kind, started_at, finished_at, rows_in, rows_out, status).
2. **`scripts/<name>.py`** (Python delegate):
   - Pure Excel/PDF parse. `openpyxl` for `.xlsx`; `xlrd` for legacy
     Shamrock `.xls` (cp1252-encoded); `pdfplumber` for PDFs.
   - Writes `json.dumps({...})` to stdout. Never touches SQLite
     directly.
3. **Parity-tested JS↔Python helpers** (only two currently):
   - `lib/unitConvert.mjs` ↔ `scripts/lib/units.py` — conversion
     tables + `normalizeUnit()` + `convertQty()`. Python is
     authoritative; regenerate JS fixture via
     `python3 scripts/lib/generate_unit_convert_fixture.py`.
   - `lib/ingredientKey.ts` ↔ `scripts/lib/ingredient_key.py` —
     normalization slug for ingredient strings. Same story.
4. **Seed scripts** use the shared skeleton
   `scripts/lib/seed_upsert.py::seed_upsert_main(spec)`. Declare a
   `SeedSpec` + `ColumnSpec` list and you get idempotent UPSERT,
   row validation, and the `"<script>: read=N upserted=N skipped=N"`
   stderr summary for free. Do **not** hand-roll a new seed script.

**Intentional deviations:**
- `scripts/ingest-toast-timeseries.mjs` parses Toast CSVs entirely in
  Node (no Python) via `scripts/lib/toast_csv.mjs`. Plain CSV does not
  need the openpyxl boundary.
- Shamrock/Sysco/Toast/Webstaurant/Drive ingesters are
  standalone Python (no Node wrapper) because they ingest from
  `data/originals/…` or `data/imports/…` and don't need `execSync`
  plumbing.

---

## 3. Audit trail — two tracks

**Two distinct systems, two distinct stakeholders. No overlap.**

| Track | Storage | Owner lib | Written by | Read by | Purpose |
|---|---|---|---|---|---|
| **DB audit** | `audit_events` table (append-only) | `lib/auditEvents.ts` | Every HACCP + labor + regulated mutation route, **inside the same transaction as the source INSERT** | `/api/audit/log`, `/management/audit-log` | Regulated surfaces: temp log, cooling, receiving, sanitizer, date-marks, sick-worker, calibrations, breaks, certs, line check sign-offs, 86s, inventory updates |
| **File audit** | `data/audit/management-actions.jsonl` (append-only) | `lib/auditLog.mjs` | `/api/recipes/[slug]` PUT, `/api/ingredient-maps` PATCH, and anything touching costing-sensitive state outside the regulated tables | `/api/audit/log`, `/management/audit-log` | Management actions: recipe edits, ingredient remaps, cost updates |

**Rules:**
- `postAuditEvent()` must run **inside** a `db.transaction(() => {...})`;
  `lib/auditEvents.ts` emits a `console.warn` if called outside one.
  This was a 2026-04-21 hardening ("Completed — cross-bundle atomicity"
  in `docs/HEALTH_SAFETY_LABOR_AUDIT.md §9`) — do not revert.
- Do **not** wrap `postAuditEvent()` in a `try/catch` inside the route —
  an audit failure must roll the source row back with it.
- `audit_events` rows are never UPDATED or DELETED. Corrections get
  a new row with `action='correction'` + `replaces_id` pointing at
  the prior row.
- `data/audit/management-actions.jsonl` is flat JSONL; operator reads
  via `exportAuditLog(startDate, endDate)` or the
  `/management/audit-log` page.

---

## 4. Location scoping

Single-site default (`location_id = 'default'`). Multi-site-ready from
day one.

1. Every operational + financial table carries `location_id TEXT NOT NULL DEFAULT 'default'`.
2. Every API route extracts via `lib/location.ts`:
   - `locationFromRequest(req)` — reads `?location=` / `?location_id=` query params.
   - `locationFromBody(body)` — reads `body.location_id` (falls back to `'default'`).
3. Client state lives in `localStorage.lariat_location` via the
   `useLocation()` hook (`app/_components/useLocation.js`); the hook
   broadcasts a `LOC_EVENT` custom event on change so the sidebar +
   palette + floorplan stay in sync without prop-drilling.
4. Export + backup scripts filter with `LARIAT_EXPORT_LOCATION` or
   `LARIAT_LOCATION` env (default `'default'`).
5. Per-site constants (e.g. `LARIAT_ELEVATION_FT = 7800` in
   `lib/calibrations.ts`) stay as module constants until a second
   site opens; migration path is a new `locations.elevation_ft` column.

**Do not** derive `location_id` from cookie, header, or session — the
request carries it explicitly so curl + iPad + server-render all agree.

---

## 5. Nav / UX

`app/_components/navRegistry.js` is the **single source of truth** for
every navigation link, command-palette entry, and floorplan zone.

- Adding a new page = add one entry to `NAV_ITEMS` with
  `{ id, title, href, group, aliases }`. The sidebar, palette, shelf,
  and floorplan all pick it up.
- `itemForPath(pathname)` resolves the active item.
- `withLocation(href, locationId)` threads the current `?location=` through.
- Never hand-roll a `<Link>` into a page that isn't in `NAV_ITEMS` —
  the palette + sidebar will get out of sync.

---

## 6. UI copy

`docs/UI_COPY_RULES.md` is binding for anything a cook sees. Route
paths (`/analytics`, `/admin/cleaning-schedule`) are internal — they
are allowed to carry SaaS-shaped words. **Labels surfaced to users**
go through the preferred-replacements list in the copy rules.

Quick checks before committing UI copy:
- Does it sound like a kitchen manager, not a product manager?
- Is it under 2-second readable?
- Is it using a 5th–8th-grade word?

---

## 7. Testing

- **Pure rule modules**: `tests/js/test-<concept>-rules.mjs` — Node
  test runner, no DB, every threshold boundary exercised.
- **API routes**: `tests/js/test-<concept>-api.mjs` — in-memory SQLite
  via `setDbPathForTest()`, audit-event emission verified, PIN gate
  verified.
- **Schema**: `tests/js/test-schema-migrations.mjs` — every migration
  idempotent, `assertCriticalSchemas()` catches partial deploys.
- **Parity**: `tests/js/test-unit-convert-parity.mjs`,
  `tests/js/test-ingredient-key-parity.mjs` — regenerate fixtures
  from Python when logic changes; Python is authoritative.
- **Python**: `tests/python/test_*.py` for seed / invoice /
  catch-weight / ingest math.
- **E2E**: `playwright.config.ts` + a couple of smoke flows.

Do **not** mock SQLite. Integration tests hit a real in-memory db.
(`test-cooling-bridges` / `fix-costing-bridges` history confirms: we
got burned on mocked costing math once; don't retry.)

---

## 8. Seeding vs live data

- `data/seeds/*.csv` → SQLite seed tables (yields, densities, unit
  weights, catch weights). Seeds are curated, version-controlled, and
  re-ingestable. Every seed script is idempotent (UPSERT, never
  DELETE+INSERT for seed data).
- `data/cache/*.json` → read-only config templates generated by
  `npm run ingest` / `rebuild-cache`. Never hand-edit; change the
  workbook or the source CSV and re-ingest.
- `data/lariat.db` → live operational state + imported financials.
  Live ops tables (line checks, 86s, inventory, HACCP logs) are
  append-only by convention and write through `audit_events`.
  Financial tables (`vendor_prices`, `recipe_costs`, `bom_lines`) are
  DELETE+INSERT per ingest run — `pack_size_changes` and
  `ingest_runs` preserve history across those sweeps.

---

## 9. Fire-and-forget trigger (post-write recomputes)

When a write handler (e.g. `POST /api/receiving`) should kick off a
downstream recompute that the caller doesn't need to wait for, use
this shape:

```js
// top of file — static import so a resolver/transpile failure is
// caught at module load, not silently swallowed.
import { triggerComputeEngine } from '../../../lib/computeEngine';

// inside the handler, AFTER the primary write has committed:
setImmediate(() => {
  try {
    triggerComputeEngine(location_id);
  } catch (err) {
    console.error('Compute Engine Trigger Error:', err);
  }
});
return Response.json({ ok: true /* … */ });
```

**Rules:**

1. **Static import at the top of the file**, not `await import(...)` or
   a floating `import(...).then(...)`. The latter silently eats
   resolver failures — the handler returns 200 but the recompute never
   fires and no one finds out.
2. **`setImmediate`, not a microtask chain.** The trigger is
   synchronous better-sqlite3 work. `Promise.resolve().then(fn)` runs
   `fn` as a microtask, which Node executes before returning control
   to the I/O phase — the response would still wait on the full SQL
   work to complete. `setImmediate` schedules a macrotask that runs
   after the I/O phase, so the response flushes first. (If the
   trigger is truly async — e.g. a `fetch` to another service — a
   microtask chain is fine; this rule is specifically about
   synchronous better-sqlite3 work.)
3. **`try/catch` inside the `setImmediate` callback**, not around the
   scheduling call. The scheduling call can't throw; the work inside
   can. Log but do not propagate — the primary write has committed
   and the response is already authoritative.
4. **Kick off AFTER the primary write's transaction closes.** A
   recompute that races the primary INSERT may read stale data.
5. **Serverless caveat.** On platforms that freeze the function
   instance the moment the response is sent (some edge runtimes,
   Cloudflare Workers without `waitUntil`), `setImmediate` callbacks
   may never fire. The Node.js runtime on Vercel/AWS Lambda keeps
   the instance alive while the event loop has pending work, which
   is the deployment this pattern targets. Document the platform in
   the handler's module header if deploying elsewhere.

---

## 10. LLM action JSON (deterministic backend intercept)

Use this pattern whenever the Kitchen Assistant needs a number the
LLM can't reliably compute (prices, yields, unit conversions). The
LLM emits a structured JSON action; the backend recognizes the
`action` string, runs the deterministic computation, and appends the
result to the assistant's final answer.

**System prompt (see `lib/ollama.ts::CREATIVE_SYSTEM`):** instruct the
LLM to emit JSON for the action; be honest about what the backend can
and cannot do (e.g. cross-dim conversion needs a density on file).

**Action JSON shape** — always the outermost balanced `{…}` in the
response, parsed by `extractAction()` in `app/api/specials/route.js`:

```json
{ "action": "cost_special", "ingredients": [{ "item": "...", "qty": 1.5, "unit": "lb" }] }
```

**Backend handler** (pseudocode):

```js
const { payload, stripped } = extractAction(llmContent);
if (payload?.action === 'cost_special' && Array.isArray(payload.ingredients)) {
  const result = computeSandboxCost(locationId, payload.ingredients);
  finalAnswer = stripped + renderCostMarkdown(result);
}
```

**Rules:**

1. **Guard every `payload.*` field.** The LLM can invent bad types;
   `Array.isArray()`, `typeof === 'string'`, etc., checks are
   mandatory before any field flows into DB or compute code.
2. **`stripped` removes the JSON block from what the user sees** —
   they should see the rendered result, not raw JSON.
3. **The deterministic result must be honest.** If the computation
   was partial (missing density, unmatched ingredient), surface that
   in both the output and the total label. The promise of
   "deterministic from live data" only holds when the result reflects
   the full request.
4. **Guard every dynamic-import removal with a static import.**
   `await import('../../../lib/computeEngine/sandboxCosting')` inside
   the handler used to be the pattern; it silently swallowed module
   errors. Use a top-level static import.
5. **Prompt wording must match backend capability.** If the prompt
   claims "true exact cost" and the backend produces a density-free
   approximation for some ingredients, operators trust a number they
   shouldn't.

Each new action type should get its own handler arm and its own
matching prompt clause — the shape is stable across
`cost_special` / (future) `cost_menu` / `scale_recipe` etc.
