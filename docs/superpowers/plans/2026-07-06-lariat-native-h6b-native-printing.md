# LariatNative H6b — Native printing: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans, task-by-task. Steps use checkbox (`- [ ]`).
> Each `*PrintCompute` is a PURE function with a real unit-test target — follow
> superpowers:test-driven-development: failing test → minimum implementation → green →
> wire the view → commit.

**Goal:** Add native `NSPrintOperation` printing to 4 boards (purchasing order guide, prep
par, bar+inventory par, BEO), generalizing the shipped settlement-print pattern. Each task
adds one pure `*PrintCompute.renderText` in `LariatModel` (with unit tests, oracle =
`SettlementPrintComputeTests`) + Copy/Print/preview wiring on the board copied from
`ShowSettlementView`.

**Architecture:** `LariatApp` (SwiftUI/AppKit view + toolbar buttons + preview sheet) →
`LariatModel/Compute/*PrintCompute` (pure `renderText`). AppKit print plumbing
(`NSTextView` + `NSPrintOperation`) is `#if canImport(AppKit)`-guarded, byte-copied from
`ShowSettlementView.printSettlement`. No `LariatDB`/schema changes.

**Tech Stack:** SwiftUI + AppKit (macOS), GRDB already present (untouched here). No new deps.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-06-lariat-native-h6b-native-printing-design.md`.
- **Template to copy (read these first, every task):** `Sources/LariatApp/ShowSettlementView.swift`
  (`printSettlement` ~:246-258, the Copy/Print toolbar + `showPrintPreview` sheet ~:204-244),
  `Sources/LariatModel/Compute/SettlementPrintCompute.swift` (the `renderText`/`line`/`dollars`
  helpers), `Tests/LariatModelTests/SettlementPrintComputeTests.swift` (the test shape).
- **No schema / DB / GRDB changes.** Renderers are pure over already-loaded board data. Zero
  migrations. If a board doesn't already hold the data synchronously in its ViewModel, that
  board is out of scope for this wave (do not add a fetch to the print path).
- **Money is never re-derived.** BEO totals reuse `BeoWorksheetCompute.totals(...)`; settlement
  stays Int-cents; par/guide reuse the boards' existing dollar formatting. A renderer that
  recomputes money is a defect.
- **No I/O, no async, no subprocess inside any `renderText`** — pure functions only. (This is
  why the BEO cascade / `BeoCascadeClient` python path is explicitly excluded — never call it
  from a renderer.)
- **Line numbers below are locators from the read-only audit, not guaranteed exact** — read the
  board's View + ViewModel + its `*Records` type to confirm exact field names before writing a
  renderer; do NOT enshrine unverified field names from this plan verbatim (Phase-1 §3 lesson).
- Strictly additive to each board: preserve existing comments/lines; the print additions are
  new toolbar items + a preview sheet + a static print func, mirroring settlement.
- No XCTest target exists for `LariatApp` — **view wiring's acceptance is `swift build` clean**;
  the **compute's acceptance is `swift test`** (the pure renderer IS unit-tested). State this
  per task rather than claiming "TDD throughout" for the view layer.
- **Commit tooling:** every commit MUST run with `AGENT_NAME=claude` (the MACP guardrail
  defaults to "gemini" otherwise). The worktree already has `node_modules` symlinked so the
  pre-commit typecheck gate resolves `tsc`.
- **Task ordering:** simplest first (order guide) → BEO last (most fields + totals reuse).
- Worktree: build/test from
  `/Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h6b-printing/LariatNative`;
  git from the worktree root.

### Per-task scope guard (before each commit)

```bash
git add <the 2-3 intended paths>
git diff --cached --name-only   # confirm ONLY the intended Compute + test + one View file
```
Confirm zero `LariatDB`/schema files and zero unrelated boards are staged.

---

### Task 1: Purchasing order-guide print (simplest)

**paths_touched:** `LariatNative/Sources/LariatModel/Compute/PurchasingOrderGuidePrintCompute.swift` (new),
`LariatNative/Tests/LariatModelTests/PurchasingOrderGuidePrintComputeTests.swift` (new),
`LariatNative/Sources/LariatApp/PurchasingOrderGuideView.swift` (modify).
**MUST NOT modify:** `PurchasingOrderGuideViewModel` logic, any repository/schema, other boards.

Read `PurchasingOrderGuideView.swift` + `PurchasingOrderGuideViewModel.swift` + the
`OrderGuideSummary`/`EnrichedOrderGuideRow` record to confirm exact fields (audit reported:
ingredient, baseQty, unit, vendor, unitPrice + preferred/locked/mismatch flags; ≤200 rows).

- [ ] **Step 1 (TDD red):** create `PurchasingOrderGuidePrintCompute` with `renderText(_ summary:) -> String` returning `""`; write `PurchasingOrderGuidePrintComputeTests` asserting: a title/date header line, one aligned row per line item (ingredient + qty+unit + vendor + price), a non-empty-vs-empty case, and money/number formatting. Run `swift test` → confirm it FAILS on assertions (not a compile error).
- [ ] **Step 2 (green):** implement `renderText` using settlement's `line`/`dollars` style (monospaced aligned columns; reuse the board's existing price/qty formatting — do not re-derive). Re-run `swift test` → green.
- [ ] **Step 3 (view wiring):** add Copy/Print toolbar buttons + a `showPrintPreview` sheet to `PurchasingOrderGuideView`, byte-copying `ShowSettlementView`'s pattern (static `printOrderGuide(_:)` with `NSTextView` + `NSPrintOperation`, `#if canImport(AppKit)`). Both read the SAME `renderText`.
- [ ] **Step 4 (build):** `swift build` → `Build complete!`
- [ ] **Step 5 (commit):** scope-guard, then `AGENT_NAME=claude git commit -m "T1: purchasing order-guide native print (pure renderText + tests + Print/Copy/preview)"`

---

### Task 2: Prep-par print

**paths_touched:** `.../Compute/PrepParPrintCompute.swift` (new),
`.../Tests/LariatModelTests/PrepParPrintComputeTests.swift` (new),
`.../LariatApp/PrepParView.swift` (modify).
**MUST NOT modify:** `PrepParViewModel` logic, repositories/schema, other boards.

Read `PrepParView.swift` + `PrepParViewModel.swift` + the `PrepParBoardSnapshot`/`PrepParRow`
record for exact fields (audit: recurring prep targets grouped by station — recipe/ingredient,
station, targetQty, unit, note).

- [ ] **Step 1 (TDD red):** `PrepParPrintCompute.renderText(_ snapshot:) -> String` stub `""`; tests assert station grouping headers, one row per prep target (label + target qty+unit + station + note), and an empty state. `swift test` → red.
- [ ] **Step 2 (green):** implement grouped monospaced render. `swift test` → green.
- [ ] **Step 3 (view wiring):** Copy/Print/preview on `PrepParView`, settlement pattern.
- [ ] **Step 4:** `swift build` → `Build complete!`
- [ ] **Step 5:** `AGENT_NAME=claude git commit -m "T2: prep-par native print"`

---

### Task 3: Bar-par + Inventory-par print (shared renderer)

**paths_touched:** `.../Compute/ParPrintCompute.swift` (new),
`.../Tests/LariatModelTests/ParPrintComputeTests.swift` (new),
`.../LariatApp/BarParView.swift` (modify), `.../LariatApp/InventoryParView.swift` (modify).
**MUST NOT modify:** the two ViewModels' logic, repositories/schema, other boards.

Read both `BarParView`/`BarParViewModel` + `BarParRow` and `InventoryParView`/`InventoryParViewModel`
+ `InventoryParWithOnHand` to confirm the shared shape (category-grouped par + on-hand +
below-par flag). Design `ParPrintCompute.renderText(title:groups:)` (or `(category:rows:)`)
general enough for BOTH — pass each board's already-loaded rows in; do not special-case one
board inside the renderer beyond a title/label param.

- [ ] **Step 1 (TDD red):** `ParPrintCompute` stub; `ParPrintComputeTests` assert category headers, one row per item (name + par + on-hand + a below-par marker), below-par marking, and empty state — with BOTH a bar-shaped and an inventory-shaped input if their row types differ (map each into a shared small input struct in the renderer, or two thin overloads sharing helpers). `swift test` → red.
- [ ] **Step 2 (green):** implement. `swift test` → green.
- [ ] **Step 3 (view wiring):** Copy/Print/preview on BOTH `BarParView` and `InventoryParView`, each passing its own rows to the shared renderer. Settlement pattern.
- [ ] **Step 4:** `swift build` → `Build complete!`
- [ ] **Step 5:** scope-guard (this task legitimately stages 4 files: the Compute, its test, and the 2 views), then `AGENT_NAME=claude git commit -m "T3: bar-par + inventory-par native print (shared ParPrintCompute)"`

---

### Task 4: BEO sheet print (most fields; reuses money compute)

**paths_touched:** `.../Compute/BeoPrintCompute.swift` (new),
`.../Tests/LariatModelTests/BeoPrintComputeTests.swift` (new),
`.../LariatApp/BeoBoardView.swift` (modify).
**MUST NOT modify:** `BeoWorksheetCompute` (REUSE its `totals`), `BeoBoardViewModel` logic,
`BeoCascadeClient`/cascade path (NEVER call it), repositories/schema, other boards.

Read `BeoBoardView.swift` + `BeoBoardViewModel.swift` + `Sources/LariatModel/BeoRecords.swift`
(`BeoEventRow`, `BeoLineItemRow`, `BeoCourseRow`) + `Compute/BeoWorksheetCompute.swift`
(`totals(lines:taxRate:serviceFeePct:) -> Totals`).

- [ ] **Step 1 (TDD red):** `BeoPrintCompute.renderText(event:lines:courses:totals:) -> String` stub `""`; tests assert event header (title/date/time/contact/guest count), one row per line item (item/category/qty/prep notes/course), fire-time/course section, and the money footer (subtotal/tax/fee/total) — **with `totals` passed in from `BeoWorksheetCompute.totals`, asserting the renderer does NOT recompute money**. Include an empty-lines case. `swift test` → red.
- [ ] **Step 2 (green):** implement, reusing settlement's money/line helpers; take `Totals` as a parameter (renderer never recomputes). `swift test` → green.
- [ ] **Step 3 (view wiring):** Copy/Print/preview on `BeoBoardView`, computing `totals` via the existing `BeoWorksheetCompute.totals` at the call site (same values the board already shows) and passing them + the loaded event/lines/courses into `renderText`. Settlement pattern. **Do NOT print cascade/order-guide/prep-demand data.**
- [ ] **Step 4:** `swift build` → `Build complete!`
- [ ] **Step 5:** `AGENT_NAME=claude git commit -m "T4: BEO sheet native print (header+lines+courses+totals; cascade excluded)"`

---

### Task 5: Final whole-branch review + verify (MANDATORY GATE)

- [ ] `swift build && swift test` from `LariatNative/` → `Build complete!` + 0 failures (capture the new test count vs main's 1008).
- [ ] Scope-diff: `git diff --name-only $(git merge-base origin/main HEAD)..HEAD` → only the new `Compute/*PrintCompute.swift` + their tests + the 4 touched view files + these 2 docs; **zero `LariatDB`/schema/`BeoCascadeClient` changes**.
- [ ] Whole-branch review (dispatch `reviewer`, opus — money surfaces) confirming as a set:
  (a) every `renderText` is PURE (no I/O/async/subprocess); (b) no renderer re-derives money —
  BEO reuses `BeoWorksheetCompute.totals`, settlement/par/guide reuse existing formatting;
  (c) preview + Copy + Print all read the SAME `renderText` per board; (d) all AppKit code is
  `#if canImport(AppKit)`-guarded; (e) `BeoCascadeClient`/python cascade is never called from a
  print path; (f) build+tests green.
- [ ] Fix any finding as its own commit; re-review if a renderer changed.

## Acceptance

`swift build && swift test` green (new `*PrintComputeTests` pass, mirroring
`SettlementPrintComputeTests`); scope-diff clean (no DB/schema/cascade); whole-branch review
passes. Manual print smoke test (non-gating, needs desktop session): print one new sheet and
confirm `NSPrintOperation` behaves like settlement's. On merge, note H6b done in the endgame /
handoff docs; next holistic-bar item is H6c (menu-bar extra + multi-window), then Phase C flip.
