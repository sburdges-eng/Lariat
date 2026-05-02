# Breaker Audit Finding

**Subsystem:** Shows / settlement math (Section 5)

**Invariant:** Talent payout math is a regulated number — venue and talent both rely on it being correct AND auditable. Per `docs/PHASE2_PLAN.md`: "Settlement parity vs Prism: ≥ 6 consecutive shows, no settlement variance > $5 absolute, 0.5% relative." Rounding direction matters — at scale, a systematic bias even of fractional cents per show shows up in those parity windows.

**Break attempt:**
Compute talent payout for a "$800 guarantee + 85% over costs" deal with $5,000 door, $300 in costs:

- overage = 500_000 - 30_000 - 80_000 = 390_000 cents
- vsBonus = floor(390_000 × 0.85) = floor(331_500.0) = 331_500 cents — clean

Now try the case where overage × pct doesn't divide evenly:

- overage = 1_000_001 cents (a $10,000.01 overage; one stray cent from a $0.01 fee)
- 0.65 × 1_000_001 = 650_000.65
- `Math.floor(650_000.65)` = **650_000** cents
- Talent gets 650_000 cents; the venue retains the 0.65-cent fractional (stored as 0 because cents are integer).

**Observed result:** `lib/dealPoints.ts:89`:
```ts
const vsBonusCents = deal.vsPctAfterCosts === null
  ? 0
  : Math.floor(overage * deal.vsPctAfterCosts);
```

`Math.floor` is the rounding direction. It's directionally biased AGAINST the talent — the venue keeps the fractional cent on every non-clean overage. For a venue running 200 shows a year on $X,000 doors, this accumulates a small but real bias that the talent buyer can't see.

The bias is NOT in the schema, NOT documented in `docs/PHASE2_PLAN.md`'s settlement section, and NOT covered by a comment in the code.

**Expected result:** Either:
(a) Document the rounding convention in `docs/PHASE2_PLAN.md` and add a code comment explaining the choice (e.g. "venue-favorable rounding per booking convention"), OR
(b) Use `Math.round` for half-up rounding (the natural mathematical convention; bias is symmetric on average), OR
(c) Use banker's rounding (financial-services convention; bias-free at scale, half-to-even).

The choice is a product decision, not a math correctness issue. But the SILENT bias is the problem — a venue could change rounding direction without anyone noticing.

**Risk:** P3. Bias-against-talent on every non-clean overage. Trivial per show ($0.001 average); accumulates over hundreds of shows. The Phase 2 cutover checks settlement parity vs Prism — if Prism uses round/banker's rounding, Lariat will systematically differ by a few cents per show, which could trip the parity gate or mask other bugs.

**Repro command:**
```bash
node --experimental-strip-types -e "
const { computeTalentPayout } = await import('./lib/dealPoints.ts');
const deal = { guaranteeCents: 80000, vsPctAfterCosts: 0.65, costsOffTop: [], buyoutCents: 0 };
const result = computeTalentPayout({ deal, ticketRevenueCents: 1080001 });
console.log('vsBonus:', result.vsBonusCents, '(round would be:', Math.round((1080001 - 80000) * 0.65), ')');
"
```

**Likely files:**
- `lib/dealPoints.ts:89` — the floor/round/banker's choice
- `docs/PHASE2_PLAN.md` — settlement section: document the chosen convention
- Possibly: `tests/js/test-deal-points.mjs` — add a fractional-cent test that pins the chosen direction

**Fix class:** docs (the bias should be a documented convention, not a silent default)

**Priority:** **P3** — non-blocking polish; documentation gap on a regulated number.

---

## Optional notes

- The two other places in this module that round (`Math.round(c.cents)` in parseDeal map, and the cents on guarantee/buyout) all use `Math.round`. Only the vs% bonus uses floor. That asymmetry is its own smell — the same module rounding three different ways is more confusing than a single chosen direction.
- A test fixture with non-clean overage (e.g. `overage_cents=1000001, pct=0.65`) and an assertion that the result matches the chosen rounding convention would lock the contract going forward.
- Adjacent thing noticed but NOT this finding: `parseDeal` does not validate `vs_pct_after_costs ∈ [0, 1]`. The `import-prism-deals.mjs` importer (#92) DOES validate that on import, but a manual deal-editor entry could write 1.5 (a 150% bonus) without complaint. Worth its own P3 finding eventually.
