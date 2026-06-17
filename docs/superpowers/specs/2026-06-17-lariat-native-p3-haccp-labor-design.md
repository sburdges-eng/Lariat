# Lariat Native — P3: HACCP + labor (design)

**Date:** 2026-06-17
**Phase:** P3 (first heavy regulated write phase — rule engine + 422 gates + audit transactionality)
**Builds on:** P2b cook `AuditedWrite` (#350), P1b `PinVerifier` / `LariatWriteDatabase`, P2 cook-tier umbrella
**Ladder origin:** `docs/superpowers/specs/2026-06-16-lariat-native-rewrite-p0-design.md` §2
**Predecessors:**
- `docs/superpowers/specs/2026-06-17-lariat-native-p2-cook-tier-design.md`
- `docs/plans/2026-06-17-004-feat-lariat-native-p3-haccp-labor-plan.md` (implementation plan — P3a `/ce-work` targets U1–U4 only)

## 0. Why P3 is split like P1 and P2

P0–P2 established read-only manager surfaces, then PIN-gated manager writes, then cook-tier
reads and the first cook `AuditedWrite` on 86 (no `RuleGate`). P3 is where **`InvariantContracts.RuleGate`**
stops being a stub comment and the **`needs_corrective_action` 422 contract** lands on native.

Food-safety and labor mutations have **binding rule engines** in `lib/*.ts` and hardened API routes
(documented in `docs/HEALTH_SAFETY_LABOR_AUDIT.md`). Porting them all at once would produce an
unreviewable PR and blur failure modes (422 vs 400 vs 409 vs PIN). P3 is therefore split:

| Sub-phase | Focus | Proves |
|-----------|--------|--------|
| **P3a** | Temp log board + Safety hub shell | `RuleGate`, corrective-note UX, `haccp.back_date` temp-PIN |
| **P3b** | Date marks, thermometer calibrations | Audited writes without 422 (400/409 only) |
| **P3c** | Cleaning ticks, labor breaks | 409 conflicts, waiver refs, COMPS read |

Each sub-phase is an independent spec → plan batch → build → PR. **This doc is the umbrella**;
the first `/ce-work` batch implements **P3a U1–U4 only** (see plan §Execution shape).

## 1. Goal / success criteria (full P3)

A cook or manager on **iPad or Mac** can run native **food-safety and labor boards** against live
`lariat.db` with behavior matching the web `/food-safety` hub and `/labor` surfaces:

1. **Temp log** — per-point tiles; out-of-range readings require corrective note before write;
   back-dated entries require PIN when `LARIAT_PIN` is set (`haccp.back_date` scope).
2. **Date marks** — create with computed `discard_on`; discard with reason enum; 409 on double discard.
3. **Thermometer calibrations** — pass **and** fail readings persist; altitude-aware targets.
4. **Cleaning** — tick against schedule; validation errors are 400 only (no 422 path).
5. **Breaks** — start meal/rest; 409 if open break; end with duration; waived meal requires `waiver_ref`.

Success when:

1. Rule classification and gate outcomes match web fixture vectors (`npm run test:rules` parity bar).
2. Every mutation uses **one GRDB transaction** — source row + `audit_events`; audit failure rolls back
   (stricter than web warn-only).
3. `RuleGate` failures produce **zero DB rows** (mirror `tests/js/test-temp-log-api.mjs`).
4. Cross-process WAL: web write visible to native within one 3 s poll.
5. `swift test` green; UI copy per `docs/UI_COPY_RULES.md`.

## 2. Scope

### In scope (by sub-phase)

| Sub-phase | Surfaces | Native modules |
|-----------|----------|----------------|
| **P3a** | Temp log board, top-level **Safety** sidebar hub | `RuleGate`, `TempPinVerifier`, `TempLogCompute` (full), `TempLogRepository`, `TempLogView` |
| **P3b** | Date marks, calibrations | `DateMarkCompute`, `ProbeCompute` expand, repos + views |
| **P3c** | Cleaning, breaks | `CleaningCompute`, `BreakCompute`, repos + views |

### Out of scope (YAGNI — defer P3d+)

- Cooling multi-stage, receiving, sanitizer, sick-worker, corrective-actions feed UI
- `syncFeed` writes (web appends on temp-log POST; native skips until P6 — **intentional**)
- P2c station line checks, P2d KDS punch (separate PR cycles; may reuse `RuleGate` patterns)
- Schema migrations; weakening HACCP thresholds; web route rewrites
- Full i18n beyond existing English kitchen copy ports

### Outside identity

Native **never migrates** `lariat.db`. Web remains schema owner.

## 3. Platform & navigation

- **Safety hub** is a **top-level sidebar section** (not nested under Cook) — matches web
  `/food-safety` prominence (plan KTD8, resolved).
- **Labor breaks** live under Safety hub (web `/labor/breaks` linked from food-safety hub).
- iPad-first layouts; Mac supported for dev/smoke.
- **Polling refresh** (3 s) — same cross-process correction as P1a/P2; no `ValueObservation`.

## 4. Web source map

| Surface | Web entry | Key libs | API route |
|---------|-----------|----------|-----------|
| **Temp log** | `app/food-safety/temp-log/TempLogBoard.jsx` | `lib/tempLog.ts`, `lib/pin.ts`, `lib/tempPin.ts` | `app/api/temp-log/route.js` |
| **Date marks** | `app/food-safety/date-marks/` | `lib/dateMarks.ts` | `app/api/date-marks/route.js` |
| **Calibrations** | `app/food-safety/calibrations/` | `lib/calibrations.ts`, `lib/probes.ts` | `app/api/thermometer-calibrations/route.js` |
| **Cleaning** | `app/food-safety/cleaning/` | `lib/cleaning.ts` | `app/api/cleaning/route.ts` |
| **Breaks** | `app/labor/breaks/` | `lib/breaks.ts` | `app/api/breaks/route.js` |

**Parity test refs:** `tests/js/test-temp-log-api.mjs`, `test-temp-log-rules.mjs`,
`test-haccp-audit-atomicity.mjs`, `test-date-marks-api.mjs`, `test-calibrations-api.mjs`,
`test-cleaning-api.mjs`, `test-breaks-api.mjs`.

## 5. Architecture — extend LariatNative (no new SwiftPM module)

### 5.1 Validation layering (load-bearing)

Order matches web route handlers:

```
UI → ViewModel → RuleGate.validate() → PinGate (if back-date / manager scope) → AuditedWriteRunner → DB
```

| Layer | When | On failure |
|-------|------|------------|
| **RuleGate** | Before txn | `RuleGateError.needsCorrectiveAction` → inline note UI; **no write** |
| **PinGate** | Before txn (scoped) | `PinGateError` → PIN sheet; **no write** |
| **Field validation** | Before txn | `validationFailed` → banner; **no write** |
| **Conflict check** | Inside or before txn | `conflict` (409) → actionable copy; **no write** |
| **AuditedWrite** | Txn | Source + `audit_events` atomic |

`RuleGate` and `PinGate` run **outside** `AuditedWriteRunner.perform` so partial state never lands.

### 5.2 `RuleGate` contract (P3a)

Port of web `validateTempReading` semantics (`lib/tempLog.ts`):

- Empty / non-numeric reading → **validation failed** (not `0°F` false positive).
- Reading outside absolute sanity range (`-100`…`500°F`) → validation failed ("check the probe").
- In-range → pass silently; corrective note optional.
- Out-of-range without non-empty trimmed note → **`needsCorrectiveAction`** (422 contract).
- Out-of-range with note → pass; classification may be yellow/corrective on tile.
- Corrective note **max 500 chars** — reject overlong, do not truncate.

Native maps `needsCorrectiveAction` to `WriteErrorMapper` kitchen copy and inline note expansion
(mirror `TempLogBoard.jsx`).

### 5.3 Temp-PIN scope (P3a)

`PinVerifier` (P1b) checks manager PIN / `LARIAT_PIN` override. **Back-dated temp logs** also
accept **temp PINs** with scope `haccp.back_date` — port `hasPinOrTempPin` from `lib/pin.ts` +
`lib/tempPin.ts` as **`TempPinVerifier`**:

- Master PIN **or** active `temp_pins` row matching scope
- When `shift_date != todayISO()` and PIN env is configured → PinGate before write

### 5.4 `LariatModel`

| Addition | Role |
|----------|------|
| `RuleGateError.swift` | Typed gate failures (`needsCorrectiveAction`, `validationFailed`, `conflict`, …) |
| `TempPinVerifier.swift` | Scope-aware PIN check for HACCP back-date |
| `Compute/TempLogCompute.swift` | **Greenfield expand** — full `TempPoints`, `validateTempReading`, `classifyReading`, `entryFromReading` (existing file is breach-count only for Command) |
| `Compute/DateMarkCompute.swift` | Expand for P3b |
| `Compute/ProbeCompute.swift` | Expand for P3b calibrations |
| `Compute/CleaningCompute.swift` | New P3c |
| `Compute/BreakCompute.swift` | New P3c |
| `WriteErrorMapper.swift` | Branches for corrective action, open break, already discarded |

**Compute-first:** thresholds and classifiers live in `Compute/` only — UI never embeds limits.

### 5.5 `LariatDB`

| Repository | Write pattern |
|------------|---------------|
| `TempLogRepository` | RuleGate → PinGate → INSERT `temp_log` + audit |
| `DateMarkRepository` | INSERT/PATCH + audit (P3b) |
| `CalibrationRepository` | INSERT + audit; fail readings persist (P3b) |
| `CleaningRepository` | INSERT `cleaning_log` + audit (P3c) |
| `BreakRepository` | start/end/waive + audit (P3c) |

Reuse P2b patterns:

- `RegulatedWriteContext.nativeCook()` for cook-tier writes
- `AuditEventWriter.encodePayload` for full-row resolve-style payloads
- `LocationScope.resolve()` + IDOR guards on PATCH (404 semantics, not 403)

### 5.6 `LariatApp`

**P3a ships:**

- `FoodSafetyHubView` — tile grid linking temp log (and stub tiles for P3b/c)
- `TempLogView` / `TempLogViewModel` — point grid, corrective note sheet, calibration warning banner
- `LariatApp.swift` — **Safety** sidebar section

**P3b/c add** `DateMarkView`, `CalibrationsView`, `CleaningView`, `BreakBoardView`.

## 6. Write / audit contracts

| Mutation | Tables | Audit entity | Special |
|----------|--------|--------------|---------|
| Temp reading | `temp_log` INSERT | `temp_log` / `insert` | `note: out_of_range:<point>` when applicable; snapshot limits on row |
| Date mark create | `date_marks` INSERT | `date_marks` / `insert` | `discard_on` computed |
| Date mark discard | `date_marks` UPDATE | `date_marks` / `update` | 409 if already discarded |
| Calibration | `thermometer_calibrations` INSERT | audit | fail rows **persist** |
| Cleaning tick | `cleaning_log` INSERT | audit | 400 validation only |
| Break start/end | `breaks` INSERT/UPDATE | audit | 409 open break |

**syncFeed:** web temp-log route appends feed rows; native **skips** until P6 (document in README).

## 7. Error taxonomy (native UX)

| Error | Cook-facing UX | DB write |
|-------|----------------|----------|
| `needsCorrectiveAction` | Inline note field expands | None |
| `pinRequired` | PIN sheet (`haccp.back_date`) | None |
| `validationFailed` | Short banner (empty reading, note too long, bad probe) | None |
| `conflict` (409) | Actionable copy (open break, already discarded) | None |
| `calibrationWarning` | Advisory banner; **write proceeds** after acknowledgment | Yes |

## 8. Testing strategy

### P3a (before merge)

| Layer | Tests |
|-------|-------|
| `RuleGateError`, `TempPinVerifier`, `WriteErrorMapper` | Pure unit — no GRDB |
| `TempLogCompute` | Fixture vectors from `test-temp-log-rules.mjs` |
| `TempLogRepository` | In-memory DB; atomicity mirror `test-haccp-audit-atomicity.mjs`; zero-row on 422 |
| UI | iPad simulator smoke — tile colors match web for fixture DB |

### P3b/c

Same pattern: compute unit tests → repository fixture tests → manual hub smoke.

**CI bar:** `cd LariatNative && swift test` + existing `npm run test:rules` on web unchanged.

## 9. Dependencies & prerequisites

| Prerequisite | Status |
|--------------|--------|
| P2b `nativeCook` + `AuditedWriteRunner` | PR #350 |
| P1b `PinVerifier`, `LariatWriteDatabase` | Merged (#343) |
| P3 plan doc | `docs/plans/2026-06-17-004-feat-lariat-native-p3-haccp-labor-plan.md` |
| **This design spec** | Required before P3a `/ce-work` |

If P2b is not merged when P3a starts, duplicate the minimal `RegulatedWriteContext.nativeCook` slice
in P3a — prefer waiting for #350 merge.

## 10. Risks

| Risk | Mitigation |
|------|------------|
| `TempLogCompute` drift from `lib/tempLog.ts` | Shared fixture vectors; expand existing file rather than fork |
| PIN scope confusion | `TempPinVerifier` per route scope; manager PIN via existing `PinVerifier` |
| P3 scope creep (cooling/receiving) | Explicit §2 deferral; hub stubs for out-of-scope tiles |
| 422 UX complexity | P3a establishes one inline-note pattern reused in later surfaces |
| Audit payload shape | Reuse P2b `payloadJSON` / `encodePayload` path |

## 11. Cutover model

Shared `lariat.db` lets cooks log temps natively while web `/food-safety` remains available.
Command food-safety summary (red breach count) already reads `temp_log` via P1a — native writes
appear on manager Command within poll. Web routes stay until each sub-phase flips.

## 12. P3a implementation checklist (for `/ce-work`)

1. **U1** — `RuleGateError`, `TempPinVerifier`, `WriteErrorMapper` branches
2. **U2** — `TempLogCompute` full port + unit tests
3. **U3** — `TempLogRepository` + fixture tests
4. **U4** — `FoodSafetyHubView`, `TempLogView`, Safety sidebar wiring

Do **not** implement U5–U9 in the same batch.
