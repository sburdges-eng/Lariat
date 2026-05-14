# Lariat — Combined App Demo Walkthrough

A single, traceable end-to-end demo of every Lariat feature. Designed so a
human can run it, edit any underlying data, and re-verify in one command.

This doc is the entry point. The deeper docs in `docs/` are the
authoritative references for each subsystem.

---

## 1. One-command launch

From this repo's root:

```bash
./scripts/Lariat\ Cockpit.command       # double-clickable launcher
# or
./scripts/launch_lariat.sh              # same thing, terminal-friendly
# or, during dev with hot reload:
npm run dev                             # next dev on :3000
```

The dev launcher prints two URLs:

| URL                              | For                              |
|----------------------------------|----------------------------------|
| `http://localhost:3000`          | The Mac running the server       |
| `http://192.168.x.x:3000`        | iPads / phones on the same wifi  |

KM / manager surfaces (analytics, costing, purchasing, beo, shows,
management) are PIN-gated. The PIN is set via `LARIAT_PIN` in `.env.local`.
Sign in once per browser at `/login-pin`.

---

## 2. Verify everything works (one command)

```bash
# Whole-app smoke: authenticate, hit every nav surface, scan dev log.
scripts/demo-smoke.sh

# Verification gates (food-safety rules must always be green).
npm run test:rules          # HACCP pure-rule modules (390 tests)
npm run test:schema         # migration idempotency
npm run test:compute-engine # cost / margin / variance contracts

# Full verify (typecheck + jest unit + rule tests + build).
npm run verify
```

The smoke script reports per-surface status + size and tails the dev log
for any `⨯ SqliteError / TypeError / Error:` since it started. It exits
non-zero on any 5xx, app-error page, or runtime error.

---

## 3. Feature tour — what's in the combined demo

Lariat is a single Next.js 14 cockpit that unifies line-cook ops, food
safety, labor compliance, costing, sales analytics, events, live-shows,
and management. Every page is reachable from the sidebar and ⌘K palette,
both fed from `app/_components/navRegistry.js` (single source of truth).

### Today + station ops (line-cook iPad workflow)

| Surface | Route | What you see |
|---------|-------|--------------|
| Today | `/` | Per-station status, active 86s, recent inventory updates |
| Command | `/command` | GM at-a-glance dashboard |
| All stations | `/stations` | Line overview — pass/fail/par/have per item, sign-off |
| Host Stand | `/host` | Waitlist surface + LaRi predictions |
| Punch ticket | `/kds/punch` | Expo fire + send-to-line ticket |
| 86 Board | `/eighty-six` | Active 86s, KM resolves when restocked |
| Recipes | `/recipes` | Searchable recipe book, batch scaler |
| Inventory | `/inventory` | Append-only adjustments + counts + par + waste |
| Prep board | `/prep` | Today's prep tasks |
| Fire schedule | `/prep/fire-schedule` | BEO course timing wall |
| Reservations | `/reservations` | Bookings + parties |
| Floor plan | `/floor` | Spatial floor / tables layout |

### Specials, suggestions, recognition

| Surface | Route | What you see |
|---------|-------|--------------|
| Ask the kitchen | `/kitchen-assistant` | Local Ollama chat grounded in your data |
| Specials | `/specials` | Specials sandbox (LLM-assisted) |
| Saved specials | `/specials/saved` | Sandbox history + CSV export |
| Gold stars | `/gold-stars` | Cook recognition log |

### Food safety + labor compliance (HACCP, regulated)

| Surface | Route | Rule module |
|---------|-------|-------------|
| Food safety hub | `/food-safety` | Tile dashboard |
| Temp log | `/food-safety/temp-log` | `lib/tempLog.ts` |
| Receiving | `/food-safety/receiving` | `lib/receiving.ts` |
| Calibrations | `/food-safety/calibrations` | `lib/calibrations.ts` |
| Time control (TPHC) | `/food-safety/tphc` | `lib/tphc.ts` |
| Labor | `/labor` | Breaks (COMPS #39), certs, HFWA sick, tips, wage notices |

Each regulated concept lives in exactly five files (pure rule module in
`lib/<concept>.ts`, API route in `app/api/<concept>/route.js`, board UI in
`app/food-safety/<concept>/`, hub tile, and paired tests in
`tests/js/test-<concept>-rules.mjs` + `test-<concept>-api.mjs`). See
`docs/PATTERNS.md §1`.

### KM / manager (PIN-gated)

| Surface | Route | What you see |
|---------|-------|--------------|
| Analytics | `/analytics` | Toast sales + Shamrock spend trends |
| Costing | `/costing` | Recipe costs, BOM, vendor prices, variance |
| Purchasing | `/purchasing` | Order guide |
| Menu engineering | `/menu-engineering` | Margin × popularity quadrant |
| Depletion exceptions | `/costing/depletion-exceptions` | Unmapped sales lines |
| Pack-size changes | `/costing/pack-changes` | T6 pack-size detect audit |
| BEO | `/beo` | Banquets/events + prep tasks |
| Equipment | `/equipment` | Slicers, ranges, warranties, maintenance |
| Bar | `/bar` | Cocktail / beverage cost |
| Data lookup | `/datapack-search` | USDA / FDA Food Code / Open Food Facts |
| Allergen lookup | `/allergen-lookup` | GTIN / barcode allergen check |
| Tonight (live) | `/shows/tonight` | Running show + sound/stage/box-office |
| Booking | `/booking` | Show pipeline |
| Playbook | `/playbook` | Marketing / ads / tickets |
| Past shows | `/shows/archive` | Settlement history |
| Management | `/management` | GM rollup |
| Temp PINs | `/management/temp-pins` | Scoped temp-PIN issuance |

---

## 4. Where to edit — human-editable surfaces

Lariat is built around **Excel as the human layer**. You edit workbooks
in Excel; ingest scripts regenerate the JSON cache + SQLite read model.

```
Excel ───▶ scripts/ingest*.{mjs,py} ───▶ data/cache/*.json
                                    └──▶ data/lariat.db  ───▶ Next.js UI
```

### Source workbooks (`XL/`, gitignored)

| File | What it feeds | Re-ingest with |
|------|---------------|----------------|
| `XL/Lariat_Unified_Workbook.xlsx` | Line checks, setups, recipe book, staff (from `Labor - By Employee`), Toast sales | `npm run ingest` |
| `XL/Lariat Recipe Book.pdf` | Optional PDF recipes | `npm run ingest` |
| `XL/Lariat_Master_Costing_*.xlsx` | vendor_prices, recipe_costs, bom_lines, ingredient_maps | `npm run ingest:costing` |
| `XL/lariat_operations_workbook_*.xlsx` | order_guide_items | `npm run ingest:costing` |
| `XL/Lariat_Analytics_Workbook.xlsx` | sales_lines, spend_monthly | `npm run ingest:analytics` |

Default paths can be overridden by env vars — see `docs/OPERATIONS.md`.

### Other editable surfaces

| Surface | Path | Notes |
|---------|------|-------|
| Stations seed | `scripts/stations-seed.json` | Copied into `data/cache/stations.json` on ingest |
| PIN + env | `.env.local` | `LARIAT_PIN`, `LARIAT_PIN_SECRET`, `LARIAT_OLLAMA_URL`, … |
| Nav registry | `app/_components/navRegistry.js` | Add a page = add one entry |
| Rule thresholds | `lib/<concept>.ts` | FDA Food Code citations live in the rule module, not in copy |

### Out-of-band imports

```bash
npm run import:vendor-prices -- path/to.csv     # beverage prices
npm run ingest:toast                            # Toast weekly pull
npm run ingest:shows                            # show pipeline xlsx
```

### Full refresh

```bash
npm run ingest:all          # ingest + costing + analytics + toast + shows
```

---

## 5. Trace map — follow any number from page back to source

This is what makes the demo **traceable**. Pick any number on a page and
walk it back:

```
UI page (app/<route>/page.jsx)
   ▲
   │ reads via SQL prepared statement
   ▼
data/lariat.db (SQLite, WAL)
   ▲
   │ written by ingest script + audit event
   ▼
scripts/ingest*.{mjs,py}  ─── reads ───▶  XL/ workbook (Excel)
                                          ─── written by humans
```

### Example traces

**Recipe cost on `/costing`:**
1. Page reads `recipe_costs` table in `data/lariat.db`.
2. Rows written by `scripts/ingest-costing.mjs` from `XL/Lariat_Master_Costing_*.xlsx`.
3. Live recompute via `POST /api/compute/status` (`lib/computeEngine/`).
4. Audit trail in `audit_events` (every mutation).

**86 banner on `/`:**
1. Reads `eighty_six` table where `resolved_at IS NULL`.
2. Rows written by `POST /api/eighty-six` from the station tap.
3. Each insert emits an `audit_events` row inside the same transaction.

**Temp-log yellow vs red:**
1. UI calls rule module `lib/tempLog.ts::classifyTempReading()`.
2. Out-of-range + corrective note → yellow; out-of-range alone → red.
3. The 422 `needs_corrective_action` response enforces it at write time.

### Audit (two tracks)

| Track | Where | What |
|-------|-------|------|
| DB audit | `audit_events` table | Every regulated mutation (transactional) |
| File audit | `data/audit/management-actions.jsonl` | Management actions outside regulated tables |

---

## 6. Test runners — three, do not mix

```bash
npm run test:unit                   # Jest (jsdom) — React component tests
node --test tests/js/*.mjs          # Node test runner — API/rule integration
pytest tests/python                 # ETL / parity tests
npm run test:e2e                    # Playwright
```

Run a single file:

```bash
node --test tests/js/test-cooling-rules.mjs
node --experimental-strip-types --test tests/js/test-compute-engine.mjs
```

The `--experimental-strip-types` flag is required for any `node --test`
that imports a `.ts` file directly — match the pattern in `package.json`.

---

## 7. Daily exports

```bash
npm run export                      # today's line checks, sign-offs, 86s, inventory
npm run export 2026-04-07           # specific date
npm run export:v2                   # snapshot v2 tables (costing, sales, BEO, …)
npm run backup                      # snapshot data/lariat.db{,-wal,-shm} into backups/
```

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| iPad can't reach the laptop | Same wifi network; disable iPad "private wifi address" |
| Recipes / line checks stale | `npm run ingest` |
| Costing surfaces empty | `npm run ingest:costing` |
| Analytics surface empty | `npm run ingest:analytics` |
| "AI is down" banner on `/kitchen-assistant` | Start Ollama; check `LARIAT_OLLAMA_URL` |
| Data pack 503 from `/api/datapack/search` | Mount SSD or symlink `data/lariat-data`; rebuild indexes |
| `better-sqlite3` fails to build | `xcode-select --install`, then `npm rebuild better-sqlite3` |
| Wipe today's line ops state | Delete `data/lariat.db`; rerun `npm run ingest:all` |

---

## 9. What "complete + verified" looks like

Every box must check before the demo is shippable:

- [ ] `scripts/demo-smoke.sh` → 39/39 surfaces 200, no runtime errors
- [ ] `npm run test:rules` → 390 pass / 0 fail (HACCP — regulated, hard rule)
- [ ] `npm run test:schema` → migration idempotency holds
- [ ] `npm run test:compute-engine` → C1–C4 / R2-C5 / I2 / I4 contracts hold
- [ ] `npm run verify` → typecheck (on tracked code), unit, rules, build all green
- [ ] PIN sign-in works at `/login-pin`
- [ ] Re-ingest from workbook → page reflects the change

If any of those fail, the demo isn't complete — fix the failure, don't
work around it.
