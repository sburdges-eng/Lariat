# LariatNative H7a Phase 2 — Costing tier: VoiceOver + Dynamic-Type design

## Goal

Extend the VoiceOver accessibility + Dynamic-Type pattern established in H7a Phase 1
(PR #430) and continued in Phase 2's Cook, Purchasing, BEO, Inventory, FOH, House,
Labor, and Shows tiers (PR #432-439) to the 8 board views in the `.costing`
`FeatureTier` — the largest tier by total line count in the whole sweep (~3100 lines
across 8 files).

## Non-goals

- `TileDegrade.swift`, `EmptyState.swift` are out of scope — shared cross-tier/app-wide
  components.
- No `LariatModel`/compute changes of any kind. **`IngredientMastersView.swift` is a
  regulated write surface** (in-transaction audited write, `audit_events`,
  `actor_source=native_mac`, 3 quality-lock validation rules) — its write/validation/audit
  logic lives entirely in `IngredientMastersViewModel`/`IngredientMastersRepository`,
  confirmed by reading both files in full; this plan touches only the View's accessibility
  metadata on the one Button that triggers the write, never the write itself.
  **`DishComponentsView.swift` also performs writes** (`saveAll`/`delete` via
  `DishComponentsViewModel`) — while not identified as "the" audited write surface the
  way `IngredientMastersView` is, the same discipline applies: verify the View/ViewModel
  boundary before touching anything near a write-triggering control.
- The remaining tier (manager) is a separate future sub-project — the last one in H7a
  Phase 2.
- No extraction to `LariatModel`, no new dependency, no XCTest (none exists for
  `LariatApp` — `swift build` clean is the acceptance gate).
- No behavior change for a sighted user beyond the restructurings noted below.
- One pre-existing duplication in `CostingView.swift` (`variancePctColor` independently
  declared in both `VarianceSection` and `RecipeCostVarianceSection`) is NOT consolidated
  by this plan — it predates this sweep and consolidating it is a refactor, not an
  accessibility fix. This plan's new `variancePctToneWord` helpers mirror that
  pre-existing duplication rather than introduce new inconsistency.

## Scope: 8 files

`CostingView.swift`, `PriceShocksView.swift`, `VarianceAttributionView.swift`,
`MenuEngineeringView.swift`, `MarginDeltasView.swift`, `DepletionExceptionsView.swift`,
`IngredientMastersView.swift`, `DishComponentsView.swift` — all under
`LariatNative/Sources/LariatApp/`. Confirmed via `CostingFeatures.swift`/
`FeatureRegistry.swift` that this tier has exactly these 8 boards, and via grep (split
across 3 parallel audit passes given the tier's size) that none is presented from
another tier.

**All 8 files have zero pre-existing accessibility modifiers** — this is the first tier
in Phase 2 where every single file starts from a clean slate.

## Pattern (fixed by precedent)

Same as Phase 1 / Cook / Purchasing / BEO / Inventory / FOH / House / Labor / Shows. No
new idiom is introduced, but this tier has the widest variety of color-only-signal
verification seen in one tier: three separate confirmed threshold-based signals (variance
%, margin %, SPL-style tone), each independently traced against its `LariatModel` compute
source rather than assumed, plus one signal explicitly demoted to "reinforcement only"
after tracing the exact same reasoning pattern established in `ShowSettlementView.
netDoorSection` (a signed value's own +/- prefix already discloses direction).

## Confirmed real gaps

**Three confirmed color-only signals**, each verified against compute source:
- `CostingView`'s `variancePctColor` (both `VarianceSection` and
  `RecipeCostVarianceSection`) — red ≥5%, yellow 2-5%, green <2%. The bare percentage
  never discloses which threshold tier it's in. Fixed via a `variancePctToneWord` helper
  in each struct (pre-existing duplication mirrored, not introduced).
- `VarianceAttributionView.PeriodBadge` — same `ThresholdColor` enum
  (`CostingCompute.swift`), same red/yellow/green buckets, same fix shape.
- `MenuEngineeringView.MenuEngineeringRowView.marginStat` — margin % shown red+bold below
  a 20% floor with no accompanying word (confirmed via the code's own doc comment: "red +
  bold below the 20% floor").

**One medium-confidence color-only candidate**, disclosed with a fallback: `DepletionExceptionsView.DepletionExceptionRow`'s `toneColor` (red/yellow/blue severity
grouping from `DepletionReasonLabels.tone`, verified against that type's own doc
comment). The reason label already names the specific issue in text; only the
severity *grouping* is otherwise silent. The plan includes the wording fix but flags it
as a judgment call, with an explicit fallback (drop the tone-word addition, keep only the
combine) if the implementer/reviewer judges it too speculative.

**Two verified reinforcement-only signals** (explicitly checked against compute, not
assumed — NOT fixed):
- `MarginDeltasView.MarginDeltaRowView`'s red/green tone — `direction` is a pure function
  of `deltaPct`'s sign, and `fmtPct` already prepends an explicit "+"/"-" that VoiceOver
  reads aloud. Same reasoning as `ShowSettlementView.netDoorSection`.
- `PriceShocksView`'s red/green tone on delta% — identical signed-value reasoning.

**Multiple verified non-gaps** (explicitly read and ruled out, not assumed): `MenuEngineeringView`'s quadrant-color/link-badge-color (both sit on already-spoken
words), its `componentLine`'s D/R type-tag color (a deterministic 1:1 function of the
letter shown, color adds zero unspoken information), `IngredientMastersView`'s muted/
primary column tinting (the "—" placeholder already discloses "unset" regardless of
color), and `VarianceAttributionView`'s 4 row tables (no color anywhere in them).

**Restructurings needed** (interactive control must stay a sibling of a new combined info
block, matching the `ShowsBoardSupport.ShowsLockedView`/`ShowBoxOfficeView.lineRow`
precedent):
- `DepletionExceptionsView.DepletionExceptionRow` — the dish-name Button (already
  distinctly labeled per row via its own text) stays a sibling of a new combined
  reason/detail/meta/periods block.
- `DishComponentsView.existingCard`'s row — 5 info Texts wrapped in an inner HStack with
  combine; the conditional destructive trash Button stays a sibling. **This exact
  restructuring was caught and self-corrected mid-audit** — a first draft nearly combined
  the whole outer HStack (which would have nested the Button), caught by the auditor's
  own re-check before it reached this plan.

**Button-naming gaps** (identical label repeated per row): `IngredientMastersView`'s
"Mark reviewed" button (regulated-write trigger — label-only change, write logic
untouched), `DishComponentsView.builderCard`'s remove button and `existingCard`'s delete
button.

**One medium-confidence, explicitly-optional gap**: `DishComponentsView.builderCard`'s
qty/unit TextField labels (identical placeholders across every row) — included with a
fallback note that dropping just this piece (keeping only the higher-confidence
remove-button fix) is an acceptable reduced scope if the implementer/reviewer judges it
unnecessary.

**Everything else** is the familiar fragmented-row cleanup across the remaining zones in
each file (see the implementation plan for the full per-file breakdown), including two
shared-helper leverage points: `CostingView`'s `variancePctColor`/`variancePctToneWord`
pattern (reused identically in 2 structs within the same file) and the well-established
"label already precedes value, no override needed" reasoning applied uniformly to
`VarianceAttributionView`'s 4 row tables, `MenuEngineeringView`'s `stat`/`prepMedianStat`
helpers, and elsewhere.

## Dynamic-Type risk

**Four confirmed fixed-width `Text` columns**, all in dense multi-column rows:
- `CostingView`'s two rank-number columns (`RecipeCostVarianceSection`'s top-offenders
  loop, `AbcSection`'s top-5-in-tier-A loop) — both `width: 16`.
- `PriceShocksView.PriceShockRowView`'s delta% column — `width: 72`.
- `DishComponentsView.existingCard`'s component-type-label column — `width: 70`.

All four `width:` → `minWidth:`. `VarianceAttributionView`, `MarginDeltasView`, and
`IngredientMastersView` have zero fixed-width `Text` columns — confirmed by full read
and grep, not assumed absent. `MenuEngineeringView` also has zero. `DepletionExceptionsView`'s only fixed-size element is a decorative 3pt divider bar
(`Rectangle`, not `Text`).

**Explicitly NOT fixed** (fixed-width `TextField`s/`Picker`s, not `Text` columns, per
established precedent): `DishComponentsView.builderCard`'s several fixed-width
`TextField`/`Picker`/`Menu` controls (qty/unit/notes fields, Type/Units pickers) —
input controls scroll their content, they don't clip like `Text`.

## Complexity flags

- **`CostingView.swift`** (734 lines, the largest file in the whole sweep): split into
  2 sub-steps within one task, mirroring the `ShowsTonightView`/`BeoBoardView`
  precedent — Sub-step A: `VarianceSection`+`RecipeCostVarianceSection`+
  `DishCoverageSection`; Sub-step B: `MenuEngineeringSection`/`QuadrantCell`+
  `VarianceTrendSection`+`AbcSection`/`AbcTierRow` (includes both Dynamic-Type fixes).
  No interactive controls exist anywhere in this file — every fix is a pure additive
  `.combine`/label/width swap, no restructuring needed.
- **`DishComponentsView.swift`** (568 lines): optionally splittable into 2 sub-steps
  (`readOnlyBanner`+`builderCard` vs. `existingCard`+the Dynamic-Type fix) but not
  strictly required — kept as one task with clearly delineated steps.
- **`MenuEngineeringView.swift`** (479 lines): edit surface concentrates in one struct
  (`MenuEngineeringRowView`, ~110 of the 479 lines) — one task despite the file's length.
- **`VarianceAttributionView.swift`, `PriceShocksView.swift`**: moderate, one task each,
  multiple zones but no restructuring beyond what's noted above.
- **`DepletionExceptionsView.swift`**: small, one restructuring zone, one task.
- **`IngredientMastersView.swift`**: small, one task, but gets an extra mandatory
  verification step given its regulated-write status (mirroring `ShowSettlementView`'s
  precedent from Shows tier).
- **`MarginDeltasView.swift`**: smallest and simplest, one task, no restructuring.

## Invariants

- Every touched interactive control has an unambiguous label naming its target.
- Every genuinely ambiguous color-only signal is verbalized; reinforcement-only color
  (signed-value direction, redundant type-tag letters, already-spoken quadrant/badge
  words) is explicitly left untouched in every case identified above.
- No interactive control is ever nested inside a `.combine` block.
- `IngredientMastersViewModel`/`IngredientMastersRepository` and
  `DishComponentsViewModel` (compute/write/audit logic) are untouched — confirmed by
  scope-diff check.
- `swift build` stays clean after every task; the final task's scripted audit confirms
  all 8 files gained accessibility modifiers and the branch's diff touches exactly these
  8 files under `LariatNative/`.

## Open questions

None outstanding — the two disclosed judgment calls (`DepletionExceptionsView`'s
tone-word wording, `DishComponentsView`'s qty/unit TextField labels) each carry an
explicit fallback in the plan rather than blocking on a decision.

## Testing / acceptance

Per-task: `swift build` clean. Final task: scripted coverage audit (8 files) + scope-diff
check (exactly these 8 files) + mandatory final whole-branch review, mirroring
established precedent. Given `IngredientMastersView`'s regulated-write status, its task
review and the whole-branch review should both explicitly confirm zero diff in
`IngredientMastersViewModel`/`IngredientMastersRepository`, mirroring the
`ShowSettlementViewModel` zero-diff check from Shows tier. The whole-branch review should
also confirm the two restructured zones (`DepletionExceptionsView`,
`DishComponentsView.existingCard`) keep their interactive controls genuine siblings,
and confirm the three color-only wording additions don't leak beyond their verified
ambiguous cases.
