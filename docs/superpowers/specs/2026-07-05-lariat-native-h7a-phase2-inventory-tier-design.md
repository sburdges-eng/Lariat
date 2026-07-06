# LariatNative H7a Phase 2 — Inventory tier: VoiceOver design

## Goal

Extend the VoiceOver accessibility pattern established in H7a Phase 1 (PR #430) and
continued in Phase 2's Cook (PR #432), Purchasing (PR #433), and BEO (PR #434) tiers to
the 4 board views in the `.inventory` `FeatureTier`.

## Non-goals

- No file in this tier shares a component across tiers (confirmed: none of the 4 files
  references `CookIdentityPicker`, `PinEntrySheet`, or any other cross-tier shared view).
  `InventoryUpdateRow` is shared with `ReceivingView.swift`, but only as a data model
  (`LariatModel/ReceivingRecords.swift`), not a view component — no deferral needed.
- The remaining 5 tiers (foh, house, labor, shows, costing, manager) are separate future
  sub-projects.
- No extraction to `LariatModel`, no new dependency, no XCTest (none exists for
  `LariatApp` — `swift build` clean is the acceptance gate).
- No behavior change for a sighted user — every change in this tier is a trailing
  modifier addition, no restructuring needed anywhere.

## Scope: 4 files

`InventoryParView.swift`, `InventoryCountsView.swift`, `InventoryLogView.swift`,
`InventoryWasteView.swift` — all under `LariatNative/Sources/LariatApp/`. Confirmed via
`InventoryFeatures.swift`/`FeatureRegistry.swift` that this tier has exactly these 4
boards, and via grep that none is presented from another tier.

## Pattern (fixed by precedent)

Same as Phase 1 / Cook / Purchasing / BEO. One new wrinkle this tier introduces:
**`InventoryParView.swift` is the first file in this sweep to use `.swipeActions` and
`.contextMenu`.** Both are SwiftUI modifiers, not visually-nested child views — VoiceOver
exposes their content as custom actions/a menu, entirely independent of whatever
`.accessibilityElement(children: .combine)` scope is applied to the row itself. Applying
`.combine` to a row's informational `HStack`/`VStack` while leaving `.swipeActions`/
`.contextMenu` as sibling modifiers on that same container does **not** nest an
interactive control inside the combined element — it's a structurally different
situation from a `Button`/`Link` rendered as a child view. This reasoning is new to this
sweep; the final whole-branch review should give it explicit scrutiny.

## Confirmed real gaps

**Zero color-only signals** in this tier — every status badge (`InventoryParView`'s
"below par", `InventoryCountsView`'s "open"/"closed") already carries visible text, so
plain `.combine` (matching Purchasing tier's `notesBadges` precedent) is sufficient.

**One real button-labeling gap**: `InventoryParView`'s swipe-action and context-menu
"Remove" buttons (2 sites, same row) say only "Remove" with no item context — the same
class of gap fixed in `VendorCompareView.rowActions` (Purchasing tier).

**Everything else** is the familiar fragmented-row cleanup:
- `InventoryParView.parRow` — name + meta + badge fragments into up to 3 stops.
- `InventoryCountsView` — 3 sites: the `countRow` "whole-row-is-a-button" (optional
  insurance, matching the established Button-auto-flattening precedent, plus hiding a
  purely decorative disclosure chevron from VoiceOver), the detail sheet's
  date+status-badge line, and `lineRow`'s ingredient+meta.
- `InventoryLogView.movementRow` — item/note-or-station/delta/direction fragments into
  up to 4 stops.
- `InventoryWasteView` — 2 sites: the inline "most wasted" item+count row, and
  `recentRow`'s item+meta+delta.

All `TextField`/`Picker` prompts across all 4 files' forms already supply their label as
the control's title parameter directly (no separate caption `Text` above them) — unlike
Purchasing tier's `VendorLinkView` "Staple name" gap, there is no field-label gap
anywhere in this tier.

## Dynamic-Type risk

**None found.** Confirmed by reading all 4 files in full — no fixed-`width` `Text`/label
columns exist in any multi-column row; every row uses `HStack` + `Spacer()` fluid layout,
not fixed frames. The only `.frame(minWidth:, minHeight:)` hits are sheet-size floors,
excluded per the established precedent (ceilings/floors on containers, not fixed-width
text columns).

## Complexity flags

All 4 files are small, single-task-sized:
- `InventoryParView.swift`: 1 row function + 2 button labels (the swipe/context-menu
  "Remove" gap).
- `InventoryCountsView.swift`: 3 fix sites (the `countRow` Button, the detail sheet's
  status line, `lineRow`), each a one-line addition — no split needed.
- `InventoryLogView.swift`: 1 fix site.
- `InventoryWasteView.swift`: 2 fix sites.

## Invariants

- Every touched interactive control (the two Remove buttons) has an unambiguous label
  naming its target.
- No interactive control rendered as a child view is ever nested inside a `.combine`
  block. `.swipeActions`/`.contextMenu` modifiers coexisting with `.combine` on the same
  container is explicitly not a violation of this rule (see Pattern section above).
- `swift build` stays clean after every task; the final task's scripted audit confirms
  all 4 files gained accessibility modifiers and the branch's diff touches exactly these
  4 files under `LariatNative/`.

## Open questions

None outstanding.

## Testing / acceptance

Per-task: `swift build` clean. Final task: scripted coverage audit (4 files) + scope-diff
check (exactly these 4 files) + mandatory final whole-branch review, mirroring
Phase 1/Cook/Purchasing/BEO precedent. The whole-branch review for this tier should pay
particular attention to the `.swipeActions`/`.contextMenu` reasoning in
`InventoryParView.swift`, since it's a structurally new situation for this sweep.
