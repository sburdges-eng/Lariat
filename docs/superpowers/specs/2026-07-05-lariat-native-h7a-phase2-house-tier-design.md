# LariatNative H7a Phase 2 — House tier: VoiceOver + Dynamic-Type design

## Goal

Extend the VoiceOver accessibility + Dynamic-Type pattern established in H7a Phase 1
(PR #430) and continued in Phase 2's Cook, Purchasing, BEO, Inventory, and FOH tiers
(PR #432-436) to the 4 board views in the `.house` `FeatureTier`.

## Non-goals

- `TileDegrade.swift`, `EmptyState.swift`, `PinEntrySheet.swift` are out of scope — shared
  cross-tier/app-wide components, not tier-specific.
- `GoldStarsView.swift` does NOT reference `PerformanceReviewsView.swift` (that file is
  called only from `CommandView.swift`, an unrelated presenter) — confirmed via grep and
  full read, no scoping decision needed there.
- The remaining 4 tiers (labor, shows, costing, manager) are separate future
  sub-projects.
- No extraction to `LariatModel`, no new dependency, no XCTest (none exists for
  `LariatApp` — `swift build` clean is the acceptance gate).
- No behavior change for a sighted user — every change in this tier is a trailing
  modifier addition; unlike the FOH tier, no zone here mixes read-only info with a
  sibling interactive control inside a flat container, so no wrapper restructuring is
  needed anywhere.

## Scope: 4 files

`BarView.swift`, `BarParView.swift`, `EquipmentView.swift`, `GoldStarsView.swift` — all
under `LariatNative/Sources/LariatApp/`. Confirmed via `HouseFeatures.swift`/
`FeatureRegistry.swift` that this tier has exactly these 4 boards, and via grep that none
is presented from another tier.

**Correction to an earlier assumption**: `BarView.swift` has **zero** pre-existing
accessibility modifiers (an initial audit-dispatch prompt incorrectly stated it had one —
caught and corrected by reading the file directly, not trusting the stale claim).
`EquipmentView.swift` genuinely has one: `manualRow`'s local-file-open `Button` carries
`.accessibilityLabel("Open the manual for this equipment")` — this must remain
byte-for-byte unchanged and is not duplicated by any fix below.

## Pattern (fixed by precedent)

Same as Phase 1 / Cook / Purchasing / BEO / Inventory / FOH. This tier reuses two
established idioms without introducing anything new:
- `.accessibilityAddTraits(condition ? [.isSelected] : [])`
  (`DatapackSearchView.swift:86`) for `EquipmentView.equipmentCard`'s expand/collapse
  state and `GoldStarsView`'s award-sheet tier selector.
- The "generic button repeated across many rows needs the item name" fix
  (`VendorCompareView.rowActions`, `HostStandView`/`ReservationsBoardView`'s
  buttons) for `GoldStarsView.recognitionRow`'s "Remove" button.

## Confirmed real gaps

**Two confirmed selection/expansion-state gaps**, both fixed via the established
`.isSelected` idiom:
- `EquipmentView.equipmentCard`'s expand/collapse `Button` has zero spoken indication of
  whether the detail panel below it is currently open — structurally identical to
  `DatapackSearchView.hitRow`'s toggle-disclosure pattern.
- `GoldStarsView`'s award-sheet tier selector conveys the currently-selected tier via a
  checkmark image alone, no spoken equivalent. The checkmark itself gets
  `.accessibilityHidden(true)` once the trait makes it redundant (same rationale as
  Inventory tier's decorative-chevron hide).

**One confirmed color-only signal**: `BarView.pourRow`'s trailing percentage `Text` is
tone-colored (red/yellow/green) with no spoken tone word — unlike `BarView.
distribution`'s badges, which already spell out "on target"/"watch"/"over" in text. Fix
adds a `pourRowAccessibilityLabel` helper and a new `toneWord(_:)` function (no
pre-existing word-mapping helper exists in this file to reuse — only a `color(for:)`
mapping to `Color`, kept unchanged).

**One confirmed button-naming gap**: `GoldStarsView.recognitionRow`'s "Remove" button
renders once per row in a `ForEach` with no per-record disambiguation — same class fixed
in `HostStandView`/`ReservationsBoardView` (FOH tier).

**One confirmed Dynamic-Type risk**: `GoldStarsView.leaderboardSection`'s rank `Text`
uses a fixed `width: 34` in a dense 3-column row (rank/name/star-count) — a real clipping
risk. Fix: `width: 34` → `minWidth: 34`.

**Everything else** is the familiar fragmented-row cleanup: `BarView.countBadge`,
`BarParView.parRow`, `EquipmentView.partsTab`/`scheduleTab` per-item rows,
`GoldStarsView.recognitionRow`'s info block, `GoldStarsView.leaderboardSection`'s
per-entry row.

**Verified NOT gaps** (explicitly checked, not just assumed):
- `BarParView.parRow`'s "low" badge — the word "low" is spelled out in the Text itself,
  the amber tint is reinforcement only.
- `EquipmentView`'s warranty-expired/service-overdue lines and `scheduleTab`'s "overdue"
  tint — both already state the condition in text.
- `GoldStarsView.leaderboardSection`'s top-3 amber tint — the rank numeral itself
  ("#1"/"#2"/"#3") already conveys rank.
- `EquipmentView.detailsTab` — correctly left untouched as a whole; it can render an
  interactive `Link`/`Button` (the manual-open control) among independent fact rows, so
  combining the block would nest that control inside `.combine`. No task touches this
  tab.

## Dynamic-Type risk — full inventory

Only one genuine fixed-width `Text` column exists across the whole tier (above).
`EquipmentView.addEquipmentForm`'s `.frame(minWidth: 420, minHeight: 520)` is a
window-sizing frame, not a text column, and is excluded per established precedent.

## Complexity flags

All 4 files are single-task-sized, no file needs splitting or a wrapper restructuring:
- `BarView.swift`: 2 zones (`countBadge`, `pourRow` — the tier's one color-only fix).
- `BarParView.swift`: 1 zone (`parRow`) — smallest file in the tier.
- `EquipmentView.swift`: largest file (388 lines) but only 3 mechanical zones
  (`equipmentCard`'s trait, `partsTab`, `scheduleTab`), none requiring restructuring.
- `GoldStarsView.swift`: 3 zones across 2 sub-views + 1 sheet
  (`recognitionRow`, `leaderboardSection` — the tier's one Dynamic-Type fix, and the
  award-sheet tier selector).

## Invariants

- Every touched interactive control has an unambiguous label naming its target.
- The two status-bearing elements relying on visual state alone (`EquipmentView`'s
  expand/collapse, `GoldStarsView`'s tier-selector checkmark) now expose `.isSelected`.
- The one color-only signal (`BarView.pourRow`'s tone) now also verbalizes via a new
  `toneWord(_:)` helper.
- No interactive control is ever nested inside a `.combine` block.
- `EquipmentView`'s pre-existing `.accessibilityLabel("Open the manual for this
  equipment")` remains byte-for-byte unchanged.
- `swift build` stays clean after every task; the final task's scripted audit confirms
  all 4 files gained accessibility modifiers and the branch's diff touches exactly these
  4 files under `LariatNative/`.

## Open questions

None outstanding.

## Testing / acceptance

Per-task: `swift build` clean. Final task: scripted coverage audit (4 files) + scope-diff
check (exactly these 4 files) + mandatory final whole-branch review, mirroring
Phase 1/Cook/Purchasing/BEO/Inventory/FOH precedent. The whole-branch review for this
tier should confirm `EquipmentView`'s pre-existing label is untouched, and confirm
neither new `.isSelected` site nests the toggle/tier-select Button inside a `.combine`
block (both are attached directly to the Button itself, not to a wrapping container that
also holds other content).
