# LariatNative H7a Phase 2 — FOH tier: VoiceOver + Dynamic-Type design

## Goal

Extend the VoiceOver accessibility + Dynamic-Type pattern established in H7a Phase 1
(PR #430) and continued in Phase 2's Cook (PR #432), Purchasing (PR #433), BEO (PR #434),
and Inventory (PR #435) tiers to the 4 board views in the `.foh` (Front of house)
`FeatureTier`.

## Non-goals

- **`CookIdentityPicker.swift`** (used in `FloorView`/`ReservationsBoardView`) and
  **`PinEntrySheet.swift`** (used in `HostStandView`) are out of scope, same reasoning as
  prior tiers — both shared across many tiers.
- **`TileDegrade.swift`** (reused in 79 files) and **`EmptyState.swift`** (reused in 38
  files, already carries `.accessibilityElement(children: .combine)` at
  `EmptyState.swift:18`) are shared UI-kit primitives, not tier-specific — out of scope.
- The remaining 4 tiers (house, labor, shows, costing, manager) are separate future
  sub-projects.
- No extraction to `LariatModel`, no new dependency, no XCTest (none exists for
  `LariatApp` — `swift build` clean is the acceptance gate).
- No behavior change for a sighted user beyond the two necessary wrapper restructurings
  noted below (`FloorView.actionPanel`, `HostStandView.waitingRow`) — both are
  layout-neutral (matched spacing preserved).

## Scope: 4 files

`FloorView.swift`, `HostStandView.swift`, `ReservationsBoardView.swift`,
`BookingBoardView.swift` — all under `LariatNative/Sources/LariatApp/`. Confirmed via
`FohFeatures.swift`/`FeatureCatalog.swift` that this tier has exactly these 4 boards, and
via grep that none is presented from another tier.

**Three of the four files already carry one pre-existing accessibility modifier each**
(all `Button`-attached labels from earlier work, none a `.combine`) — every task must
preserve these exactly and must not duplicate their coverage:
- `FloorView.tableTile`'s Button: `.accessibilityLabel("Table \(table.id), \(statusLabel(table.status)), \(table.capacity) seats")`
- `ReservationsBoardView.reservationRow`'s delete Button: `.accessibilityLabel("Delete reservation for \(r.partyName)")`
- `BookingBoardView.header`'s "Next show" Button: `.accessibilityLabel("Next show: \(next.bandName). Open tonight's board.")`

`HostStandView.swift` has zero pre-existing modifiers.

## Pattern (fixed by precedent)

Same as Phase 1 / Cook / Purchasing / BEO / Inventory. This tier reuses two idioms
established in prior waves:
- The `.accessibilityAddTraits(condition ? [.isSelected] : [])` idiom
  (`DatapackSearchView.swift:86`) for `FloorView.tableTile`'s selection-state stroke.
- The "generic button repeated across many rows needs the item name" fix (established in
  Purchasing tier's `VendorCompareView.rowActions`) for the Seat/Left/No-show/Cancel/Done
  buttons in `HostStandView` and `ReservationsBoardView`.

## Confirmed real gaps

**One confirmed selection-state gap**: `FloorView.tableTile`'s selected-tile stroke
overlay is a border-only signal with no spoken equivalent — fixed via
`.accessibilityAddTraits`, reusing the established idiom.

**One confirmed Dynamic-Type risk — the only one in this tier**:
`BookingBoardView.showTable` has 6 fixed-`width` `Text` columns (Date/Price/Door, in
both the header row and every data row) in a dense multi-column table — a real clipping
risk. Fix: all 6 `width:` → `minWidth:`. Header row is left as 4 separate VoiceOver
stops (reading distinct one-word column labels individually is normal table-header
behavior, not a gap); each data row gets `.combine`. **Caveat, not a new risk**: because
each row is an independent `HStack` (not a shared-column `Grid`/`Table`), columns can
drift out of visual alignment across rows at very large Dynamic Type sizes — this is a
pre-existing architectural characteristic of the per-row-HStack design, not introduced
by this fix, and redesigning it into a shared-column grid is out of scope (no
restructuring beyond the `width`→`minWidth` swap and the `.combine` addition).

**Several confirmed button-naming gaps**, all the same class (generic label repeated
across every row in a list, ambiguous without item context):
- `HostStandView.waitingRow`'s "Seat"/"Left" buttons.
- `ReservationsBoardView.reservationRow`'s "Seat"/"No-show"/"Cancel"/"Done" buttons (the
  row's existing delete-button label is untouched).

**Everything else** is the familiar fragmented-row cleanup: `FloorView.actionPanel`'s
name+status line, `HostStandView.seatedSection` rows, `ReservationsBoardView.
reservationRow`'s info block, `BookingBoardView.pipelineSection`'s stage tiles.

**Verified NOT gaps** (explicitly checked, not just assumed):
- `FloorView.seatReservationSection`'s buttons — each Button's own label already embeds
  the party name via its compound Text content, so SwiftUI's default label-flattening
  already includes it; no fix needed.
- `ReservationsBoardView`'s left-edge green accent bar for seated status — decorative
  reinforcement of the already-combined status-capsule text, not a unique color-only
  signal.
- `BookingBoardView.pipelineSection`'s amber tint on late-stage tiles — the stage name
  itself (already spoken) already uniquely identifies the tile; the tint is decorative,
  not information-bearing on its own.
- Fixed-width `TextField`s in `HostStandView`/`ReservationsBoardView`'s add-forms
  ("Size", "Time", "Table") — these are input controls, not `Text` display columns; out
  of the Dynamic-Type risk category per established precedent.

## Complexity flags

- **`FloorView.swift`**: moderate, 3 sub-sites (`tableTile`'s trait, `actionPanel`'s
  fragmentation — needs a layout-neutral wrapper `VStack` since the two Texts currently
  sit flat among button-bearing siblings). One task, ~2 steps.
- **`HostStandView.swift`**: `waitingRow` needs a layout-neutral wrapper `HStack` (matched
  spacing) plus 2 button labels; `seatedSection` is a pure trailing-modifier one-liner.
  One task, 2 steps.
- **`ReservationsBoardView.swift`**: single function (`reservationRow`), but the most
  button-label fixes in the tier (4 new labels + 1 combine) — no restructuring needed,
  the info block is already an isolated container. One task, 1 step.
- **`BookingBoardView.swift`**: `showTable` is the tier's most complex single site (the
  only Dynamic-Type fix + fragmentation, 6 width changes + 1 combine) — recommend its
  own step separate from `pipelineSection`. One task, 2 steps.

## Invariants

- Every touched interactive control has an unambiguous label naming its target.
- The one status-bearing element relying on visual state alone (`FloorView.tableTile`'s
  selection stroke) now also exposes `.isSelected`.
- No interactive control is ever nested inside a `.combine` block.
- All 3 pre-existing accessibility labels (`FloorView`, `ReservationsBoardView`,
  `BookingBoardView`) remain byte-for-byte unchanged.
- `swift build` stays clean after every task; the final task's scripted audit confirms
  all 4 files gained accessibility modifiers and the branch's diff touches exactly these
  4 files under `LariatNative/`.

## Open questions

None outstanding.

## Testing / acceptance

Per-task: `swift build` clean. Final task: scripted coverage audit (4 files) + scope-diff
check (exactly these 4 files) + mandatory final whole-branch review, mirroring
Phase 1/Cook/Purchasing/BEO/Inventory precedent. The whole-branch review for this tier
should confirm the 3 pre-existing labels are untouched, and confirm the two wrapper
restructurings (`FloorView.actionPanel`, `HostStandView.waitingRow`) are genuinely
layout-neutral and don't trap a Button inside the new `.combine` scope.
