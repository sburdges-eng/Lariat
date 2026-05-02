# Breaker Audit — 2026-05-02 — Section 5

**Section covered:** 5 — Shows / settlement / box office / stage / sound.

**Auditor:** claude

**Read-only:** YES.

**GitNexus:** fresh from prior reindex (16,206 nodes / 24,779 edges).

---

## Method

Six-prong checklist applied to:
- `lib/dealPoints.ts` — pure-fn talent payout math
- `lib/settlementRepo.ts` — getSettlement aggregator + upsertDeal writer
- `lib/boxOfficeRepo.ts` — DICE/walkup/comp ticket writer + scanner
- `app/api/shows/[id]/{deal,settlement,box-office,box-office/[lineId],stage,sound,sound/[sceneId]}/route.js`
- `lib/db.ts` `box_office_lines` + `show_deals` schemas

---

## Findings

| # | Priority | Title |
|---|---|---|
| 1 | **P1** | DICE idempotency contract is documented in `lib/boxOfficeRepo.ts:5,17` but neither the function (`bulkUpsertFromDice`) nor the schema's UNIQUE constraint on `(source, external_ref)` exists. Latent until `scripts/ingest-dice.mjs` lands; will overpay talent on retry. [Full record](findings/2026-05-02-dice-idempotency-not-enforced.md). |
| 2 | **P3** | `vsBonusCents = Math.floor(overage * vsPctAfterCosts)` is silently bias-against-talent on every non-clean overage. Sister rounds in the same module use `Math.round`. Convention is undocumented in `docs/PHASE2_PLAN.md` and uncovered by tests. [Full record](findings/2026-05-02-talent-vs-bonus-floor-bias.md). |

No P0 or P2 findings this pass.

---

## Verified-correct surfaces

- **`upsertDeal`** writes `show_deals` and `audit_events` in a single `db.transaction`; action='correction' on subsequent writes per the convention. Audit payload is the DealPoint DTO.
- **`createBoxOfficeLine`** posts an audit row inside the same tx as the INSERT.
- **`markScanned`** scopes by `(show_id, location_id)` — a stale `lineId` from a different show cannot be mutated even if the id collides.
- **`getSettlement`** rounds money at the read boundary (`Math.round(face_price * qty * 100)`) and returns INTEGER cents end-to-end. `parseDeal` rounds inputs with `Math.round` (not floor) on the way in.
- **PIN gate** — every `app/api/shows/[id]/*` route has its own `requirePin`/`hasPinCookie` re-check on top of the matcher (verified during Section 2's audit).
- **`computeTalentPayout`** correctly clamps overage to `Math.max(0, ...)` so a negative overage (door under guarantee) doesn't subtract from the guarantee.
- **`getSettlement`** falls back to `emptyDeal()` when no `show_deals` row exists — a show without a deal returns a zeroed settlement instead of throwing.

---

## Test gaps surfaced

- **No `tests/js/test-box-office-dice-idempotency.mjs`.** Once finding #1 is fixed, this should be the regression pin.
- **No fractional-cent test in `tests/js/test-deal-points.mjs`.** Existing tests use clean inputs (200_000 - 5_000 - 100_000 = 95_000 ÷ 0.85 = clean). A test with `overage % (1/pct) ≠ 0` would lock the rounding convention.
- **No `parseDeal` range-validation test for `vs_pct_after_costs`** outside [0,1]. The Prism importer validates this; the deal editor doesn't.

---

## Recommended next moves

1. **Fix finding #1 before `scripts/ingest-dice.mjs` lands.** The migration + `bulkUpsertFromDice` + idempotency test are a single coherent PR; landing the DICE ingest first guarantees a money-losing bug on the first retry.
2. **Document the rounding convention** (finding #2). Choose `floor` (current; venue-favorable) OR `round` (mathematical default) and document in `docs/PHASE2_PLAN.md` settlement section. Add a test fixture pinning the choice.
3. **Section 6 next pass** — Kitchen Assistant / Specials / Ollama / Data Pack degraded states. The recent #89 BGE merge moved that area's contract; high value to sweep.

---

## Stop conditions hit

None.

---

## Workflow notes

- The Phase 2 plan (`docs/PHASE2_PLAN.md`) is unusually rich for this section — it explicitly names acceptance criteria and listed `bulkUpsertFromDice` as future work. Reading the plan FIRST to extract invariants, before grepping the code, was the right move and surfaced the missing-function gap fastest.
- This is the third audit in a row where the doc claimed something the code didn't deliver:
  - Section 1: `app/api/signoff` was claimed as audited; wasn't. (#103)
  - Section 4: `vendor_prices_history` was claimed append-only; wasn't on upsert. (#111)
  - Section 5: `bulkUpsertFromDice` is claimed idempotent; doesn't exist.
  Next workflow tweak — add a "doc-vs-code drift" prong to the six-prong checklist for any subsystem that has a written design doc.
