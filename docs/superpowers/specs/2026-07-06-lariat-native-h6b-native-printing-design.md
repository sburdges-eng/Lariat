# LariatNative H6b — Native printing: design

## Goal

Give the native macOS app real `NSPrintOperation` printing for the operational sheets a
restaurant physically hands out — BEO event sheets, purchasing order guides, and par/prep
sheets — so the team no longer has to fall back to the web app / browser print. This
generalizes the **already-shipping settlement-print pattern** (`ShowSettlementView` +
`SettlementPrintCompute`, 12 parity tests) to the remaining printable boards, one board at
a time, with the pure text renderer living in `LariatModel` as the single source of truth
and the AppKit print plumbing mirroring settlement exactly.

## The proven template (reference implementation — no new work)

Settlement is already fully printable and is the pattern every new sheet copies:

- `SettlementPrintCompute.renderText(_ summary:) -> String` (in `LariatModel/Compute/`) — a
  **pure** function that builds a monospaced text block via shared `line(label,value)` (fixed
  label column) + `dollars(cents)` helpers. Unit-tested in
  `Tests/LariatModelTests/SettlementPrintComputeTests.swift` (12 tests).
- `ShowSettlementView` (in `LariatApp`) wires it three ways off the SAME `renderText`: a
  print-preview sheet (`Text(renderText(s)).font(.system(.callout, design:.monospaced))`), a
  toolbar **Copy** button (→ `NSPasteboard`), and a toolbar **Print** button →
  `printSettlement(_:)`, which builds an `NSTextView`, sets `.string = renderText(s)` +
  monospaced font, and runs `NSPrintOperation(view:)` with print+progress panels. All AppKit
  code is `#if canImport(AppKit)`-guarded.

Every new sheet in this spec follows exactly this shape: **new pure `*PrintCompute.renderText`
in LariatModel (+ unit tests) → Copy/Print/preview wiring on the board, copied from
settlement.** No new idiom is introduced.

## Scope: 4 print tasks (settlement already done)

Each task = one pure `*PrintCompute.renderText` + LariatModel unit tests + Print/Copy/preview
wiring on the board. Ordered simplest → most complex:

1. **Purchasing order guide** — `PurchasingOrderGuideView`. Simplest: read-only, no PIN,
   synchronous already-loaded `OrderGuideSummary` rows (ingredient, baseQty, unit, vendor,
   unitPrice + preferred/locked/mismatch flags), ≤200 rows.
2. **Prep par** — `PrepParView`. Standing prep targets grouped by station (recipe/ingredient,
   station, targetQty, unit, note) — a printable "what to always keep prepped" checklist.
3. **Bar par + Inventory par** — `BarParView` and `InventoryParView`. Near-identical par +
   on-hand + below-par tables; one **shared `ParPrintCompute.renderText(category:rows:)`**
   drives both (avoid two bespoke renderers).
4. **BEO sheet** — `BeoBoardView`. New `BeoPrintCompute.renderText(event, lines, courses,
   totals)`: event header (title/date/time/contact/guest count/notes), prep-sheet line items
   (item/category/qty/prep notes/course), fire times/courses, and money totals **reusing the
   existing `BeoWorksheetCompute.totals(lines:taxRate:serviceFeePct:)`** (never re-derived).
   Money is `Double` dollars with `roundMoney` (JS `Math.round` parity, already tested).

## Non-goals

- **No schema / DB / GRDB changes.** These are read-only renderers over data the boards
  already hold in memory. Zero migrations.
- **The BEO order-guide / prep-demand cascade is OUT of the print path.** That data comes from
  `BeoCascadeClient` spawning a `python3 scripts/beo_cascade_cli.py` subprocess (≤15s timeout)
  — async, subprocess-dependent, and potentially slow. The printable BEO sheet prints only the
  synchronous, already-loaded event header + prep-lines + courses + totals. Printing the
  cascade order-guide is deferred to a follow-up. (The purchasing order guide is separately
  printable via task 1, so order-guide data is still printable — just from its own board.)
- **No global File→Print `⌘P` command this wave.** A global ⌘P needs a
  `FocusedValue`/`FocusedSceneValue` "current board's print action" that no board registers
  today (`LariatApp.swift`'s `.commands` block has no focused-board plumbing). Deferred until
  ≥2–3 boards are printable and the plumbing earns its cost. Each board gets its own Print
  toolbar button this wave (the settlement pattern — self-contained, no app-shell changes).
- **`PrepView` (the live cook task board) is excluded.** It's a live claim/start/done queue
  behind PIN/cook-identity writes; a printout goes stale the instant a task changes. A
  "snapshot today's open prep tasks" print is a distinct, smaller future ask if wanted.
- No new dependency, no cloud, no hidden paths.

## User-facing surface

Each in-scope board gains (behind a print-preview sheet, mirroring settlement):
- a **Print** toolbar button → `NSPrintOperation` on the rendered monospaced text;
- a **Copy** toolbar button → the same text to the pasteboard;
- a **Print preview** affordance opening the sheet with Copy/Print/Done.

The printed sheet is monospaced plain text (AppKit auto-paginates long sheets). Example shape
(order guide): a title/date header, then one aligned row per line item, then any footer.

## Data model deltas

None. Four new **pure compute types** in `LariatModel/Compute/`:
`PurchasingOrderGuidePrintCompute`, `PrepParPrintCompute`, `ParPrintCompute`, `BeoPrintCompute`
— each a `renderText(...)` (+ small shared `line`/`dollars` style helpers, or reuse
settlement's if they're already file-local-shareable). No new records/tables/columns.

## Invariants

- **`renderText` is the single source of truth** for each sheet — preview, Copy, and Print all
  read the same string. No parallel formatting.
- **Money is never re-derived in a renderer.** BEO totals reuse `BeoWorksheetCompute.totals`;
  settlement stays Int-cents; par/guide dollars reuse the boards' existing formatting helpers.
- **No subprocess, no I/O, no async in any `renderText`** — pure functions over already-loaded
  data (this is what keeps the print path fast and testable, and why the BEO cascade is out).
- All AppKit print code stays `#if canImport(AppKit)`-guarded, matching settlement.
- Each new `renderText` gets LariatModel unit tests modeled on `SettlementPrintComputeTests`
  (field presence, money formatting, alignment, empty state).

## Open questions (for the halt)

1. **Line-sheet scope.** This spec includes all 4 boards (BEO + order guide + prep par +
   bar/inventory par). Acceptable to trim to a **core** slice (BEO + purchasing order guide)
   and fast-follow the par sheets? Recommendation: keep all 4 — they're small and share one
   renderer pattern.
2. **BEO print contents.** Confirm the deferral is right: print the event header + prep-lines +
   courses + totals, but NOT the cascade order-guide/prep-demands (subprocess). Recommendation:
   defer the cascade; it's the one nondeterministic/slow path.
3. **⌘P deferral.** Confirm per-board Print buttons this wave, global ⌘P later. Recommendation:
   yes, defer ⌘P.

## Testing / acceptance

- Per new compute: LariatModel unit tests (`swift test` from `LariatNative/`), mirroring
  `SettlementPrintComputeTests`. This is the real automated gate — the compute is pure and
  fully testable.
- Per view wiring: `swift build` clean (no XCTest target exists for `LariatApp`), plus the
  Copy/Print/preview buttons present and gated by `#if canImport(AppKit)`.
- **One manual print smoke test** (non-gating, needs a desktop session): confirm `NSPrintOperation`
  behaves the same for a new sheet as for settlement. Settlement already prints in the shipped
  app, so the AppKit/bundle path is effectively proven (unlike H6a notifications, which needed
  real bundle identity — no equivalent constraint found for `NSPrintOperation`); this smoke test
  is belt-and-suspenders.
- Final: full `swift build && swift test` green; a whole-branch review confirming every renderer
  reuses existing money compute and no `renderText` does I/O.
