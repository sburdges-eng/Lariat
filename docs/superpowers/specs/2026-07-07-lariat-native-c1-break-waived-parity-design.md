# LariatNative Phase C1 — Break waived-meal open-guard parity + ledger refresh

Date: 2026-07-07
Status: implemented — branch `feat/lariat-native-c1-break-waived-parity` (T1 committed;
BreakRepository open-break guard now unconditional, TDD red→green + 3 backfill tests;
`swift test` green: LariatModelTests 1420 / LariatDBTests 1012 (+4), 0 failures). C1 ledger
refreshed: all 3 refuted rows resolved (BEO already-fixed, KitchenAssistant reclassified, Break fixed).
Parent: `docs/superpowers/specs/2026-07-03-lariat-native-phase-c1-rule-ledger.md` (the C1 ledger)
Endgame: `docs/superpowers/specs/2026-07-02-lariat-native-endgame.md` §Phase C (finish adversarial
verification on ported-write rows; fix or reclassify refuted rows before any C5 route deletion).

## Goal

Close the one genuine code defect left from the C1 verify pass's three "REFUTED" ported-write rows,
and refresh the stale C1 ledger to match current `main`. Re-verifying the three rows against `main`
(`397af37`) — not the 2026-07-03 ledger snapshot — found that two were fixed in a later BEO wave and
one is a documentation-classification issue; only **`BreakRepository.start`** carries a live
parity divergence: it skips the open-break `409` guard for **waived meals**, while web runs that
guard **unconditionally** (`app/api/breaks/route.js:88-96`, a deliberate "can't open a new entry
while a prior break is open" rule under COMPS #39). This wave fixes that divergence, backfills the
waived-meal test coverage the ledger flagged as missing, and corrects the ledger so no future reader
re-chases already-fixed rows before C5.

## Non-goals (out of scope this round)

- **The 41 unverified ported-write rows** — finishing the broader C1 verify pass is a separate
  (larger) wave. This wave only resolves the three already-flagged REFUTED rows.
- **Any BEO code change** — `deleteEvent` / `setPrepDone` already carry `AND location_id = ?` and
  have cross-location regression tests on `main` (verified). This wave only marks the ledger rows
  resolved; it must not touch `BeoBoardRepository`.
- **Any KitchenAssistant code change** — `code_search` / `db_query` are correctly implemented as
  documented deferred stubs (web env-gates them off by default, so no production audit rule is
  lost). Only the ledger's *classification* of these actions is corrected (ported → deferred/edge).
- **Changing the `end`/`load` break paths, the accrual/`evaluateShift` compute, or the audit
  envelope** — the fix is strictly the open-break guard's *gating condition*.
- **No schema / migration / ownership change** — this is a write-rule parity fix, not a Phase-C flip
  step.

## User-facing surface (behavior, before → after)

A cook with an **open (unfinished) non-waived break** who submits a **waived meal**:
- **Before (native):** the waived-meal row inserts successfully — diverges from web.
- **After (native, = web):** the request throws `openBreakExists(id)` (the web `409`, `"cook has an
  open break"`), the same as any other break start while one is open. The cook must end the open
  break first.

No change to any other flow: a waived meal with no open break still records a single completed row
(`ended_at = started_at`, `duration_min = 0`, `waived = 1`); the two waived-meal `400`s
(non-meal-waive, waive-without-`waiver_ref`) are unchanged.

## Data model deltas

None. No tables, columns, migrations, or audit-shape changes.

## Components / architecture

1. **`BreakRepository.start`** (`Sources/LariatDB/BreakRepository.swift`) — remove the `if waived ==
   0 { … }` wrapper around the open-break lookup so the guard runs on **every** start (waived or
   not), matching web. The lookup SQL itself is unchanged — it already targets an *open non-waived*
   break (`ended_at IS NULL AND waived = 0`), which is the correct notion of "a prior break is still
   open" (a waived row is never open). The `409` throw (`BreakWriteError.openBreakExists`), the
   audited-write transaction, and the INSERT are all unchanged. This is regulated (COMPS #39 labor)
   code → Opus-authored, adversarially reviewed, no logic touched beyond the gate.

2. **`BreakRepositoryTests`** (`Tests/LariatDBTests/`) — the ledger flagged the entire waived branch
   as untested. Add:
   - `testWaivedMealWhileOpenBreakThrows409` — **the TDD driver**: with an open non-waived break,
     starting a waived meal throws `openBreakExists`. Fails before the fix (native inserts), passes
     after.
   - `testWaivedMealStoredAsSingleCompletedRow` — waived meal (no open break) → one row,
     `ended_at == started_at`, `duration_min == 0`, `waived == 1` (+ audit row).
   - `testWaivedNonMealBreakThrows400` — `waived` + `kind != .meal` → `validationFailed`.
   - `testWaivedMealWithoutWaiverRefThrows400` — waived meal, no `waiver_ref` → `validationFailed`.

3. **C1 ledger** (`docs/superpowers/specs/2026-07-03-lariat-native-phase-c1-rule-ledger.md`) — mark
   the BEO `delete_event` / `prep_done` rows **verified + fixed** (predicate + cross-location tests
   present on `main`), reclassify KitchenAssistant `code_search` / `db_query` from "ported" to
   **deferred/edge (documented stub; web env-gated off)**, and mark the Break row **fixed** (guard
   now unconditional + tests). Update the summary tallies (refuted 3 → 0; note the re-verify date).

## Invariants

- **Native matches the verified web rule** — after the fix, the open-break `409` fires for a waived
  meal exactly when web's does (`ended_at IS NULL AND waived = 0` prior break, same location + cook).
- **No weakening of any other break rule** — the two waived `400`s, the completed-row shape, the
  audit-in-same-transaction envelope, and the `end`/`load` paths are byte-for-byte unchanged.
- **Regulated-write safety** — the audited-write transaction and `audit_events` insert are
  untouched; the diff is confined to the guard's gating condition + new tests.
- **Ledger reflects code** — every C1 row's status matches current `main` after this wave, so the
  C5 cutover gate ("no unverified/ REFUTED ported-write deletions") reads true.

## Testing

- **`LariatDB` has a real test target** — this is genuinely TDD: `testWaivedMealWhileOpenBreakThrows409`
  is written first and confirmed red (native currently inserts instead of throwing), then the gate is
  removed and it goes green. The other three lock existing-but-untested behavior (they pass
  immediately — characterization coverage the ledger asked for).
- Gate: `swift build && swift test` from `LariatNative/` fully green (full suite, no regression).
- Parity oracle: `tests/js/test-*break*` on the web side is the reference behavior (web's
  unconditional guard); no new web test is added (web is already correct).

## Open questions

1. **Fix-to-parity vs. document-the-divergence** — resolved to **fix-to-parity**: web's guard is
   deliberate (explicit comment, COMPS #39) and native's skip is an accidental, undocumented,
   untested omission, so native should match rather than enshrine the divergence. Flag if you'd
   rather native *keep* allowing a waived meal over an open break (would instead require a documented
   divergence note + a web-side decision).
2. **Ledger tally precision** — the exact "verified" count after reclassifying KA actions
   (read-only, no write rule) is a bookkeeping choice; the wave will state the recount explicitly
   rather than guess.
