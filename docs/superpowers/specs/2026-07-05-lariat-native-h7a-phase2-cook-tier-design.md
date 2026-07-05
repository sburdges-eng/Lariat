# LariatNative H7a Phase 2 — Cook tier: VoiceOver + Dynamic-Type design

## Goal

Extend the VoiceOver accessibility + Dynamic-Type pattern established and merged in H7a
Phase 1 (PR #430, 13 `.safety`-tier files) to the 10 board views in the `.cook`
`FeatureTier`. Same mechanism, same acceptance bar, same review discipline — this is a
scope extension, not a redesign.

## Non-goals

- **`CookIdentityPicker.swift`** is explicitly out of scope for this sub-project. A
  read-verified audit found it is presented from 19 call sites across 4 tiers (Safety,
  Cook, FOH, plus the shared `CookIdentityStore` "interrupt family"), not the Cook tier
  alone. Touching it here would break the tier-scoped-diff verification pattern Phase 1's
  T14 established (`git diff --name-only` against an expected per-tier file list). It has
  one real gap of its own (a color-only "currently selected cook" checkmark) and gets its
  own standalone task/PR later.
- The other 9 remaining tiers (labor, inventory, manager, costing, purchasing, foh,
  shows, house, beo) are separate future sub-projects, one PR each, per the H6/H7 handoff
  doc's chosen cadence.
- No extraction of accessibility strings into `LariatModel` — everything stays inline in
  the View body, matching `SanitizerView.swift`'s house style.
- No new dependency (this codebase has exactly one, GRDB).
- No XCTest — `LariatApp` has no test target. Acceptance is `swift build` clean plus a
  scripted grep-based coverage + scope audit, exactly like Phase 1's Task 14.
- No behavior change for a sighted user — every change is additive
  (`.accessibilityElement`/`.accessibilityLabel`/`.accessibilityAddTraits`), except where
  a fix requires splitting a `VStack` into an inner combined block + a sibling control (to
  avoid nesting an interactive control inside `.combine` — same restructuring Phase 1 did
  for `CoolingView` and would have prevented the `SdsView` defect had it been applied
  from the start).

## Scope: 10 files

`TodayView.swift`, `EightySixView.swift`, `StationsListView.swift`,
`StationChecklistView.swift`, `KdsPunchView.swift`, `PrepView.swift`,
`PrepParView.swift`, `MorningView.swift`, `DatapackSearchView.swift`,
`KitchenAssistantView.swift` — all under `LariatNative/Sources/LariatApp/`.

Every file was read in full (not grep-sampled) before this design was written, per Phase
1's own lesson that a grep-derived claim about Dynamic-Type risk was once wrong.

## Pattern (fixed by Phase 1 precedent, not re-derived here)

1. Wrap a composite row/tile's **read-only** info in
   `.accessibilityElement(children: .combine)` + a hand-written `.accessibilityLabel(...)`
   that verbalizes anything conveyed by color alone.
2. **Interactive controls stay siblings, never nested inside a `.combine` block** — this
   is the exact defect class Phase 1's final whole-branch review caught in `SdsView`.
   Every task below that needs this restructuring says so explicitly.
3. Give every action button a label that names its target (`"Bump"` → `"Bump order
   1042"`), matching Phase 1 Tasks 4/7/11/12.
4. Fixed-`width` (not `maxWidth`, not `height`) `Text` columns are the only genuine
   Dynamic-Type risk category — decorative fixed-size `Circle`/divider elements are not.

## Confirmed real gaps (verified by reading, not inferred)

Four genuine **color-only** signals — the highest-severity gap class, where sighted users
get information VoiceOver users get none of:

1. **`TodayView.eightySixSection`** — 86'd items (red chip) vs. cascade-affected recipes
   (orange chip) render as visually-identical bare `Text`, no spoken distinction.
2. **`StationChecklistView.statusButton`** — which of Pass/Fail/N/A is *currently
   recorded* for a line item is conveyed only by tint color.
3. **`MorningView.topHeadsUp`** — critical vs. warning alert severity is a colored dot
   only; the message text carries no severity word.
4. **`CookIdentityPicker`'s selected-cook checkmark** — deferred (see Non-goals).

Everything else in scope is the same fragmented-multi-Text-stop pattern Phase 1 fixed
repeatedly (info blocks not combined, action buttons not naming their target) — no new
gap category.

## Dynamic-Type risk

**None found in this tier.** Every fixed-size `.frame(width:, height:)` hit in all 10
files was a decorative status dot (a `Circle`, never a `Text`). This differs from Phase 1,
where `HaccpPlanView` had a genuine fixed-width `Text`-column clipping risk — Cook tier
simply doesn't have that pattern anywhere. No task below includes a `width` → `minWidth`
change.

## Complexity flags (informs plan task sizing)

- **Large / multi-zone:** `TodayView` (5 sections: hero stats, action cards, stations,
  stock moves, 86 chips), `PrepView` (3 zones: open task rows + actions, closed rows,
  add-form).
- **Moderate / scattered:** `DatapackSearchView` (4 independent detail sub-panels, each
  needs its own small fix), `KitchenAssistantView` (header badges, chat bubbles, composer
  are 3 distinct concerns), `EightySixView` (3 row types), `KdsPunchView` (2 row types).
- **Small / single row type:** `StationsListView`, `StationChecklistView`,
  `PrepParView`.
- **Low actual complexity despite length:** `MorningView` is 250 lines but only one row
  type (the top-alerts list, max 5 rows) needs any change.

## Invariants

- Every touched interactive control has an unambiguous label naming its target.
- Every status-bearing row/tile that currently relies on color alone now also verbalizes
  its state as a word, not just a symbol.
- No interactive control (`Button`, `Link`, `Menu`) is ever nested inside a
  `.accessibilityElement(children: .combine)` block.
- `swift build` stays clean after every task; the final task's scripted audit confirms
  all 10 files gained at least one accessibility modifier and that the branch's diff
  touches exactly this file list under `LariatNative/`.

## Open questions

None outstanding — the one open design decision (defer `CookIdentityPicker`, tier-per-PR
cadence, Cook tier first) was surfaced to and resolved by the user before this doc was
written.

## Testing / acceptance

Per-task: `swift build` clean (no test target exists for `LariatApp`). Final task: a
scripted grep-based coverage audit (all 10 files have ≥1 accessibility modifier) + a
scope-diff check (`git diff --name-only $(git merge-base origin/main HEAD)` matches
exactly these 10 files under `LariatNative/`) — both mirroring Phase 1's Task 14 verbatim.
A mandatory final whole-branch review (the gate that caught Phase 1's one real
cross-file defect) happens after all 10 per-file tasks land, before the PR is opened.
