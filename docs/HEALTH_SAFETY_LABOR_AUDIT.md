# Health, Safety & Labor Audit — Lariat Cockpit

**Scope:** Back-of-house operations app for The Lariat (Colorado). Audit covers food-safety (HACCP/CCPs, allergens, sanitation) and labor (breaks, sick leave, certs, minors, tips) against the **FDA 2022 Food Code**, **Colorado Retail Food Establishment Rules (6 CCR 1010-2)**, **Colorado Dept of Labor COMPS Order #39 (2026)**, **Colorado Healthy Families and Workplaces Act (HFWA)**, and **federal FLSA/OSHA**.

**Date:** 2026-04-21
**Auditor:** Claude, commissioned by Sean Burdges
**Output form:** Audit + full hardening edits (per user directive)

---

## 1. What's already covered — don't break this

The existing code is more mature than a typical first-pass audit target. The things below are working well and were preserved rather than rewritten.

- **HACCP temp-log with snapshotted limits.** `lib/tempLog.ts` holds eight temp points (receiving cold, walk-in cooler, freezer, cook poultry/beef/fish, hot hold, reheat) whose required min/max are snapshotted onto each row, so retroactively changing the registry can't rewrite history. Hard validation rejects bad probes (outside −100…500 °F) and refuses out-of-range readings without a corrective-action note.
- **Signoff HACCP gate.** `/api/signoff` refuses a station signoff when any failed line-check row has no note. The check is at the API layer, not just the UI, which blocks curl/replay bypass.
- **Back-date PIN gate.** `/api/temp-log` requires the manager PIN for any reading on a date ≠ today when `LARIAT_PIN` is set.
- **Big-9 allergen model.** `AllergenMatrix` already encodes the FDA Big-9 (milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, soybeans, **sesame** — per the FASTER Act, effective 2023-01-01).
- **Ingest/immutability posture.** `ingest_runs` gives per-invocation instrumentation; `AGENTS.md` rule #4 is explicit that HACCP logic is regulated and silent auto-correction is disallowed.
- **License/cert template.** The archive has `compliance/licenses_certs.csv` with property-level licenses (business, liquor, food service, ServSafe, food handlers, insurance, fire suppression, grease trap). Moving to live tracking is the next step.

## 2. Risk-ranked gap register

Severity uses a 5×5 matrix: **S** (likelihood 1–5) × **I** (impact 1–5) = **R** (risk 1–25). Impact weights:

| I | Meaning (inspector / labor consequence) |
|---|---|
| 5 | Establishment closure, criminal liability, or listeria-class outbreak exposure |
| 4 | Critical violation on health inspection, wage-theft class action |
| 3 | Non-critical citation, employee grievance with remedy |
| 2 | Warning / retrain, single-cook complaint |
| 1 | Hygiene-of-records only |

### 2.1 Food-safety gaps

| # | Finding | Citation | L | I | R | State |
|---|---|---|---|---|---|---|
| F1 | **Cooling log not modeled.** `tempLog.ts` explicitly says CCP-8 (cooling) "is not modeled as a single threshold here." Cooling is the highest-risk BOH process: pathogens multiply fastest in 70–120 °F. | FDA 2022 §3-501.14; CO 6-CCR-1010-2 §3-501.14 (135→70 °F ≤ 2 h, 70→41 °F ≤ 4 h more, total ≤ 6 h) | 5 | 5 | **25** | Hardening in migration `20260421_01_food_safety.sql` + `/food-safety/cooling` |
| F2 | **No date-marking log.** PHF/TCS ready-to-eat food held cold > 24 h must carry prep or discard date; discard ≤ 7 days. Nothing in DB or UI. | FDA 2022 §3-501.17; CO 6-CCR-1010-2 §3-501.17 | 5 | 4 | **20** | New `date_marks` table + `/food-safety/date-marks` |
| F3 | **Receiving log not separated from temp_log.** Delivery temp goes into `temp_log.receiving_cold`, but invoice #, vendor, quantity rejected, and inspector initials aren't captured. Without those, a rejection is non-traceable. | FDA 2022 §3-202.11; Shamrock/Sysco carrier temp claims | 5 | 3 | **15** | New `receiving_log` table + `/food-safety/receiving` |
| F4 | **No sanitizer log.** Dish machine final rinse 180 °F requirement is in `food_safety.json` but not captured. No chlorine/quat PPM log for three-compartment sink, wiping cloths, produce wash. | FDA 2022 §4-501.116, §4-703.11; CO 6-CCR-1010-2 | 5 | 4 | **20** | New `sanitizer_checks` table |
| F5 | **No sick-worker report flow (FDA Big-6).** Reportable illnesses (Norovirus, Salmonella Typhi, Nontyphoidal Salmonella, Shigella, STEC/EHEC, Hepatitis A) require employee to report to PIC and be excluded/restricted. No way to record attestation or exclusion. | FDA 2022 §2-201.11; CO 6-CCR-1010-2 §2-201.11 | 4 | 5 | **20** | New `sick_worker_reports` (manager-PIN-gated, never exported to general ops) |
| F6 | **No person-in-charge (PIC) / CFPM attestation per shift.** Colorado requires a Certified Food Protection Manager at each licensed establishment. No daily PIC designation is captured even though the cook signoff is. | CO 6-CCR-1010-2 §2-102.12 (CFPM); §2-101.11 (PIC present) | 4 | 4 | **16** | New `shift_pic` table + gate on `/api/signoff` |
| F7 | **No cleaning / sanitation schedule.** Equipment table tracks mechanical maintenance, not cleaning cadence (hood filters weekly, ice machine quarterly, walk-in floor monthly, etc.) | FDA 2022 §4-601.11, §4-602.11; CO 6-CCR-1010-2 | 4 | 3 | **12** | New `cleaning_log` + schedule |
| F8 | **No pest-control log.** Vendor visits and sightings aren't tracked. Inspector will ask. | FDA 2022 §6-501.111; CO 6-CCR-1010-2 §6-501.111 | 3 | 3 | **9** | New `pest_control_log` |
| F9 | **No thermometer calibration log.** Probe accuracy ±2 °F; ice-slurry calibration recommended weekly. The temp-log blindly trusts cook-entered readings. | FDA 2022 §4-203.11, §4-302.12 | 4 | 3 | **12** | New `thermometer_calibration_log` |
| F10 | **No vomit/diarrhea cleanup procedure + kit attestation.** Post-2017 Food Code, establishments must have a written procedure and cleanup kit available. | FDA 2022 §2-501.11; CO 6-CCR-1010-2 §2-501.11 | 3 | 4 | **12** | SOP doc + spot-check attestation on monthly cleaning |
| F11 | **No TPHC (time-as-public-health-control) register.** If the line uses time (not temp) for hot/cold holding of items like pizza/salad stations, a discard-time log is required. | FDA 2022 §3-501.19 | 3 | 3 | **9** | New `tphc_entries` table (opt-in per station) |
| F12 | **Allergen matrix isn't tied to recipe serving context.** The matrix tags ingredient allergens per recipe, but there's no "this plate shares a fryer with peanut oil" cross-contact flag and no customer-allergen ticket audit. | FDA 2022 §3-602.11 (not service but packaged); FASTER Act (sesame); CO retail rules defer to FDA Code 3-201.11 | 3 | 4 | **12** | `recipe_cross_contact` + modifier support; enforced on recipe page |
| F13 | **Corrective-action CSV template isn't wired to DB.** `food_safety/corrective_actions.csv` is a template but there's no route to ingest or write to it as records. Corrective actions live inside `temp_log.corrective_action` and `line_check_entries.note` only. | FDA 2022 §8-405.11 (corrective-action recording) | 4 | 2 | **8** | Alias `corrective_actions` view over the two tables + dedicated API |
| F14 | **Export doesn't include food-safety artifacts.** `npm run export` writes checks/sign-offs/86s/inventory but not temp log, cooling log, sanitizer, sick reports, etc. An inspector ask would be unserved. | Retention: FDA 90 days minimum; CO at inspector discretion; **OSHA 300 logs 5 years** | 5 | 2 | **10** | Extend `scripts/export.mjs` |
| F15 | **Bare-hand-contact-with-RTE attestation missing.** FDA prohibits except with approved program + employee health policy signed. | FDA 2022 §3-301.11 | 3 | 3 | **9** | New `employee_health_acknowledgment` + glove-change column on line checks |
| F16 | **Water, ice, and ice-machine sanitation not tracked.** | FDA 2022 §3-202.16, §4-602.11(E) | 3 | 3 | **9** | Covered by F7 cleaning schedule |
| F17 | **Chemical / SDS registry + secondary container labeling not tracked.** OSHA HazCom + FDA 7-102 — secondary containers (sanitizer buckets, degreaser squeeze bottles) must be labeled. | 29 CFR 1910.1200 (OSHA HazCom); FDA 2022 §7-102.11 | 3 | 3 | **9** | New `sds_registry` table |

### 2.2 Labor gaps (Colorado + federal)

| # | Finding | Citation | L | I | R | State |
|---|---|---|---|---|---|---|
| L1 | **No shift break tracking.** Colorado COMPS Order #39 requires a 30-minute unpaid meal period before end of the 5th hour when shifts ≥ 5 h, and a paid 10-minute rest period for every 4 h (or major fraction). Labor summary shows cooks averaging 8+ h shifts. No break recording = default wage-theft exposure. | 7 CCR 1103-1 §5.1, §5.2 (COMPS Order #39) | 5 | 4 | **20** | New `shift_breaks` + `/labor/breaks` |
| L2 | **No per-employee paid sick leave ledger.** HFWA accrual is 1 h per 30 h worked, 48 h annual cap (employer can front-load). Employer must track accrual + use + balance; must provide balance on request. | C.R.S. §8-13.3-401 et seq. (HFWA) | 5 | 4 | **20** | New `paid_sick_leave_balances` + `/labor/sick-leave` |
| L3 | **No per-employee certification tracking.** ServSafe CFPM expires 5 y; food-handler cards vary by CO county (Larimer / Denver require, many don't); TIPS alcohol service 3 y. Current `compliance/licenses_certs.csv` is property-level only. | CO 6-CCR-1010-2 §2-102.12; county ordinance per establishment; CO Liquor Code §44-3-701 (responsible vendor program) | 4 | 4 | **16** | New `staff_certifications` table + `/labor/certs` |
| L4 | **No tip-pool / tip-credit ledger.** CO tipped minimum wage $11.79/h (2026 COMPS #39). Tip credit ($3.02) requires written notice to employee and tips must at least equal credit each pay period. Pool must exclude non-tipped managers/cooks. | 7 CCR 1103-1 §3.3, §3.4; FLSA 29 CFR 531.52 | 4 | 4 | **16** | New `tip_pool_distributions` + tipped-vs-non-tipped hours flag on cook |
| L5 | **No minor-employee flag or restricted-work list.** CO YEOA forbids minors from operating slicers, meat grinders, commercial mixers; limited fryer/griddle use. Hazardous equipment in a kitchen includes several of these. | C.R.S. §8-12-101 et seq. (YEOA); federal HOs 14-16 (29 CFR 570.50+) | 3 | 5 | **15** | `staff.minor` flag + restricted-station enforcement |
| L6 | **No link between sick-worker report and scheduling.** Even if F5 is wired, a reportable illness must exclude the worker. Nothing stops them from being signed into a station. | FDA 2022 §2-201.12 | 3 | 5 | **15** | Scheduler gate: `/api/staff` filters out employees with active exclusion |
| L7 | **Tip-credit wage notice not surfaced.** CO Wage Theft Transparency Act 2022 + COMPS #39 require written notice of tip credit and minimum-wage math. | C.R.S. §8-4-103; COMPS §3.3 | 3 | 3 | **9** | New `wage_notices` document register + PDF export |
| L8 | **Overtime only inferred from labor summary, not live.** COMPS Order #39 daily OT ≥ 12 h/day *and* weekly OT ≥ 40 h/week — Colorado uses whichever is greater. The current labor_summary uses weekly only. A 13-h event day silently blows the daily-OT line. | 7 CCR 1103-1 §4.1.1 (daily 12 h, workday > 12 h) | 3 | 3 | **9** | Future: shift-time capture is a precondition (dependent on L1) |
| L9 | **No joint-employer / multi-location separation.** `location_id` is schema-wide but labor summary is unified. If Lariat adds a second location under a different EIN, labor calcs commingle. | FLSA joint-employer rule 29 CFR 791; CO commingling | 2 | 3 | **6** | Labor summary shift to per-location (F-class change — defer unless #2 location opens) |
| L10 | **No pay-record retention visible.** CO requires 3 y; FLSA 3 y. Without a place to dump payroll exports, retention happens in Toast/payroll provider only. Fine operationally; note as reference. | C.R.S. §8-4-103(4.5); 29 CFR 516.5 | 2 | 2 | **4** | Out-of-scope for this app; documented in runbook |

### 2.3 Auth / integrity gaps

| # | Finding | L | I | R | State |
|---|---|---|---|---|---|
| A1 | **Temp / cooling / signoff rows are append-only by convention but not tamper-evident.** No hash chain, no inspector-ready cryptographic audit. | 2 | 3 | **6** | Add `audit_events` with `prev_hash` chain, write-through from gated routes |
| A2 | **PIN cookie is a naked `lariat_pin_ok=1`**, not signed. `middleware.js` trusts the value. | 3 | 3 | **9** | HMAC-sign the cookie value with `LARIAT_PIN_SECRET`; middleware validates |
| A3 | **Sick-worker reports have no read-gate.** If added naively, any cook could read other employees' illness attestations — HIPAA doesn't apply to employer food-code reporting but CO privacy torts do. | 3 | 4 | **12** | Manager-PIN gate on GET, never expose in cook-side APIs |

---

## 3. Hardening plan (mapped to code)

Every change is **additive** — no existing table is mutated in-place (honoring `AGENTS.md` rule #5: schema changes require a migration). New files only, except for two extension points (`/api/signoff` gate, `scripts/export.mjs`) which are additive.

### 3.1 Schema — new tables in `lib/db.ts`

All added as `CREATE TABLE IF NOT EXISTS` inside `initSchema()` so existing databases gain them on next boot. Row-type interfaces exported for TypeScript callers.

| Table | Drives gap |
|---|---|
| `cooling_log` | F1 |
| `receiving_log` | F3 |
| `sanitizer_checks` | F4 |
| `sick_worker_reports` | F5, L6 |
| `shift_pic` | F6 |
| `cleaning_schedule` + `cleaning_log` | F7 |
| `pest_control_log` | F8 |
| `thermometer_calibrations` | F9 |
| `tphc_entries` | F11 |
| `date_marks` | F2 |
| `sds_registry` | F17 |
| `shift_breaks` | L1 |
| `paid_sick_leave_balances` | L2 |
| `staff_certifications` | L3 |
| `tip_pool_distributions` | L4 |
| `staff_flags` (augments `staff.json`, incl. `minor`, `tipped`) | L5, L4 |
| `wage_notices` | L7 |
| `employee_health_acknowledgments` | F5, F15 |
| `audit_events` | A1 |

### 3.2 Pure logic — new `lib/foodSafetyRules.ts` + `lib/laborRules.ts`

Pure functions, same posture as `tempLog.ts`. Validation and classification only — no I/O.

- `coolingRules.ts`: `classifyCoolingStage(stage1_temp, stage1_elapsed_min, stage2_temp, stage2_elapsed_min) → 'pass' | 'stage1_fail' | 'stage2_fail' | 'bad_input'`; thresholds `STAGE_1_MINUTES = 120`, `STAGE_2_MINUTES = 240`, `STAGE_1_END_F = 70`, `STAGE_2_END_F = 41`.
- `dateMarkRules.ts`: `computeDiscardDate(prep_date, days=7) → ISO`; `isDateMarkExpired(prep_date, now) → boolean`.
- `sanitizerRules.ts`: `classifySanitizer(kind, ppm_or_temp) → 'ok' | 'low' | 'high' | 'invalid'` with chlorine 50–100, quat 200–400, dish-machine hot rinse ≥180 °F, dish-machine chemical rinse ≥120 °F.
- `breakRules.ts`: `classifyShiftBreaks(shift_start, shift_end, meal_entries[], rest_entries[]) → {compliant, violations[]}` per CO COMPS #39.
- `certRules.ts`: `classifyCertStatus(expires_on, today) → 'active' | 'warning_30d' | 'warning_60d' | 'expired'`.

### 3.3 API routes (new)

All use the same PIN gating posture as `/api/temp-log` (today = no PIN; back-date or sensitive read = PIN).

| Route | Methods | Gate |
|---|---|---|
| `/api/food-safety/cooling` | POST, GET | back-date PIN; GET open |
| `/api/food-safety/receiving` | POST, GET | today open; back-date PIN |
| `/api/food-safety/sanitizer` | POST, GET | today open; back-date PIN |
| `/api/food-safety/date-marks` | POST, PATCH, GET | open (every cook writes) |
| `/api/food-safety/sick-report` | POST, GET | **PIN required on both GET and POST** (A3) |
| `/api/food-safety/cleaning` | POST, GET | open |
| `/api/food-safety/pest` | POST, GET | PIN on POST |
| `/api/food-safety/calibration` | POST, GET | open |
| `/api/food-safety/pic` | POST, GET | PIN on POST (only managers attest PIC) |
| `/api/labor/breaks` | POST, GET | open (cooks log own); PIN on edit |
| `/api/labor/certs` | POST, GET, PATCH | PIN on all (manager-only) |
| `/api/labor/sick-leave` | GET, POST | PIN |
| `/api/labor/tips` | POST, GET | PIN |

### 3.4 Signoff gate extension — `/api/signoff`

Before accepting a signoff for a station, also check:

- Any `cooling_log` row for `shift_date` + `station_id` whose elapsed stage exceeded the limit without a corrective action → 409 with list.
- Any `sanitizer_checks` row classified `low` or `high` without a corrective action → 409.
- Any employee on active `sick_worker_reports` (exclusion status) still signed into `line_check_entries.cook_id` for this station → 409.

### 3.5 UI pages (iPad-friendly, UI_COPY_RULES compliant)

One screen per concept. Kitchen vocabulary. Kept shallow (single tap from the new `/food-safety` hub).

- `/food-safety` — hub (Temps, Cool down, Receiving, Sanitizer, Date marks, Sick report, Cleaning)
- `/food-safety/cooling` — product + 2-hr check + 6-hr check
- `/food-safety/receiving` — vendor picker + probe reading + reject button
- `/food-safety/sanitizer` — three-comp sink / dish machine / wiping cloths
- `/food-safety/date-marks` — list of open date-marked items with "pull" action
- `/food-safety/sick-report` — manager-only; Big-6 symptom picklist
- `/food-safety/cleaning` — schedule with tick-to-done
- `/labor` — hub (Breaks, Certs, Tips)
- `/labor/breaks` — cook picker + start/end meal + start/end rest
- `/labor/certs` — table of staff cert status with red/yellow/green

### 3.6 Tests

Under `tests/js/`:

- `test-cooling-rules.mjs`
- `test-date-mark-rules.mjs`
- `test-sanitizer-rules.mjs`
- `test-break-rules.mjs`
- `test-cert-rules.mjs`

All pure-function tests, no DB. Migration smoke test added to `test-schema-migrations.mjs` via a new pending-on-idempotency assertion.

### 3.7 Export

`scripts/export.mjs` extended with four new sheets: **Temps**, **Cooling**, **Receiving**, **Sanitizer**, **Date marks**, **Sick reports (manager only — requires PIN env to emit)**, **Breaks**, **Certs**.

---

## 4. What's out of scope (and why)

- **PII and HR records beyond what's already in `labor_summary.json`.** No SSN/DOB/immigration capture. `staff.minor` is a plain boolean based on DOB kept by the payroll system.
- **Actual scheduling.** Break compliance logs *what happened*, not *what was scheduled*. Scheduling is in Toast/Homebase/etc.; we trust the source.
- **CalOSHA-style heat illness program.** CO doesn't have an indoor-heat rule yet (2024 bill did not pass). If one passes, revisit.
- **Predictive scheduling.** CO has no predictive-scheduling law as of 2026-04-21; some CA/NYC cities do. If Lariat opens in those markets, re-scope L1/L8.

## 5. Retention

| Artifact | Min retention | Where |
|---|---|---|
| Temp logs, cooling, sanitizer, receiving | 90 days (FDA); 1 year (CO local best practice) | `data/lariat.db` + daily xlsx exports |
| Sick worker reports | 2 years (HFWA records adjacent) + until resolution | DB + encrypted export |
| Cert records | Duration of employment + 3 years | DB |
| Break records | 3 years (C.R.S. §8-4-103(4.5)) | DB + monthly payroll export |
| Tip pool records | 3 years (FLSA) | DB + monthly payroll export |

## 6. Next inspection readiness

A CO county health inspector (in practice, Larimer, Denver, or Eagle County inspects most Front Range F&B) will ask for:

1. Current CFPM certificate — surfaced on `/labor/certs` (L3).
2. Employee health policy acknowledgment per employee — `employee_health_acknowledgments` (F5/F15).
3. Temp logs for last 30 days — export covers it.
4. Cooling logs — F1 covers it.
5. Corrective actions taken on failed CCPs — already wired in `line_check_entries.note` and `temp_log.corrective_action`; extended to cooling/sanitizer.
6. Vomit/diarrhea cleanup procedure + kit location — SOP in `docs/SOP_VOMIT_DIARRHEA_CLEANUP.md` (new), kit location recorded in cleaning schedule.
7. Pest-control invoice trail — F8.
8. Allergen awareness — `staff_certifications.allergen_awareness` + recipe flags.

---

## 7. T10 — HACCP temp-log UI + full CCP coverage (bundle E)

Closed the last gap on the existing temp-log subsystem: the rule module and API were already solid, but there was no dedicated UI board and no audit-trail wiring. This landed on branch `haccp-temp-log`.

### What landed

- **Registry expanded to 10 CCPs.** `lib/tempLog.ts` `TempPoints` gained `receiving_frozen` (§3-202.11 — practical ≤ 10°F ceiling to catch surface-thawed deliveries) and `reach_in_cooler` (§3-501.16 — distinct from walk-in since they have different failure modes). Covers the full set the brief asked for: receiving cold/frozen, walk-in + reach-in cold hold, freezer, cook per protein (poultry 165 / ground beef 155 / fish 145), hot hold 140, reheat 165.
- **Aggregate rule function.** New `classifyReadings(readings, { expectAllPoints })` in `lib/tempLog.ts` turns a day's rows into one `PointSummary` per CCP with `status ∈ {green, yellow, red, gray}` and counts for `ok_count`, `corrective_count`, `critical_count`, `invalid_count`. The yellow/red split encodes the FDA distinction between "out-of-range reading with a documented fix" (compliant) and "out-of-range reading with no note of the fix" (inspector red-flag).
- **API extensions.** `/api/temp-log` GET now returns a `summary` array alongside `entries` (opt out with `?summary=0`). POST emits a `postAuditEvent({ entity: 'temp_log', action: 'insert', ... })` on accepted writes — matching the append-only audit pattern used by `/api/sanitizer-check`, `/api/cooling`, `/api/sick-worker`, and `/api/date-marks`. Rejected writes (422 or 400) leave no audit row so the chain stays clean.
- **Board UI.** `/app/food-safety/temp-log/` — server-rendered page.jsx pulls today's rows through `getDb()` directly (not an internal fetch) and hands them to `TempLogBoard.jsx`, a client component. Grid of CCP tiles colored per status, totals chips across the top, entry form with live out-of-range detection that surfaces the corrective-action field as soon as the typed value would fail validation. On 422 the UI flips into `needsNote` mode with a red-bordered note input.
- **Hub tile.** `/app/food-safety/page.jsx` gained a Temp-log tile summarizing the day ("10 CCPs monitored · N corrective · N critical"). Tile colors match the main grid.
- **Sidebar link.** `app/_components/Sidebar.jsx` gained a "Temp log" sub-link under "Food safety" so cooks can jump straight to the board.

### FDA citations per CCP

| Point | CCP | FDA cite |
|---|---|---|
| `receiving_cold` | CCP-1 | §3-202.11 — cold food received ≤ 41°F |
| `receiving_frozen` | CCP-1 | §3-202.11 — frozen food received frozen (practical ≤ 10°F for surface-thaw tolerance) |
| `walk_in_cooler` | CCP-2 | §3-501.16(A)(2) — TCS food cold-hold ≤ 41°F |
| `reach_in_cooler` | CCP-2 | §3-501.16(A)(2) |
| `freezer` | CCP-3 | §3-501.16(A)(1) — frozen storage |
| `cook_poultry` | CCP-4 | §3-401.11(A)(3) — 165°F / 15s min-internal |
| `cook_ground_beef` | CCP-5 | §3-401.11(A)(2) — 155°F / 15s for comminuted meat |
| `cook_fish` | CCP-6 | §3-401.11(A)(1) — 145°F / 15s for fish |
| `hot_hold` | CCP-7 | §3-501.16(A)(1) — hot-hold ≥ 135°F (tightened to 140 by house policy) |
| `reheat` | CCP-9 | §3-403.11(A) — reheat for hot-hold to 165°F / 15s within 2h |

Two-stage cooling (CCP-8) is NOT covered here; it lives in `lib/cooling.ts` + `/food-safety/cooling` because it's a time+temperature check, not a single-reading threshold (F1 in the gap register above).

### Design choices

- **Corrective note required on out-of-range writes (422).** The route returns `needs_corrective_action: true` with a 422 (not 400) so the UI knows the request *can* be resubmitted with a note — the reading itself was valid. No silent accept: a 43°F walk-in reading with no fix recorded is non-compliance, not a log entry.
- **Yellow tile = "inspector-friendly".** An out-of-range reading that carries a corrective note is classified as corrective (yellow), not critical (red). This is the legal distinction FDA wants: inspectors want to see that the kitchen *caught and fixed* drift, not that drift never happened. Red is reserved for drift with no documented fix (or invalid-only days, where the CCP is unverified).
- **Dashboard-only alerting for now.** No SMS paging, no kitchen display screen integration. Hub tile + sidebar dot are the signal; a PIC walking past the screen will see red at a glance. Paging is deferred until there's a real PIC-on-shift model (bundle G's calibrations + bundle F's receiving log will sharpen who owns which alert).
- **Per-protein COOKING_VERIFY via distinct points.** Rather than a single `cooking_verify` point with a `protein` field that the API must switch on, we expose one point per protein (`cook_poultry`, `cook_ground_beef`, `cook_fish`). This keeps `TempPoints` pure data and makes the per-reading audit trail human-readable — an inspector reading the log sees "cook_poultry @ 172°F" without having to cross-reference the MIN_COOKING_TEMPS table.
- **Audit trail best-effort.** `postAuditEvent` is in a try/catch after the insert succeeds. A stranded temp_log row with a missing audit row is a less-bad outcome than refusing a valid cook-side write because the audit chain happened to be offline. Mirrors the sanitizer route's posture.
- **Tests covered in two files.** `tests/js/test-temp-log-rules.mjs` (34 cases) for the new `classifyReadings` aggregator and the CCP coverage invariants. `tests/js/test-temp-log-api.mjs` (14 cases, including blank-reading UI guard pin) for the new GET summary + POST audit-row behavior. Plus the pre-existing `test-temp-log.mjs` (59) and `test-temp-log-route.mjs` (25) — none rewritten, all still pass.

### Open nits — Deferred to Bundle F — **DONE in Bundle F**

Both items below were landed as part of Bundle F so the registry + tile component were touched exactly once:

1. **Protein matrix gaps — DONE.** `cook_pork`, `cook_beef_steak`, and `cook_eggs` now live in `lib/tempLog.ts` `TempPoints`. Pork and beef steak enforce §3-401.11(A)(1) at 145°F (whole-muscle); shell eggs enforce §3-401.11(A)(2) at 155°F, the stricter hot-hold path (immediate-service 145°F is the exception). The registry count went 10 → 13; `tests/js/test-temp-log.mjs` upper bound bumped 12 → 16.
2. **Per-tile FDA citation tooltip — DONE.** Every `TempPoint` grew a `citation` field; `classifyReadings` surfaces it on `PointSummary.citation`; `TempLogBoard.jsx` renders it as a `title="FDA §…"` attribute on both the tile and the CCP badge. Matching treatment applies to the new receiving board tiles, so an inspector hovering any food-safety tile sees the §-cite without docs hunting.

---

## 8. T11 — Receiving log (bundle F / §3-202.11)

Closed the F3 gap: `receiving_log` had the table in `lib/db.ts` but no rule module, no API route, no UI, and no audit wiring. Bundle F lands all four. This landed on branch `haccp-receiving`.

### What landed

- **FDA rule module (new).** `lib/receiving.ts` defines `RECEIVING_CATEGORIES` (`refrigerated`, `frozen`, `shell_eggs`, `hot_held`, `dry_goods`, `produce`, `shellfish`), a `RECEIVING_RULES` table with per-category temp thresholds + drift bands, `validateReceivingReading(...)` returning `{ status: 'ok' | 'accept_with_note' | 'rejected', reason, citation, required_max_f }`, and `classifyDeliveries(...)` for the tile aggregate. Pure functions, no DB coupling.
- **API route (new).** `/api/receiving` (GET + POST). POST runs the rule module; 422s with `needs_corrective_action: true` whenever the decision is non-ok and the cook didn't write a note. The `accepted_with_note` DB status column is mapped through `dbStatusFor` — the library uses `accept_with_note` (present tense), the schema uses the past-tense form from the pre-existing DDL. GET groups by vendor, returns per-category tiles, and exposes the rule registry for the UI.
- **Schema migration.** `receiving_log` gained `package_ok INTEGER` (§3-202.15) and `expiration_date TEXT` (§3-101.11) columns. Both NULLable; pre-F rows stay NULL. The CREATE TABLE DDL was updated for fresh databases and a conditional `ALTER TABLE ... ADD COLUMN` migration was added to `migrateLegacyColumns` for in-place upgrades.
- **UI board (new).** `/app/food-safety/receiving/` — server-rendered `page.jsx` + client `ReceivingBoard.jsx`. Tile grid per category, totals chips across the top (`N clean categories · N accept-with-note · N with rejects`) and per-line counts (`N accepted · N with note · N rejected`). The entry form does live validation against the rule module's drift bands: typing a 43°F reading for a refrigerated line surfaces the corrective-action field inline, typing 50°F red-borders the reading input AND the note field (rejection path). Package-intact checkbox defaults true; unchecking it forces rejection per §3-202.15.
- **Hub tile.** `/app/food-safety/page.jsx` gained a Receiving tile showing today's deliveries / accepts-with-note / rejections. Red if anything rejected, amber if any accept-with-note.
- **Sidebar link.** `app/_components/Sidebar.jsx` has "Receiving" under "Food safety".
- **Bundle-E nits landed here.** Protein matrix gaps filled, per-tile §-tooltip wired — see "Open nits — Deferred to Bundle F — DONE" above.

### FDA citations per RECEIVING_CATEGORY

| Category | Required temp | Drift band | Reject at | FDA cite |
|---|---|---|---|---|
| `refrigerated` | ≤ 41°F | 41–45°F (accept_with_note) | > 45°F | §3-202.11(B) / §3-501.16(A)(2) |
| `frozen` | ≤ 10°F practical | 10–25°F (accept_with_note) | > 25°F | §3-202.11(C) |
| `shell_eggs` | ≤ 45°F | 45–50°F (accept_with_note) | > 50°F | §3-202.11(A) |
| `hot_held` | ≥ 135°F | 130–135°F (accept_with_note) | < 130°F | §3-202.11(D) / §3-501.16(A)(1) |
| `shellfish` | ≤ 45°F | 45–50°F (accept_with_note) | > 50°F | §3-202.11(F) / §3-203.12 tag |
| `dry_goods` | — (no temp CCP) | — | package compromise → reject | §3-202.15 / §3-101.11 |
| `produce` | — (no temp CCP) | — | package compromise → reject | §3-202.15 / §3-202.110 |

Cross-cutting rules (apply to every category):
- **§3-202.15** — package integrity. `package_ok=false` is an unconditional rejection, temperature ignored.
- **§3-101.11** — past-date food is adulterated. `expiration_date < shift_date` rejects; same-day is accepted (the sell-by covers the full day).

### Design choices

- **`rejected` vs `accept_with_note` split.** The FDA writes one threshold; reality has a drift band between the written limit and the practical impossibility-of-pulldown temperature. `accept_with_note` encodes that drift band: a cook can take a 43°F delivery and document a rapid pull-down (within the four-hour product-spoilage envelope) and stay compliant. `rejected` is the unconditional "no" — either past the drift ceiling, package compromised, or sell-by expired. Both statuses require a written note to be saved; the difference is what the note's for (corrective fix vs rejection reason for vendor callback).
- **Drift bands are FDA-conservative where they exist.** 45°F for refrigerated is the practical cliff — many Colorado jurisdictions cite it as the "must reject" line even though §3-501.16 strictly reads 41°F. 25°F for frozen is the "visibly thawed" cliff. Drift bands come from public-health literature, not cook convenience; the rule module is deliberately stricter than "vendor label says 50°F is fine."
- **`package_ok=false` → always rejected.** A compromised case cannot be saved by a good temperature (§3-202.15 is unambiguous). The rule module enforces this before the temp check even runs. The UI's default is `packageOk=true` so a cook isn't forced to check the box for every dry-goods line.
- **`expiration_date` is optional.** Many cases don't print a sell-by that the receiving cook can see without opening them. When provided and past, the line rejects per §3-101.11. When absent, the path is skipped — we do NOT synthesize a "no date means expired" policy.
- **`dry_goods` and `produce` skip the temp check entirely.** `requires_reading: false` on the rule. A reading may still be entered and is stored, but it's informational — the decision is package + sell-by only.
- **Category schema is TEXT with a known-set enum in the module.** The DB column is TEXT so future categories land without a DDL migration; the rule module is the single-source validator. Unknown categories fall through to `accept_with_note` (not `rejected`) so a new vendor SKU is always loggable — rejecting on an unknown category would make the board unusable during a new-vendor onboarding.
- **`rejection_reason` column doubles as the corrective-action note.** The pre-existing column was named `rejection_reason`; Bundle F reuses it for the `accept_with_note` path rather than adding a second free-text column. Both cases are the same audit artifact: "why was this not a clean accept?" — the UI surfaces it as "corrective action / rejection reason" so the cook sees the right framing.
- **Audit trail best-effort.** `postAuditEvent` is in try/catch after the insert commits — a stranded receiving_log row with a missing audit row is less-bad than refusing a valid delivery because the audit chain blipped. Mirrors temp-log/sanitizer.
- **Tests covered in two files.** `tests/js/test-receiving-rules.mjs` (44 cases) for the rule module incl. boundary cases on every category, drift bands, package_ok=false, expiration handling, unknown-category fallback. `tests/js/test-receiving-api.mjs` (22 cases) for route-level: 422 behavior, audit row emission, GET summary shape, vendor grouping, location scoping.

---

## 9. T12 — Thermometer calibrations (bundle G / §4-502.11)

Closed the F9 gap: `thermometer_calibrations` had the DDL scaffolded in
`lib/db.ts` but no rule module, no API route, no UI, and no hook into
the temp-log. Bundle G lands all of it plus an advisory-warning link
from temp-log writes to probe calibration state. Landed on branch
`haccp-calibrations`.

### What landed

- **FDA rule module (new).** `lib/calibrations.ts` exports
  `CALIBRATION_METHODS` (`ice_point` + `boiling_point`), `TOLERANCE_F = 2`,
  `LARIAT_ELEVATION_FT = 7800`, `boilingPointF(elev)`,
  `validateCalibrationReading(...)` → `{ status: 'pass' | 'fail', expected_f,
  deviation_f, elevation_ft, citation, reason }`, `classifyProbes(rows, opts)`
  for the per-probe tile aggregate, and `calibrationWarningFor(summary)`
  — the helper the temp-log route calls to decide whether to surface a
  warning. Pure functions, no DB.
- **API route (new).** `/api/thermometer-calibrations` (GET + POST).
  POST always 200s on valid input and persists BOTH pass and fail
  rows; 400s only on bad-input (missing probe id, unknown method,
  non-numeric reading, oversized note). GET returns per-probe summary
  + optional `?probe_id=` filter + config (`tolerance_f`,
  `default_elevation_ft`, `default_frequency_days`).
- **Schema migration.** `temp_log` gained an optional `probe_id TEXT`
  column via idempotent `ALTER TABLE ADD COLUMN`. Pre-G rows stay NULL.
  The `thermometer_calibrations` table DDL was already scaffolded; no
  schema change needed there beyond wiring the route and rule module.
- **UI board (new).** `/app/food-safety/calibrations/` — server
  `page.jsx` + client `CalibrationsBoard.jsx`. One tile per probe,
  colored by status (green=ok, yellow=due_soon, red=overdue/failed,
  gray=unknown). Quick-entry form previews the altitude-corrected
  expected reading before submit; `tl-live-green`/`tl-live-red`
  classes tint the reading input based on whether the typed value
  would pass.
- **Temp-log integration.** `/api/temp-log` POST accepts an optional
  `probe_id` in the body. When present, the route looks up the
  probe's calibration state and attaches a `calibration_warning`
  string to the response if the probe is unknown, failed, or overdue.
  **The write is NEVER rejected on this** — advisory posture, not a
  hard gate. The audit row's `note` field gains a
  `calibration_warning:<probe>` suffix so inspectors can find every
  reading taken with an uncalibrated probe.
- **Hub tile.** `/app/food-safety/page.jsx` gained a Calibrations
  tile showing probes tracked / due-soon / overdue+failed. Red if
  any overdue or failed, amber if any due_soon.
- **Sidebar link.** `app/_components/Sidebar.jsx` has "Calibrations"
  under "Food safety", after "Receiving".

### FDA §4-502.11 thresholds

- **Tolerance:** ±2°F / ±1°C. Inclusive both ends — a reading exactly
  2°F off target is a pass.
- **Methods:** ice-point (probe in 50/50 crushed-ice-and-water slurry,
  target 32°F) and boiling-point (probe in vigorously boiling water,
  target is **altitude-dependent** — see below). Reference-probe
  calibration exists in the DDL's CHECK constraint for future use but
  is out of scope for the Bundle G rule module.

### Altitude correction (critical for Lariat)

Water's boiling point drops by roughly **1°F per 550 ft** of elevation
gain. The linear form is:

```
boiling_point_f(elev_ft) = 212 − (elev_ft / 550)
```

Lariat sits at ~7,800 ft in Buena Vista, CO — so water boils at about
**197.8°F**, NOT 212°F. A probe that reads 212°F in Lariat's boiling
water is **14°F high** and fails §4-502.11 badly. This has been a
genuine trap for operators who trust a sea-level SOP taped above the
calibration station — the rule module has the correction baked in,
and the UI surfaces the adjusted target as part of the entry form
(see `CalibrationsBoard.jsx` `expectedFor(method, elev)`).

`LARIAT_ELEVATION_FT` is exported from `lib/calibrations.ts` as a
named constant. If the deployment moves (or a second location opens),
the path forward is a per-location `locations.elevation_ft` column;
until then a single constant is the simpler seam.

### Probe registry approach (inline vs separate table)

**Choice: (a) inline `probe_id` strings.** `thermometer_calibrations`
has `thermometer_id TEXT` keyed by operator-supplied names like
`probe-1`, `IR-gun-A`. No separate `probes` table.

- **Why:** the brief called for something operators can start
  recording today without a metadata onboarding step. Ad-hoc probe
  IDs match how kitchens actually tag probes in the wild (masking tape
  on the handle, sharpie number). A separate table would trade
  richer metadata for a mandatory-registration step nobody wants.
- **What we lose:** no probe `type` (bi-metal / digital / IR /
  thermocouple), no `owner`, no `purchased_at`. If operators start
  wanting per-type frequency overrides or cost tracking, bundle H can
  add a `probes` table keyed by `probe_id` and left-join it into the
  summary. The `frequency_days` override on `thermometer_calibrations`
  already accommodates per-probe variance in the meantime.
- **Schema hook for future metadata:** a new `probes` table can
  enrich the summary via LEFT JOIN without touching the
  `thermometer_calibrations` rows — existing calibrations stay
  valid, and probes without a registry entry still tile out.

### Design choice: persist pass AND fail

Unlike `/api/temp-log` and `/api/receiving`, which 422 on a breach
without a corrective note, `/api/thermometer-calibrations` **always
persists both pass and fail outcomes** on valid input. Rationale:

- A failing calibration **IS** the truth being recorded. The operator
  discovered the probe drifted and documented it — refusing the row
  would force them to re-type the breach they already caught.
- The audit trail is strictly richer with fails recorded. An
  inspector looking at a 42°F walk-in reading later can find the
  probe's preceding ice-point fail and the retire-and-replace note
  that followed. Dropping the fail would hide that the operator
  caught the drift before it compounded.
- The UI's advisory posture reinforces this: the tile for a failed
  probe goes red ("flagged — unreliable until a passing calibration
  is logged"), and the temp-log integration surfaces a
  `calibration_warning` on subsequent reads using the same probe.

### Integration hook: temp-log writes warn on uncalibrated probes

`/api/temp-log` accepts an optional `probe_id`. When present, the
route checks `thermometer_calibrations` for that probe and uses
`calibrationWarningFor(summary)` to decide whether to attach a
`calibration_warning` string. The checks that fire a warning:

| Condition | Warning text (abbreviated) |
|---|---|
| No calibration row for the probe | "probe X has no calibration on record — log an ice-point or boiling-point calibration before using it for a CCP reading" |
| Most-recent row is a fail | "probe X failed its last calibration on Y — recalibrate before using it for a CCP reading" |
| Last pass is past next_due_at | "probe X is overdue for calibration (last: Y, due: Z) — recalibrate" |
| Last pass, within 7 days of next_due | **no warning** — that's a board-level signal only |
| Last pass, well within frequency window | no warning |

**The write is never rejected by this check.** Bad probe + good food
is a compliance gap, not a reason to refuse the reading. The cook
needs the reading on the log; the inspector needs the probe flag on
the same row. The audit note gains `calibration_warning:<probe>` so a
later query can find every reading taken under the advisory.

### Tests

- `tests/js/test-calibrations-rules.mjs` (52 cases): §4-502.11
  constants, altitude math (0 ft / 7800 ft / 550 ft linearity / bad
  input fallback), pass/fail per method (incl. the 212°F-at-altitude
  fail case called out in the brief), `classifyProbes` status
  transitions (empty → unknown → ok / due_soon / overdue / failed,
  per-probe frequency override, fail-then-pass flip, sort order,
  orphan thermometer_id ignored), `calibrationWarningFor` outputs.
- `tests/js/test-calibrations-api.mjs` (24 cases before G-fix): POST pass/fail
  both 200, 400 validation paths, audit note emission, GET summary,
  `?probe_id=` filter, most-recent-fail precedence, temp-log
  integration (probe_id round-trips, calibration_warning fires for
  unknown/failed/overdue, omitted probe_id leaves warning null, audit
  row carries `calibration_warning:<probe>`).
- **G-fix (2026-04-21):** Added `frequency_days` column + migration +
  route passthrough. Test suite grows by 7 cases (frequency_days
  persists, 14-day probe overdue at day 15, 30-day default probe ok at
  day 15, 400 on zero/negative/float, NULL when omitted). Total API
  cases: 31.
- Bundle E regression (`test:temp-log-api`) stays at 14 cases; the
  `calibration_warning` field is additive to the response and defaults
  to null when `probe_id` is absent.

### Deferred hardening — cross-bundle atomicity (not in Bundle G)

POST insert + audit emission are not wrapped in a database transaction
across the following routes: `/api/temp-log`, `/api/receiving`,
`/api/thermometer-calibrations`, and likely `/api/cooling`,
`/api/sanitizer-checks`, `/api/sick-worker-reports`. A crash between
the INSERT and the `postAuditEvent` call leaves a row with no audit
trail.

**Corrective action (deferred to a cross-bundle cleanup):**
Wrap each HACCP POST in `db.transaction(() => { insert; audit; })` so
both land or neither does. The current best-effort posture (audit in a
try/catch after insert) is acceptable for the initial hardening pass but
should be tightened before the system handles real inspector reviews.

---

*Change control: this document is the source of truth for the 2026-04-21 hardening pass. Any deviation during implementation is called out in the PR description.*
