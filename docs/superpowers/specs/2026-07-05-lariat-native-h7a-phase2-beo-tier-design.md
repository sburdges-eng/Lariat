# LariatNative H7a Phase 2 — BEO tier: VoiceOver + Dynamic-Type design

## Goal

Extend the VoiceOver accessibility + Dynamic-Type pattern established in H7a Phase 1
(PR #430) and continued in Phase 2's Cook (PR #432) and Purchasing (PR #433) tiers to
the 3 board views in the `.beo` `FeatureTier`. Same mechanism, same acceptance bar,
same review discipline.

## Non-goals

- **`PinEntrySheet.swift`** is out of scope, same reasoning as Purchasing tier (shared
  across 19 files, nearly every tier).
- **`EmptyState.swift` / `TileDegrade`** are out of scope — already accessible
  (`EmptyState` already carries `.combine`) and shared UI-kit primitives, not
  tier-specific views.
- The remaining tiers (inventory, foh, house, labor, shows, costing, manager) are
  separate future sub-projects.
- No extraction to `LariatModel`, no new dependency, no XCTest (none exists for
  `LariatApp` — `swift build` clean is the acceptance gate).
- No behavior change for a sighted user beyond the two necessary restructurings noted
  below (course-row combine wrap in `BeoBoardView.coursesPanel`; none elsewhere).

## Scope: 2 files get direct edits, 1 file gets zero edits by design

`BeoBoardView.swift` and `BeoPrepHistoryView.swift` receive accessibility modifiers.
**`BeoFireScheduleView.swift` receives ZERO direct edits** — its only rendered content
(`BeoFireStationSection`) is a `struct` declared in `BeoBoardView.swift` and explicitly
commented "Shared station block — also used by the standalone fire-schedule board."
Fixing that shared component once, where it's declared, fixes both call sites. This is
unlike `PinEntrySheet`/`CookIdentityPicker` (shared across many tiers, correctly
deferred) — `BeoFireStationSection` is shared *only within* this tier's 3 files, so
fixing it here is in-scope and correct, not a deferral.

**Implication for verification:** the scope-diff check for this tier expects exactly 2
changed files under `LariatNative/`, not 3 — `BeoFireScheduleView.swift` staying at zero
diff lines is the correct, expected outcome, not a gap.

Confirmed via `grep` that none of the 3 views is presented from another tier's board.

## Pattern (fixed by precedent, not re-derived here)

Same as Phase 1 / Cook / Purchasing:
1. Wrap read-only composite info in `.accessibilityElement(children: .combine)` + a
   hand-written `.accessibilityLabel(...)` verbalizing color-only signals.
2. Interactive controls stay siblings, never nested inside a `.combine` block.
3. Action buttons name their target.
4. Fixed-`width` `Text` columns → `minWidth`; `maxWidth`/`maxHeight` ceilings on
   TextField/ScrollView/Picker are not a Dynamic-Type risk.
5. "Currently selected/recorded" state conveyed by color/icon alone reuses the
   established `.accessibilityAddTraits(condition ? [.isSelected] : [])` idiom
   (`DatapackSearchView.swift:86`) — not reused in this tier (no such gap found), noted
   for completeness only.
6. Where a field's visible caption isn't wired as its accessible name (falls back to an
   example-value placeholder), add an explicit `.accessibilityLabel` naming the field —
   established in Purchasing tier's `VendorLinkView` "Staple name" fix.

## Confirmed real gaps

**1 genuine Dynamic-Type risk** — the sweep's first in Phase 2: `BeoBoardView.
BeoLineRowEditor`'s line-total dollar `Text` uses `.frame(width: 80, alignment:
.trailing)` in a dense ITEM/COURSE/TIME/COST/QTY/TOTAL row — a real clipping risk at
larger accessibility text sizes. Fix: `width: 80` → `minWidth: 80`.

**1 genuine color-only signal**: `BeoFireStationSection`'s course fire-time `Text` color
(green/yellow/red via the existing `color(for bucket:)` function) is the ONLY carrier of
on-time/due-soon/overdue status — no spoken equivalent. Fix reuses the file's existing
`color(for bucket:)` switch by adding a sibling `statusLabel(for bucket:)` function
rather than duplicating logic or inventing a new type (no pre-existing `Tone`/status enum
exists in this file to reuse instead).

**1 field-label gap class, fixed once for 6 fields**: `BeoBoardView.
BeoEventHeaderEditor.labeled()` is a single shared helper behind 6 header fields (Date,
Time, Contact, Covers, Min spend, Notes) whose visible captions aren't wired as
accessible names — VoiceOver falls back to example-value placeholders ("YYYY-MM-DD",
"5-7pm", "0"). Because all 6 route through one helper, fixing the helper once covers all
6 uniformly.

**1 field-label gap, distinct from the above**: `BeoBoardView.BeoLineRowEditor`'s
Tax-rate and Service-fee `CommitTextField`s have ambiguous own-placeholder accessible
names ("rate", "%") with no field-identifying label. Fixed via a direct
`.accessibilityLabel` on each field (not a `.combine` wrap, since these fields are
interactive controls, not read-only info — wrapping them would risk the nested-control
defect).

**Everything else** (9 more zones across `BeoBoardView.swift`, 2 zones in
`BeoPrepHistoryView.swift`) is the familiar fragmented-row cleanup: `partyRow`,
`invoiceRow`/totals, `coursesPanel` rows, `BeoOrderGuidePanel` grid rows,
`BeoPrepDemandsPanel` rows, `BeoRecipeTreePanel.itemCard` badges,
`BeoPrepHistoryView.historyRow` and its recent-events block. 3 further sites
(`menuPanel`'s catalog-row Button, `RecipeNodeRow.header`, the order-time field's single
placeholder) are flagged as optional/lower-confidence insurance, matching the
established precedent for Button-auto-flattening cases — not confirmed defects.

Two pre-existing accessibility modifiers in `BeoBoardView.swift` (course-delete Button
label at the current `coursesPanel`, and a "Remove line" Button label in
`BeoLineRowEditor`) must be preserved exactly as-is; new fixes wrap the surrounding
info, not these buttons.

## Dynamic-Type risk — full inventory

All 22 `.frame(width:|minWidth:|maxWidth:)` hits in `BeoBoardView.swift` were checked
individually. Exactly one is a genuine fixed-width `Text` column (above). Everything
else is a decorative divider/selection bar, a panel/sidebar region width, a form
ceiling, or a fixed width on an interactive control (TextField/Picker) — the last
category excluded per the Purchasing-tier `countField` precedent (controls scroll/adapt
rather than clip). `BeoFireScheduleView.swift` and `BeoPrepHistoryView.swift` have zero
fixed-width `Text` columns.

## Complexity flags

- **`BeoBoardView.swift` (1089 lines) — by far the largest file in this sweep, split
  into 2 sequential tasks by concern**, both editing the same file:
  - **Part A (editing surface):** `partyRow`, `invoiceRow`/totals footer, Tax/Service-fee
    field labels, `coursesPanel` rows, `BeoEventHeaderEditor.labeled()` (6-field fix),
    `BeoLineRowEditor` (the Dynamic-Type fix + optional `menuPanel` insurance).
  - **Part B (read-only reference panels):** `BeoOrderGuidePanel`, `BeoPrepDemandsPanel`,
    `BeoFireStationSection` (the color-only-signal fix, shared with
    `BeoFireScheduleView.swift`), `BeoRecipeTreePanel.itemCard`, optional
    `RecipeNodeRow.header` insurance.
  - These two tasks must run strictly sequentially (Part B builds on Part A's commit),
    never in parallel, since they touch the same file.
- **`BeoFireScheduleView.swift`**: zero direct edits — inherits Part B's fix. Not its
  own implementation task; verified as part of Part B's acceptance and the final
  scope-diff check.
- **`BeoPrepHistoryView.swift` (168 lines)**: small, single task, 2 trivial
  trailing-`.combine` fixes, no Dynamic-Type risk.

## Invariants

- Every touched interactive control has an unambiguous label naming its target or field
  identity.
- Every status-bearing element relying on color alone now also verbalizes its state.
- No interactive control is ever nested inside a `.combine` block.
- The two pre-existing `BeoBoardView.swift` accessibility labels remain byte-for-byte
  unchanged.
- `swift build` stays clean after every task; the final task's scripted audit confirms
  `BeoBoardView.swift` and `BeoPrepHistoryView.swift` each gained accessibility
  modifiers, and the branch's diff touches exactly these 2 files under `LariatNative/`
  (NOT `BeoFireScheduleView.swift`, which is expected to show zero diff lines).

## Open questions

None outstanding.

## Testing / acceptance

Per-task: `swift build` clean. Final task: scripted coverage audit (2 files, not 3) +
scope-diff check (exactly `BeoBoardView.swift` + `BeoPrepHistoryView.swift` changed) +
mandatory final whole-branch review, mirroring Phase 1/Cook/Purchasing precedent. The
whole-branch review for this tier should pay particular attention to the two-task split
on `BeoBoardView.swift` — confirm Part A and Part B's fixes don't conflict or duplicate
work in the same functions, and confirm the shared `BeoFireStationSection` fix in Part B
correctly benefits `BeoFireScheduleView.swift` without that file needing its own edits.
