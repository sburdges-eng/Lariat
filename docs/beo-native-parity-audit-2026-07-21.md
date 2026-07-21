# BEO Native-Parity Gap Report — Lariat_BEO_Studio_5 vs. LariatNative

Read-only audit, generated 2026-07-21 by the `swift-port-audit` agent. Not implementation —
scoping only. See `docs/Lariat_BEO_Studio_5.html` for the source prototype and
`~/.claude/skills/lariat-assistant/references/data-map.md` for how to re-extract its seed data.

Source of truth read: `docs/Lariat_BEO_Studio_5.html` (1038 lines; seed data extracted from line
198), `app/beo/**`, `app/api/beo/**`, `lib/beo*.ts`, `lib/db.ts` (BEO DDL ~lines 1645–1714,
3015–3055, migrations ~3677–3745), `tests/js/test-beo-*.mjs` (19 files, 3,974 lines), and
`LariatNative/Sources/{LariatModel,LariatDB,LariatApp}/**Beo**` + their test suites.

**Key structural fact:** Studio 5's 7-tab shell (Library/Season/Event/Host/Kitchen/Management/Settings)
does **not** map 1:1 onto either the web or native BEO surfaces. Web/native both organize around a
single "party" screen with sub-tabs (**Sheet / Order guide / Prep / Fire**) plus a separate
print/share **Estimate** document — Studio 5's Host+Kitchen+Management+Settings+Season+Library are
cross-cutting concerns Sean prototyped standalone. Below, each Studio 5 capability is mapped to
whichever web/native artifact actually covers it, however differently named/shaped.

---

## TIER 1 — Already native or partial-native (extend existing pattern)

### 1. Event build (order lines, pricing, prep notes, course binding)
- **Status:** partial-native. `LariatNative/Sources/LariatApp/UI/Boards/BeoBoardView.swift` +
  `BeoBoardViewModel.swift` already implement the prep-sheet (item/prep/secondary-prep/order-items
  + course binding), catering-menu autocomplete pricing, and CRUD (`requestAddLine`,
  `requestUpdateLine`, `requestDeleteLine`, `requestAddCourse`, `requestBindLine`).
- **Web equivalent:** `app/beo/BeoBoard.tsx` "Sheet" tab + `app/api/beo/route.js`
  (`action: line/update_line/delete_line`), backed by `beo_events`/`beo_line_items`
  (`lib/db.ts:1645-1675`).
- **Gap vs. Studio 5:** Studio 5 models `space`, `service_style` (passed/buffet/plated),
  `service_hours`, and a structured `bar{mode,amount,notes}` / `av[]` / `fees[]` / `soe[]`
  (run-of-show) as first-class fields (`docs/Lariat_BEO_Studio_5.html:395-408`, `516-572`). None of
  these columns exist in `beo_events`/`beo_line_items`; web/native only have a flat line-item list
  (AV/bar/fees would have to be shoehorned in as line items with `category`, which loses the
  charge-vs-cost split Studio 5 relies on for margin math).
- **Port scope:** Records/Records+Repository extension only if these fields get added to the web
  schema first (native ports web, doesn't invent schema) — flag as an **owner call**: extend
  `beo_events`/new child tables for `space`/`service_style`/`service_hours`/`bar`/`av`/`fees`/`soe`,
  then port. One wave, Compute+Records+Repository+View.
- **Risk:** PIN-gated (manager-PIN write session via `BeoBoardViewModel.gate()`/`showPinSheet`/
  `PinEntrySheet`, mirrors web's `hasPinCookie`/`hasPinOrTempPin` split in
  `app/api/beo/route.js:39-46`), `location_id`-scoped throughout, `postAuditEvent`-logged on every
  web write (`app/api/beo/route.js:164-168` etc.) — native already threads the equivalent
  `RegulatedWriteContext`.

### 2. Invoice math (subtotal/tax/service-fee/total)
- **Status:** already-native, but **narrower than Studio 5's formula**.
  `LariatNative/Sources/LariatModel/Compute/BeoWorksheetCompute.swift:47`
  (`totals(lines:taxRate:serviceFeePct:)`) ports `lib/beoEstimate.ts:14-23`
  (`computeEstimateTotals`) exactly: `subtotal = Σ(unit_cost×quantity)`,
  `serviceFee = subtotal × pct/100`, `tax = subtotal × rate`.
- **Web equivalent:** `lib/beoEstimate.ts` + `app/beo/_components/EstimateDocument.jsx`. Parity
  oracle: `tests/js/test-beo-estimate.mjs` (48 lines) and `tests/js/test-beo-worksheet.mjs`
  (524 lines, the native-facing oracle).
- **Gap vs. Studio 5:** Studio 5's `computeInvoice` (`docs/Lariat_BEO_Studio_5.html:226-237`) folds
  in `avC` + `feeC` + a **fill-to-minimum-or-fixed bar revenue** term before tax/fee:
  `subtotal = foodRev + avC + feeC + barRev`,
  `barRev = bar.mode==="fill" ? max(0, minimum-nonbar) : fixedAmount`. Since web/native have no
  structured bar/AV/fee objects (see #1), this fill-to-minimum bar math has no home yet.
- **Risk (money-rounding parity):** `BeoWorksheetCompute.roundMoney` — confirm it matches web's
  rounding at total boundaries (already documented in `BeoRecords.swift:9-16` as the single
  rounding point; good pattern, keep it that way for any new money math).
- **Risk (tax-rate data mismatch — flag, don't fix):** the DB default is
  `tax_rate REAL DEFAULT 0.0675` (6.75%) (`lib/db.ts:1654`, `:3681`, `:3878` for the `locations`
  fallback), but Studio 5's `money_cfg.tax = 0.0815` (8.15%) and a web test fixture
  (`app/__tests__/EstimateDocument.test.jsx:8`) also uses `0.0815`. Real events appear to get
  `tax_rate` overridden at creation time, but the **schema default itself may be stale** relative
  to the actual combined Buena Vista, CO rate Sean encoded in Studio 5. Worth a business-side
  confirmation before any Settings screen makes this editable.

### 3. Fire schedule
- **Status:** native-via-different-design — **not a gap, an intentional divergence** worth
  surfacing to the user. `BeoFireScheduleCompute.swift` + `BeoFireScheduleRepository.swift` +
  `BeoFireScheduleView.swift` (registered as `beo.fireSchedule`, tier `.beo`,
  `FeatureCatalog.swift:145`) port the web's **per-station rollup of explicit, manually-set
  `fire_at` timestamps** on `beo_courses` (`lib/beoFireSchedule.ts:52-107`, age-bucketed
  green/yellow/red at `:109-128`) — courses group line items and each course has an operator-set
  fire time.
- **Web equivalent:** `app/api/beo/fire-schedule/route.js`, `app/beo/_components/EventFirePanel.jsx`,
  `lib/beoCourses.ts` (course validation). Parity oracle: `tests/js/test-beo-fire-schedule-rules.mjs`,
  `test-beo-fire-schedule-api.mjs`, `test-beo-courses-rules.mjs`, `test-beo-courses-api.mjs`.
- **Studio 5's mechanism is completely different:** `computeFire`
  (`docs/Lariat_BEO_Studio_5.html:315-330`) *auto-derives* fire time by regex-matching each
  menu-item name against `DATA.buyfire` (9 hardcoded buy-and-fire-from-frozen items with a `lead`
  in minutes) and `DATA.tech_leads` (7 hardcoded technique-lead regexes, e.g.
  `prime rib|roast|whole` → 180 min before service), falling back to a flat 20-min default — all
  timed backward from a single `service` clock string.
- **Recommendation:** do **not** port Studio 5's regex engine as a replacement — the web/native
  explicit-`fire_at`-per-course model is more accurate (operator-authored, not string-matched) and
  already shipped. If Sean wants Studio 5's *auto-suggest-a-fire-time* convenience as a data-entry
  aid on top of the existing course system, that's a small greenfield addition (see Tier 2), not a
  port.

### 4. Kitchen "To Purchase" list / order guide
- **Status:** already-native, and **materially better than Studio 5's source**.
  `BeoCascadeCompute.swift`, `BeoCascadeRepository.swift`, `BeoCascadeClient.swift` (registered A6
  wave, per the beer-flour/carnitas PRs in memory) implement a real recipe-BOM cascade
  (`BomExpandCompute.aggregateDemand`) with on-hand-inventory subtraction, unmapped-item reporting,
  and manifest warnings.
- **Web equivalent:** `app/api/beo/cascade/route.js`, `app/beo/_components/EventOrderGuidePanel.jsx`
  + `UnmappedCallout.jsx`, `lib/beoCascade.ts`. Parity oracle: `tests/js/test-beo-cascade.mjs`,
  `test-beo-cascade-api.mjs`.
- **Studio 5's `computePurchase`** (`docs/Lariat_BEO_Studio_5.html:338-345`) is a flat, hardcoded
  77-entry `DATA.purchase` lookup (menu-item string → product/pack/note), fuzzy-matched by
  `matchKey`. **Do not port this table** — it's strictly inferior data (Sean's own prototype has no
  BOM/on-hand awareness); the existing `BeoCascadeCompute` pipeline is the correct source of truth
  to keep extending instead.

### 5. Kitchen allergen matrix
- **Status:** native-via-different-name, and again better-sourced.
  `LariatNative/Sources/LariatApp/UI/Boards/AllergenLookupView.swift` +
  `lib/allergenAttestations.ts` (web) + `allergen_attestations` table (`lib/db.ts:3132-3144`,
  ingredient-composition-derived, not string matching) is a real DB-backed allergen system.
- **Gap:** neither surface currently renders a **per-BEO-event allergen summary** (Studio 5's
  `computeMatrix`, `docs/Lariat_BEO_Studio_5.html:331-336`, joins each event's line items against
  the matrix and flags "NEED — no recipe on file"). That specific join (event line items ×
  `allergen_attestations`) doesn't exist yet on either side.
- **Port scope:** small — a Compute function joining `beo_line_items.item_name` (fuzzy-matched,
  same `matchKey`-style normalization already used by `BeoCascadeCompute`/
  `BeoPullCompute.normalizeClient`) against `allergen_attestations`, surfaced as a panel on the
  existing BeoBoard. One wave; Compute + thin View, no new Repository (reuse `AllergenLookupView`'s
  existing repository read).
- **Do not port Studio 5's hardcoded 74-item `DATA.matrix`** — same reasoning as #4; it's
  self-flagged as incomplete and inferior to `allergen_attestations`.

### 6. Past-prep reference
- **Status:** already-native. `BeoPrepHistoryCompute.swift`, `BeoPrepHistoryRepository.swift`,
  `BeoPrepHistoryView.swift`, registered `beo.prepHistory` (tier `.beo`). Reads
  `beo_prep_history` (`lib/db.ts:1694-1714`, ingested from past invoice/workbook data, read-only).
- **Web equivalent:** `app/beo/PrepHistoryPanel.jsx`, `app/api/beo/prep-history/route.js`,
  `lib/beoPrepHistory.ts`. Parity oracle: `test-beo-prep-history-api.mjs`,
  `test-beo-prep-history-context.mjs`.
- **No Studio 5 analog** — this is a native/web-only capability, ahead of the prototype. No action
  needed.

### 7. Client-facing invoice ("Host" tab money section)
- **Status:** partial-native. Web `app/beo/_components/EstimateDocument.jsx` already renders
  subtotal/tax/service-fee/total, per-course grouping (`lib/beoEstimate.ts:25-45`
  `groupLineItemsBySection`), and a **minimum-spend meter** (`EstimateDocument.jsx:316-323`,
  `minSpend`/`minMet` — a real partial match for Studio 5's `Host` minimum meter). Native has the
  print-worksheet analog in `BeoPrintCompute.swift` (`renderText`, header/line/course/money-line
  renderers) but that's an operator kitchen printout, not the client-facing signed estimate — the
  e-sign/share flow (`app/api/beo/share/[token]`, `beo_signatures` table, `lib/beoShare.ts`) is
  explicitly flagged in `BeoFeatures.swift:3-7` and `BeoBoardView.swift:11-12` as **a confirmed
  edge blocker, not ported to native by design** (guest-facing, needs a public/unauthenticated
  surface).
- **Missing vs. Studio 5's `renderHost`** (`docs/Lariat_BEO_Studio_5.html:621-655`): bar plan card,
  FOH crew card (roles/hours/comp), allergy/dietary summary card, run-of-show list — none of these
  exist on the client-facing document because none of their underlying data models exist
  (bar/staffing/soe — see Tier 2).
- **Recommendation:** treat the e-sign/share edge-blocker call as already made (memory confirms
  this is settled); the *native operator-side* print worksheet is the right place to extend once
  bar/staffing data exists.

### 8. Library grid (all-events list)
- **Status:** native-via-different-name, partial. `BeoBoardView.swift`'s `eventSidebar`
  (lines 70-80+) already lists all events for the "On the books" rail — this is Library's core
  function, just not a dedicated tab.
- **Web equivalent:** `app/beo/BeoBoard.tsx` has an implicit event picker (not surfaced as a
  distinct "Library" concept) — confirm via `app/api/beo/route.js` GET (`beoPostHandler`... GET
  returns all events for a location, `:93-110`).
- **Gap vs. Studio 5's `renderLibrary`** (`docs/Lariat_BEO_Studio_5.html:959-1005`): per-card
  rollup stats (subtotal, minimum-met/under, margin%), urgency badges (TODAY / PREP DUE / N days
  out / PAST EVENT, `:967-985`), and a **Duplicate Event** action (`duplicateEvent`, `:451-453`) —
  grepped and confirmed **no `duplicate`/clone action exists in `app/api/beo/route.js`** on web at
  all, so this would be greenfield on both sides, not just a native port.
- **Port scope:** small-to-medium. Badge logic needs `computeCountdown`-equivalent (see Tier 2 #9)
  to know "prep due"; margin% needs the margin engine (Tier 2 #11) to exist first. Duplicate-event
  is a straightforward one-route/one-repository-method addition (INSERT event + line items +
  courses from a source id) — but needs a **web-first decision** since native conventionally ports
  web, and there's no web route to port from yet.

---

## TIER 2 — Greenfield, no web analog anywhere (needs its own spec; product calls flagged)

These were grep-confirmed absent from `app/beo/**`, `app/api/beo/**`, `app/management/**`,
`app/costing/**`, and `LariatNative/Sources/**` (the only "margin"/"staffing" hits in the codebase
are the unrelated recipe-costing engine: `lib/computeEngine/marginAnalysis.ts`,
`lib/menuEngineering.ts`, `LariatNative/Sources/LariatModel/Compute/CostingCompute.swift` — a
per-dish food-cost margin, not an event-level P&L).

### 9. Prep countdown checklist (date-bucketed, backward from event date)
- **Status:** greenfield. `beo_prep_tasks` (`lib/db.ts:1677-1687`) is a **flat, manually-typed**
  task list (`task`, `due_date`, `done`) with no auto-generation logic. Studio 5's
  `computeCountdown` (`docs/Lariat_BEO_Studio_5.html:279-295`) auto-generates day-bucketed tasks by
  regex-matching each line item against `DATA.prep_leads` (16 rules, e.g.
  `carnitas|barbacoa|...` → 3 tasks at −3/−2/0 days) and `DATA.default_prep`, then **shifts any
  date landing on a closed weekday backward**
  (`jsClosed = closed_weekdays.map(p=>(p+1)%7)`, i.e. Mon/Tue) via a `while` loop — native should
  **block/flag** a task landing on a closed day rather than silently auto-shift it, matching the
  web skill's deliberate choice not to auto-shift.
- **Risk — hardcoded heuristic data:** `prep_leads`/`tech_leads`/`buyfire`/`default_prep` are all
  Sean's hand-authored regex tables with no DB backing anywhere in the product (grepped — zero hits
  for `prep_lead`/`prepLead`/`leadDays` outside Studio 5). If ported, this should **not** become a
  hardcoded Swift `enum` of regexes; either (a) start as an editable/reviewable native config
  (mirrors the `bar_cfg`/`money_cfg` treatment below) or (b) design it as a per-recipe
  `prep_lead_days` field feeding off the existing recipe manifest (`RecipeManifest`, already used
  by `BeoCascadeCompute`/`BeoPullCompute`) rather than string-matching menu-item names a second,
  parallel way.
- **Port scope:** needs a web route first (own spec — no `/api/beo/prep-tasks/auto-generate`-style
  endpoint exists) or a native-first greenfield build if the owner explicitly wants native-only.
  Either way: Compute (countdown generator + closed-day-block rule) + Records (extend
  `beo_prep_tasks` or new table) + Repository + View. Medium-sized, one wave once the data-source
  decision above is made.

### 10. Staffing math (headcount → role counts, hours, wages)
- **Status:** greenfield, confirmed via full-repo grep (no `staffRatio`/`laborCost`/`servers_min`
  analog anywhere). Studio 5's `computeStaff` (`docs/Lariat_BEO_Studio_5.html:238-267`): per-role
  headcount ratios that vary by `service_style` (passed/buffet/plated), `Math.ceil`
  headcount/ratio with role minimums, every staffer bills
  `service + setup(2h) + breakdown(1h)`, plus BOH prep hours =
  `20h base + 1.5h × scratch-item-count` (scratch = line items **not** matched in `DATA.buyfire`).
- **Depends on:** `service_style`/`service_hours` fields (Tier 1 #1 gap) and a scratch-item
  detector (would want to reuse the existing recipe-manifest/BOM-mapped-vs-unmapped signal from
  `BeoCascadeCompute`/`BeoPullCompute` rather than re-deriving against a hardcoded `buyfire`
  table).
- **Risk:** wages (`Server: 70`, `Line cook: 20`, dish/steward: 20) are stored as
  **gratuity-inclusive FOH $70/hr assumptions** with an explicit house-benchmark note in the seed
  (`staff_cfg.benchmark`, "compare event labor against the service fee + gratuity, not this number
  alone") — this is real payroll-adjacent business logic; needs a product decision on whether wage
  rates are hardcoded constants, a Settings-editable config, or should read from an existing
  wages/labor table if one exists elsewhere in the labor tier (worth checking `lib/db.ts` labor
  schema before building a second wage source of truth).

### 11. Margin math (event-level P&L)
- **Status:** greenfield. `computeMargin` (`docs/Lariat_BEO_Studio_5.html:268-278`):
  `collected = subtotal + serviceFee` (excludes tax),
  `margin = collected − foodCOGS(32%) − barCOGS(25%) − labor − other`. **Hard dependency on #1
  (bar as a distinct revenue stream)** and **#10 (staffing→labor cost)** — can't be built before
  those.
- **Risk:** `food_cogs`/`bar_cogs` (32%/25%) are flat planning assumptions with zero DB backing
  (unlike the unrelated recipe-costing engine's per-dish COGS, which *is* real and DB-backed —
  worth asking whether event-level `foodRev × 32%` should instead sum real per-dish costs from the
  existing costing engine for the specific line items ordered, which would be far more accurate
  than a flat rate and reuses `CostingCompute.swift`/`lib/computeEngine`).

### 12. Bar-consumption forecast
- **Status:** greenfield. `computeBarPlan` (`docs/Lariat_BEO_Studio_5.html:296-314`):
  `drinkers = headcount × 0.75`, `drinks = drinkers × (2 + 1×(hours−1))`, split by `mix` shares
  (beer 40%/wine 25%/spirits 30%/NA 5%) and converted to cases/bottles via `yields`.
- **Risk — explicitly self-flagged unverified data:** `bar_cfg._meta` in the seed literally says
  *"Industry-standard event beverage planning rates — NOT yet calibrated to Lariat actuals...
  verify against Toast bar sales on the next 3-4 events, then tune"*
  (`docs/Lariat_BEO_Studio_5.html` DATA seed, `bar_cfg._meta`). This is the **one** dataset in
  Studio 5 that's legitimately fine to port as literal seed data (it's a planning heuristic Sean
  wrote himself, not a stand-in for missing recipe/inventory truth like the purchase/allergen
  tables) — **but** because Sean's own note says it needs tuning after real events, it should land
  as an **editable, DB-backed config** (mirroring how `money_cfg` would need to work in Settings)
  rather than a hardcoded Swift constant, so it can actually get tuned without a rebuild.

### 13. "After the Event" actuals-vs-forecast + auto-generated learnings text
- **Status:** greenfield, no analog anywhere. `computeActuals`
  (`docs/Lariat_BEO_Studio_5.html:346-375`) takes manually-entered actuals (food/bar sales,
  food/bar cost, FOH/BOH hours, labor $) and diffs them against the forecast, auto-generating
  English "learnings" strings (e.g. *"Real food cost X% vs the Y% assumption — model runs
  high/low"*). Fully dependent on #10/#11 existing first.
- **Risk:** none money-critical (it's a manager-facing retro tool, not a live transaction), but the
  auto-generated text logic (percentage deltas, sign-flipped phrasing) would need fresh unit tests
  since there's no `tests/js/test-beo-*` oracle to port from — author fresh against Studio 5's
  code.

### 14. Management tab (KPI tiles, waterfall, labor detail, BOH-labor-% gauge)
- **Status:** greenfield presentation layer over #10/#11/#13. No web page renders any of this for
  BEO (`app/management/**` covers unrelated GM-dashboard concerns, not catering P&L — confirmed no
  overlap by grep).
- **Port scope:** View + thin ViewModel only, once #10/#11 compute layers exist. Not a separate
  wave on its own.

### 15. Settings tab (editable money rules, labor rates, hours, staffing ratios, menu price list,
    reset-to-defaults)
- **Status:** greenfield, and this is the biggest structural gap. Two distinct pieces:
  - **Global money/labor/staffing config** (`money_cfg`, `staff_cfg`) has **no DB table
    anywhere** — `tax_rate`/`service_fee_pct` are per-event fields on `beo_events` (operator sets
    them at event creation, default 6.75%/20%), not a global editable rule set;
    `food_cogs`/`bar_cogs`/wages/hours/ratios don't exist in the schema at all.
  - **Menu price list** — Studio 5 lets the user live-edit/add/delete prices and persists to
    localStorage. Confirmed the web catering menu (`getCateringMenu()`, `lib/data.ts:305-307`) is
    a **static read-only JSON file** (`catering_menu.json`), not DB-backed and not editable via any
    UI on web or native.
- **Recommendation:** flag as an explicit **owner call** — this needs its own spec covering (a)
  whether global BEO money/labor rules become a new small settings table (and how they interact
  with existing per-event `tax_rate`/`service_fee_pct` overrides — precedence rules needed), and
  (b) whether catering menu pricing moves from a static JSON asset to a DB table (a real schema
  change with migration implications, not a native-only decision).

### 16. Season tab (cross-event rollup, merged prep calendar, "order once" shared-product list,
    .ics export)
- **Status:** greenfield, fully confirmed absent (grepped `Season`/`seasonData` across all of
  `LariatNative/Sources` and `app/` — zero hits outside Studio 5). `seasonData()`
  (`docs/Lariat_BEO_Studio_5.html:839-864`) iterates **every** event in the workspace, sums
  booked $/margin/covers, flags <40%-margin events, merges every event's `computeCountdown()`
  output into one calendar (with a same-day-multi-client cooler/oven-space warning), and finds
  purchase-list products used by ≥2 events for consolidated ordering. `buildSeasonICS` exports prep
  days as `.ics`.
- **Dependencies:** #9 (prep countdown) for the merged calendar, #11 (margin) for the KPI tiles,
  and — since `computePurchase` here should **not** be re-derived from Studio 5's hardcoded table —
  the "order once" list should be built on `BeoCascadeCompute`'s real order-guide output across
  multiple events instead, which is a genuinely new cross-event aggregation not currently exposed
  anywhere (today's cascade is single-event only, per `BeoCascadeRepository`/
  `app/api/beo/cascade/route.js?event_id=N`).
- **Port scope:** own wave, needs its own spec (no web route to port from). The `.ics` export is a
  pure, low-risk Compute function (`icalendar` text generation, easy to unit-test standalone) —
  cheapest sub-piece to ship first if the owner wants a quick win.

---

## Overall recommendation (from the audit agent)

**Build order:** finish Tier 1 first — it's genuine parity work with an existing web pattern and
test oracle to port against (allergen-matrix event join, then Library-card badges once the
countdown compute exists). Tier 2's dependency chain is real: `service_style`/`bar`/`av`/`fees`
schema (①) → staffing (⑩) → margin (⑪) → Management/Settings/Season UI (⑭⑮⑯) all cascade off the
same two or three foundational data-model decisions. Don't start Management/Season UI work before
the schema + compute foundations are settled, or it'll be rebuilt.

**Tier proposal (flagging, not deciding):** the existing `.beo` tier (`FeatureCatalog.swift:6-17`,
already home to `beo.board`/`beo.fireSchedule`/`beo.prepHistory`) is the natural home for
Event/Fire/Kitchen/Library-badge extensions — same audience, same PIN-gated-write pattern already
built. Management (P&L, margin waterfall, labor $) and Settings (global money/labor-rate editing)
are more financially sensitive than day-to-day party-building; consider either (a) new
`beo.management`/`beo.settings` modules still under tier `.beo` but requiring the existing
manager-PIN write session even to **view** (not just write, unlike today's Event tab which reads
openly), or (b) promoting them into the existing `.manager` tier alongside other GM-facing
financial surfaces. This is a product call — the tradeoff is discoverability (staff who build BEOs
daily vs. managers who need the P&L) vs. consistency (keeping all "BEO" concepts under one nav
tier).

**Pure-view vs. audited-write split:** Season, Management KPIs, Library badges, and the merged prep
calendar are all **derived reads** over existing audited data — no new write surface, no new
`postAuditEvent` calls needed. The only genuinely new writes are: Settings (global rate edits —
needs audit logging + manager PIN, same pattern as `beo_events`), actuals entry (#13 — also a
write, same pattern), auto-generated prep tasks (#9 — a write today's `beo_prep_tasks` insert path
already covers, just needs the generator logic), and Duplicate Event (#8 — a write, needs its own
web route since none exists).

**Files most load-bearing for the next swift-port wave:**
- Schema: `lib/db.ts:1645-1714`, `:3015-3055`, `:3677-3745`
- Compute to extend: `LariatNative/Sources/LariatModel/Compute/BeoWorksheetCompute.swift`,
  `BeoCascadeCompute.swift`, `BeoFireScheduleCompute.swift`
- Records to extend: `LariatNative/Sources/LariatModel/BeoRecords.swift`
- View/VM to extend: `LariatNative/Sources/LariatApp/UI/Boards/BeoBoardView.swift`,
  `LariatNative/Sources/LariatApp/UI/ViewModels/BeoBoardViewModel.swift`
- A0 registration: `LariatNative/Sources/LariatApp/UI/Shell/BeoFeatures.swift`,
  `LariatNative/Sources/LariatModel/FeatureCatalog.swift:144-146`
- Prototype (source of truth for Tier 2 math, cite by line):
  `docs/Lariat_BEO_Studio_5.html` (engine block lines 199-391; per-tab render functions 509-1005)
