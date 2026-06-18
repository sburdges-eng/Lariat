# Lariat Native — P2b: 86 board writes (design)

**Date:** 2026-06-17  
**Phase:** P2b (first cook-tier `audit_events` write)  
**Status:** Shipped on `main` via [#350](https://github.com/sburdges-eng/Lariat/pull/350). Follow-ons: P2c [#355](https://github.com/sburdges-eng/Lariat/pull/355), P2d [#357](https://github.com/sburdges-eng/Lariat/pull/357).  
**Umbrella:** `docs/superpowers/specs/2026-06-17-lariat-native-p2-cook-tier-design.md`  
**Plan:** `docs/plans/2026-06-17-003-feat-lariat-native-p2b-86-board-plan.md`

## Planning questionnaire (answered)

### Q1 — What problem does P2b solve?

Cooks ran Today (P2a) natively but still needed a browser for `/v2/eighty-six` to mark items out or back.
Command reads `eighty_six` as thin projections; P2b closed the **operational write loop** with regulated
`audit_events` — the first cook-tier `AuditedWrite` before P2c line checks and P2d KDS punch shipped.

**Success:** A cook on iPad can add/resolve 86 rows against shared `lariat.db`; web Command open-86 count
and cascade chips stay consistent within one 3 s poll.

### Q2 — What is in scope?

| In | Out |
|----|-----|
| 86 list (open + last 50 resolved today) | Station line checks (P2c) |
| Add + resolve with audited writes | KDS punch (P2d) |
| Cascade **display** + confirm-add dependent item | 86-on-fail from checklist (P2c optional) |
| Cook identity + staff picker | `RuleGate` / corrective-action 422 (P3) |
| Cook nav enable + Today → 86 deep link | HTTP `withIdempotency` / `idempotency_keys` |
| Repository tests parity with `test-eighty-six-api.mjs` | `syncFeed` (P6) |

### Q3 — How do we know it worked?

- `swift test` green; `EightySixRepositoryTests` mirrors web API cases (add, resolve, 409, IDOR).
- Fixture SQL seeded from the **same row shapes** as `tests/js/test-eighty-six-api.mjs` (CI-enforced parity).
- Manual smoke: web add → native board within one poll; native resolve → Command count drops within poll.
- Financial-acid semantics: INSERT/UPDATE + `audit_events` share one GRDB transaction (rollback on audit failure).

### Q4 — Technical approach

**Write foundation before UI (U1 first):**

1. Broaden `AuditEventInput` — `payloadJSON` via `AuditEventWriter.encodePayload(Encodable)` for resolve
   full-row snapshots; partial `[String:String]` on insert (web POST parity).
2. `RegulatedWriteContext.nativeCook(cookId:locationId:shiftDate:)` — `actor_source = native_cook`.
3. `EightySixRepository` — read via `LariatDatabase`; writes via `AuditedWriteRunner` + `LariatWriteDatabase`.
4. **No `RuleGate` in P2b** — 86 has no `needs_corrective_action` contract; defer `RuleGateError` +
   `WriteErrorMapper` branch to **P3a temp-log** (first RuleGate consumer).

**IDOR port (`resolve/route.ts`):**

Inside a single transaction:

1. `SELECT * FROM eighty_six WHERE id = ?`
2. Missing row → `EightySixWriteError.notFound` (404 semantics)
3. `existing.location_id != context.locationId` → **same** `notFound` (no existence leak)
4. `resolved_at` set → `alreadyResolved` (409)
5. `UPDATE` + `postAuditEvent` with `note=resolved`, full row `payloadJSON`

Native is **stricter than web** on add: `location_id` always from `LocationScope.resolve()`, never body-asserted.

### Q5 — Cook identity, `actor_source`, and cascade scope

**Cook identity**

| Concern | Decision |
|---------|----------|
| Storage | `UserDefaults` key `lariat_cook` (web `localStorage.lariat_cook`) |
| Picker source | `data/cache/staff.json` via `StaffCatalog` — active, displayable rows only |
| Fallback | Missing `staff.json` → free-text or skip; writes allowed with `cook_id = null` |
| When required | Prompt on first write; skip path matches web |
| Audit attribution | `actor_cook_id` on `audit_events` = selected cook; `eighty_six.cook_id` on add |

**`actor_source`**

| Tier | Value | Used for |
|------|-------|----------|
| Cook native | `native_cook` | 86, line checks (P2c), temp log (P3a), cleaning/breaks (P3c) |
| Manager native | `native_mac` | Pack-size ack, performance reviews (P1b) |
| Web API | `api` / `cook_ui` | Browser routes |

All P2b audited rows use `native_cook` so Command/audit queries can filter native vs web writers.

**Cascade scope (P2b)**

- **Read path:** `SubRecipeCascadeCompute.cascadedFromEightySix(activeItems, recipes)` — same graph as P2a/Today.
- **Write path:** Cascade is **advisory UI only** in P2b — confirming a chip calls normal `add()` with
  `reason: prep_short`; no automatic multi-row insert, no silent 86 of sub-recipes.
- **Recipe source:** Bundled/read `recipes.json` via `StationCatalog` (same as web `getRecipes()`).
- **Out of scope:** Auto-86 on line-check fail (P2c optional coupling); Toast POS ingest.

### Q7 — Testing and parity strategy

**Wire integration tests early (before UI ship):**

| Layer | Bar |
|-------|-----|
| U1 | `AuditEventWriterTests` — payload JSON round-trip, outside-txn throw, rollback |
| U3 | `EightySixRepositoryTests` — fixture DB with SQL aligned to `test-eighty-six-api.mjs` seeds |
| CI | `swift test` required gate; no manual iPad smoke as sole parity proof |

**Fixture discipline:** When adding a repository test, copy the **INSERT shapes** from the matching
`tests/js/test-*.mjs` file (or extract shared seed doc). P3a should seed from `test-temp-log-api.mjs`
before any `TempLogRepository` UI.

**P3a addendum:** Port `lib/tempLog.ts` `validateTempReading` / `classifyReading` to Swift pure functions
with boundary tests **before** first GRDB write — same pattern as P2b compute-first.

### Q9 — Explicit deferrals (scope creep guard)

| Item | Phase | Notes |
|------|-------|-------|
| `syncFeed` append on temp log | P6+ | Web writes feed; native skips intentionally |
| HTTP `withIdempotency` / `idempotency_keys` | P2d+ / when replay needed | Native uses in-flight UI guard only in P2b |
| Cooling, receiving, sanitizer, sick-worker routes | P3d+ | Listed in `HEALTH_SAFETY_LABOR_AUDIT.md` |
| `RuleGate` + 422 corrective UX | P3a (temp log first) | Foundation types land before P3a UI |
| `LariatKDSCore` package fold-in | P2d follow-up | Display grid; punch writes ship without Core dep |
| KDS `idempotency_keys` table | P2d follow-up | JSONL audit for tickets; keys deferred |
| Break COMPS shift-window UI | P3c follow-up | `BreakCompute.evaluateShift` ported; shift bounds UI deferred |
| 86-on-fail from checklist | P2c optional | Not blocking signoff in native v1 |
| L5/L6 signoff regulatory gates | P2c+ | Web-only gates not ported in P2c v1 |
| Glove attestation UI | P2c+ | Column exists; UI deferred |

## P3 sub-phase ladder (Q6 — handoff from P2b)

P2b proves **AuditedWrite** without RuleGate. P3 splits by risk:

| Sub-phase | Surfaces | Gate type |
|-----------|----------|-----------|
| **P3a** | Temp log + Safety hub | **RuleGate** (`needs_corrective_action`) + PinGate back-date |
| **P3b** | Date marks, calibrations | Validation + audit (no 422 RuleGate) |
| **P3c** | Cleaning, breaks | 400 validation / 409 conflict |
| **P3d+** | Cooling, receiving, sanitizer, sick-worker | TBD |

**Foundation order before P3a UI:** `RuleGateError` + `WriteErrorMapper` branch → `TempLogCompute` pure port →
`TempLogRepository` → UI.

## Navigation wiring (Flow 1)

P2a stubs disconnect cooks from P2b unless **U1/U4** enable:

- `CookSection`: `.eightySix` → `enabled: true`
- `LariatApp`: route `EightySixView` with read + write DB + catalog
- `TodayView`: "86 right now" action + open-86 chips navigate to 86 board (not read-only sheet)

Without this, Today remains a dead-end relative to the write loop.

## References

- Web: `app/api/eighty-six/route.ts`, `app/api/eighty-six/resolve/route.ts`, `app/eighty-six/EightySixBoard.jsx`
- Native: `EightySixRepository.swift`, `AuditEvent.swift`, `CookIdentityStore.swift`
- Tests: `tests/js/test-eighty-six-api.mjs`, `tests/js/test-financial-acid.mjs`
- P3 plan: `docs/plans/2026-06-17-004-feat-lariat-native-p3-haccp-labor-plan.md`
