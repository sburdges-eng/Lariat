# LariatNative H7a Phase 2 — Costing tier: VoiceOver labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VoiceOver labels, verbalize the 3 confirmed color-only signals (plus 1
medium-confidence candidate carrying an explicit fallback), and fix the 4 confirmed
Dynamic-Type risks across the 8 `.costing`-tier board views — the largest tier by line
count in the whole sweep (~3100 lines across 8 files).

**Architecture:** Per-file, inline `.accessibilityElement(children: .combine)` +
`.accessibilityLabel(...)` additions matching `SanitizerView.swift`'s house pattern — no
extraction to `LariatModel`, no new types, no new dependency. Several zones need a
layout-neutral wrapper to isolate read-only info from a sibling interactive control;
everything else is a trailing modifier. Two files (`IngredientMastersView.swift`,
`DishComponentsView.swift`) sit in front of a write path — every fix in those two files
touches only the `View`'s accessibility metadata, never the write/validation/audit logic.

**Tech Stack:** SwiftUI (macOS), no new packages. Swift Charts is already a dependency
(used by `PriceShocksView.swift` and `CostingView.swift` today) — not newly introduced.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-costing-tier-design.md`.
- No new dependency (this codebase has exactly one — GRDB — today).
- No extraction of accessibility-label strings into `LariatModel` — inline in the View
  body, matching `SanitizerView.swift:73`.
- **No `LariatModel`/compute changes of any kind.** `IngredientMastersView.swift` fronts a
  regulated write surface (in-transaction audited write, `audit_events`,
  `actor_source=native_mac`, 3 quality-lock validation rules) — its write/validation/audit
  logic lives entirely in `IngredientMastersViewModel.swift` and
  `LariatDB/IngredientMastersRepository.swift`, confirmed by reading both in full; this
  plan touches only the one Button that triggers the write, never the write itself.
  **`DishComponentsView.swift` also performs writes** (`saveAll`/`delete`, backed by
  `LariatDB/DishComponentsRepository.swift`) — same discipline applies, even though it
  isn't "the" regulated write surface the way `IngredientMastersView` is.
  **Important file-layout note discovered during planning:** unlike
  `IngredientMastersViewModel`, which lives in its own file, `DishComponentsViewModel` is
  declared *inside* `DishComponentsView.swift` itself (lines 1-259, ending right before
  `// MARK: - Root view`) — there is no standalone `DishComponentsViewModel.swift`. A
  whole-file "zero diff" check is therefore meaningless for it; Task 7 and Task 9 instead
  verify no changed diff hunk in `DishComponentsView.swift` starts before line 260 (i.e.
  everything touched is inside the `View` struct, never the `@Observable` class above it).
- No XCTest is possible for this work — `LariatApp` has no test target. Acceptance per
  task is `swift build` clean. The final task runs a scripted coverage + scope audit.
- **`TileDegrade.swift`, `EmptyState.swift` are out of scope** — shared cross-tier/app-wide
  components.
- The remaining tier (manager) is out of scope — do not touch any file outside the 8
  named below.
- **One pre-existing duplication is NOT consolidated by this plan:** `variancePctColor` in
  `CostingView.swift` is independently declared in both `VarianceSection` and
  `RecipeCostVarianceSection` (same red≥5%/yellow 2-5%/green<2% thresholds, two separate
  private funcs). This predates this sweep; consolidating it is a refactor, not an
  accessibility fix. This plan's new `variancePctToneWord` helpers deliberately mirror
  that pre-existing duplication (one copy per struct) rather than introduce a new,
  inconsistent pattern by only de-duplicating the new helper.
- **Line ranges below are locators from the pre-implementation audit, not guaranteed
  exact** — if a file has drifted, locate the named function/struct by name.
- **Strictly additive discipline:** a prior task in this sweep (Cook tier's T4) deleted
  2 pre-existing comments as an unintended side effect of "matching the brief exactly."
  Every task below must preserve every pre-existing comment/line not directly touched by
  its named fix.
- **Commit tooling note:** the MACP file-claim guardrail (`scripts/check-session-branch.mjs`)
  defaults to treating the committer as agent `"gemini"` unless `AGENT_NAME` is set.
  Every commit step below MUST be run with `AGENT_NAME=claude` set, e.g.
  `AGENT_NAME=claude git commit -m "..."`.
- **Task ordering:** smallest/simplest first (`MarginDeltasView`), largest/most complex
  last (`CostingView`, split into 2 sub-commits), mirroring every precedent tier in this
  sweep.
- Worktree path for every `swift build`/git command below:
  `/Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-costing/LariatNative`
  (build) / the parent repo root (git commands operating on `LariatNative/...` paths).

---

### Task 1: `MarginDeltasView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/MarginDeltasView.swift` (`MarginDeltaRowView`
  ~159-223)

**Interfaces:** Self-contained. Calls the shared `fmtPct` (declared in
`PriceShocksView.swift`, reused here — not redefined) and the file-local
`marginDeltaDate`/`formatDollars` helpers; none of those change.

Smallest, most trivial file in the tier. One zone: `MarginDeltaRowView`'s row (dish name,
baseline→latest price + date range, top-3 contributors, trailing delta%) needs
`.accessibilityElement(children: .combine)` + a custom `.accessibilityLabel`. No
interactive controls live in this struct (the 2 `Picker`s are in the parent
`MarginDeltasContentView`, already fine — both have visible titles). The
red-up/green-down tone bar is confirmed **reinforcement only**: `direction` is a pure
function of `deltaPct`'s sign, and `fmtPct` already prepends an explicit `+`/`-` that
VoiceOver reads aloud (same reasoning as `ShowSettlementView.netDoorSection`) — no tone
word needed. No Dynamic-Type risk: the only fixed-size element is the decorative 3pt tone
bar, a `RoundedRectangle` (a `Shape`, not `Text`).

- [ ] **Step 1: Fix `MarginDeltaRowView`**

```swift
private struct MarginDeltaRowView: View {
    let row: MarginDeltaRow

    /// up = per-serving cost INCREASED = bad/red; down = cheaper = good/green
    /// (page.jsx L143: tone = direction === 'up' ? 'red' : 'green').
    private var tone: Color { row.direction == .up ? LariatTheme.bad : LariatTheme.ok }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(tone)
                .frame(width: 3)

            VStack(alignment: .leading, spacing: 4) {
                Text(row.dishName)
                    .font(.headline)

                // baseline → latest, 4-decimal vendor-price surface (page L163-167).
                HStack(spacing: 4) {
                    Text(formatDollars(row.baselineCost, decimals: 4))
                        .monospacedDigit()
                    Text(marginDeltaDate(row.baselineAt))
                        .foregroundStyle(.secondary)
                    Text("→")
                        .foregroundStyle(.secondary)
                    Text(formatDollars(row.latestCost, decimals: 4))
                        .monospacedDigit()
                    Text(marginDeltaDate(row.latestAt))
                        .foregroundStyle(.secondary)
                }
                .font(.caption)

                // Top 3 contributing vendor SKUs (helper's own ranking — not
                // re-ranked here, page L168-184).
                if !row.topContributors.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        // Key mirrors page.jsx `${vendor}|${sku}|${ingredient}`.
                        ForEach(Array(row.topContributors.enumerated()), id: \.offset) { _, c in
                            HStack(spacing: 4) {
                                Text("•")
                                Text("\(c.vendor) · \(c.sku) · \(c.ingredient)")
                                Text(fmtPct(c.contributionPct))
                                    .fontWeight(.semibold)
                                    .monospacedDigit()
                                    .foregroundStyle(c.contributionPct >= 0 ? LariatTheme.bad : LariatTheme.ok)
                            }
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(fmtPct(row.deltaPct))
                .font(.system(.title3, design: .rounded))
                .fontWeight(.heavy)
                .monospacedDigit()
                .foregroundStyle(tone)
                .frame(minWidth: 80, alignment: .trailing)
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(rowAccessibilityLabel)
    }

    /// Verbalizes dish name, baseline→latest price move (with dates), top
    /// contributors, and delta% as one VoiceOver stop. No tone word: `tone`
    /// is a pure function of `deltaPct`'s sign and `fmtPct` already signs the
    /// value (same reasoning as `ShowSettlementView.netDoorSection`).
    private var rowAccessibilityLabel: String {
        var parts = [row.dishName]
        parts.append(
            "\(formatDollars(row.baselineCost, decimals: 4)) on \(marginDeltaDate(row.baselineAt))"
            + " to \(formatDollars(row.latestCost, decimals: 4)) on \(marginDeltaDate(row.latestAt))")
        if !row.topContributors.isEmpty {
            let contributors = row.topContributors.map { c in
                "\(c.vendor) \(c.sku) \(c.ingredient) \(fmtPct(c.contributionPct))"
            }.joined(separator: ", ")
            parts.append("top contributors: \(contributors)")
        }
        parts.append("\(fmtPct(row.deltaPct)) change")
        return parts.joined(separator: ", ")
    }
}
```

Only the trailing `.accessibilityElement(children: .combine)` +
`.accessibilityLabel(rowAccessibilityLabel)` on the outer `HStack`, and the new
`rowAccessibilityLabel` computed property, are new.

- [ ] **Step 2: Build**

Run: `cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-costing/LariatNative && swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/MarginDeltasView.swift
AGENT_NAME=claude git commit -m "T1: MarginDeltasView — combine row, verbalize dish/price-move/contributors/delta"
```

---

### Task 2: `IngredientMastersView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/IngredientMastersView.swift` (`table`'s
  `"Action"` `TableColumn` ~115-121)

**Interfaces:** Self-contained. **Regulated write surface — do not touch
`IngredientMastersViewModel.swift` or `LariatDB/IngredientMastersRepository.swift`.**

Small file (124 lines), a `Table` with 6 read-only `TableColumn`s (Master/Canonical
name/Category/Pref. vendor/VP/BOM/Reviewed) plus one `TableColumn("Action")` holding a
`Button("Mark reviewed")` that calls `Task { await vm.markReviewed(masterId: row.masterId) }`.
The ONLY fix: add `.accessibilityLabel("Mark \(row.canonicalName) reviewed")` to that
`Button` — nothing else changes, not even the existing `.disabled`/`.help` modifiers. The
write/validation/audit logic lives entirely in `IngredientMastersViewModel.markReviewed`
and `IngredientMastersRepository` — never touched here. No Dynamic-Type risk: `Table`
columns aren't fixed-width `Text`, and the search `TextField` already uses `minWidth`.

- [ ] **Step 1: Fix the `"Action"` `TableColumn`**

```swift
TableColumn("Action") { row in
    Button("Mark reviewed") {
        Task { await vm.markReviewed(masterId: row.masterId) }
    }
    .disabled(vm.isSaving || !vm.canWrite)
    .help(vm.canWrite ? "Stamp last_reviewed = now" : "Write database unavailable — read-only")
    .accessibilityLabel("Mark \(row.canonicalName) reviewed")
}
```

Only the trailing `.accessibilityLabel(...)` line is new. The `.disabled`/`.help`
modifiers and every other column are byte-for-byte unchanged.

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Mandatory extra verification — no write/validation/audit changes**

```bash
cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-costing
git diff --quiet HEAD~1 -- LariatNative/Sources/LariatApp/IngredientMastersViewModel.swift \
  && git diff --quiet HEAD~1 -- LariatNative/Sources/LariatDB/IngredientMastersRepository.swift \
  && echo "CONFIRMED — zero diff in IngredientMastersViewModel.swift and IngredientMastersRepository.swift" \
  || { echo "UNEXPECTED — write/validation/audit logic changed; investigate before treating this task as done"; exit 1; }
```

Expected: `CONFIRMED — zero diff in IngredientMastersViewModel.swift and
IngredientMastersRepository.swift`. This commit must touch exactly one file
(`IngredientMastersView.swift`).

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/IngredientMastersView.swift
AGENT_NAME=claude git commit -m "T2: IngredientMastersView — label Mark-reviewed button per row"
```

---

### Task 3: `DepletionExceptionsView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/DepletionExceptionsView.swift`
  (`DepletionExceptionRow` ~124-200)

**Interfaces:** Self-contained. Reuses the existing `DepletionReasonTone` enum
(`LariatModel/DepletionReasonLabels.swift`, cases `.red`/`.blue`/`.yellow`) — no new type.

One restructuring zone. `DepletionExceptionRow`'s body has a `Button` (dish name,
navigates to `costing.components`; already gets a distinct per-row accessible name from
its own `Text` label — no fix needed there) followed by 3 read-only pieces (reason+detail
`HStack`, `metaLine` `Text`, optional "Periods" `Text`) that today are flat siblings of
the outer `VStack`. Wrap those 3 in a NEW inner `VStack(alignment: .leading, spacing: 4)`
— matching the outer `VStack`'s own spacing (layout-neutral) — with
`.accessibilityElement(children: .combine)` + a custom `.accessibilityLabel`. The
`Button` stays a sibling of the new inner `VStack`, never nested in its combine scope.
The trailing dollar `Text` stays untouched/separate (its value is already voiced via
`metaLine`'s "... net" phrase).

Color signal: `toneColor` (red/blue/yellow from `DepletionReasonLabels.tone`) is a
MEDIUM-CONFIDENCE candidate. Verified against `DepletionReasonLabels.swift`'s own doc
comment (lines 19-22): "red = blocking the dish entirely", "yellow = recipe-side data
gap", "blue = needs a density to convert volume↔weight" — so this fix includes tone-word
wording ("blocking this dish" / "recipe data gap" / "needs density conversion data" for
red/yellow/blue respectively). **This is a judgment call** — if the reviewer judges it
too speculative, the minimal safe fallback is to drop the custom label and keep only the
trailing combine (the default concatenated read is already in correct order: reason
label, detail, meta line, periods). No Dynamic-Type risk: the only fixed-size element is
a decorative 3pt `Rectangle` divider bar (a `Shape`, not `Text`).

- [ ] **Step 1: Fix `DepletionExceptionRow`**

```swift
private struct DepletionExceptionRow: View {
    let item: DepletionException
    let navigate: (String) -> Void

    private var tone: DepletionReasonTone { DepletionReasonLabels.tone(item.reason) }
    private var toneColor: Color {
        switch tone {
        case .red: return .red
        case .blue: return .blue
        case .yellow: return .yellow
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Rectangle()
                .fill(toneColor)
                .frame(width: 3)

            VStack(alignment: .leading, spacing: 4) {
                // Fix-it deep link (page.jsx L143-149): the dish name opens
                // the dish-components editor (`costing.components`). The web
                // link pre-fills ?dish=; native lands on the editor and the
                // operator picks the dish from Suggestions (no route-payload
                // channel yet — noted in the audit report).
                Button {
                    navigate("costing.components")
                } label: {
                    Text(item.dishName).font(.headline)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.blue)
                .help("Fix in dish components — add this dish's per-serving ingredients")

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Text(DepletionReasonLabels.label(item.reason))
                            .font(.caption)
                            .foregroundStyle(toneColor)
                        if let detail = item.detail {
                            Text("· \(detail)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .monospaced()
                        }
                    }

                    Text(metaLine)
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    if !item.samplePeriodLabels.isEmpty {
                        Text("Periods: \(item.samplePeriodLabels.joined(separator: ", "))")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(reasonAccessibilityLabel)
            }

            Spacer()

            Text(fmtMoney(item.totalNetSales))
                .font(.title3)
                .bold()
                .foregroundStyle(toneColor)
                .monospacedDigit()
        }
        .padding(.vertical, 6)
    }

    private var metaLine: String {
        let salesWord = item.affectedSalesCount == 1 ? "sales row" : "sales rows"
        var parts = ["\(item.affectedSalesCount) \(salesWord)", "\(fmtQty(item.totalQuantitySold)) sold", "\(fmtMoney(item.totalNetSales)) net"]
        if let last = item.latestImportedAt {
            parts.append("last seen \(last)")
        }
        return parts.joined(separator: " · ")
    }

    /// Verbalizes the reason label, detail, `toneColor`'s severity grouping,
    /// meta line, and sample periods as one VoiceOver stop. Medium-confidence
    /// judgment call (see task note above): the reason label already names
    /// the specific issue, but the severity *grouping* itself is otherwise
    /// silent. Wording verified against `DepletionReasonLabels`'s own doc
    /// comment, not invented. Fallback if judged too speculative: drop this
    /// label, keep only the trailing `.combine`.
    private var reasonAccessibilityLabel: String {
        var parts = [DepletionReasonLabels.label(item.reason)]
        if let detail = item.detail {
            parts.append(detail)
        }
        switch tone {
        case .red: parts.append("blocking this dish")
        case .yellow: parts.append("recipe data gap")
        case .blue: parts.append("needs density conversion data")
        }
        parts.append(metaLine)
        if !item.samplePeriodLabels.isEmpty {
            parts.append("Periods: \(item.samplePeriodLabels.joined(separator: ", "))")
        }
        return parts.joined(separator: ", ")
    }
}
```

The former flat `HStack`(reason/detail)+`Text`(metaLine)+optional `Text`(periods) — 3
siblings of the outer `VStack` — are now wrapped in a new inner
`VStack(alignment: .leading, spacing: 4)` with `.combine` + the new
`reasonAccessibilityLabel`. The dish-name `Button` stays a sibling of that inner
`VStack`, outside its combine scope, at the same nesting level as before. The trailing
dollar `Text` and the tone bar `Rectangle` are unchanged.

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/DepletionExceptionsView.swift
AGENT_NAME=claude git commit -m "T3: DepletionExceptionsView — combine reason/meta/periods, verbalize severity tone, keep dish-name Button a sibling"
```

---

### Task 4: `PriceShocksView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/PriceShocksView.swift` (`PriceShockRowView`
  ~214-270, `PriceHistoryContentView` ~319-374)

**Interfaces:** Self-contained. **`fmtPct`/`fmtPrice` (file-scope, non-`private`) are
reused by 4 other tier files — `MarginDeltasView.swift`, `MorningView.swift`,
`VarianceAttributionView.swift`, and `ShowsTonightView.swift` (confirmed via grep)** —
this task calls them, never changes their signatures.

Moderate, 2 zones, no restructuring — the one `.onTapGesture` on `PriceShockRowView`'s
container (applied by the parent `PriceShocksContentView`, not inside this struct) stays
untouched, matching the established `TempLogView.swift:109-116` tap-to-select-row idiom;
no Button conversion.

**Zone 1:** `PriceShockRowView` gets `.accessibilityElement(children: .combine)` + a
custom `.accessibilityLabel` reciting ingredient/vendor/sku, delta%, before→after price,
and "used in" text — color (red=price up, green=price down) is **reinforcement only**
since `fmtPct` signs the value, no tone word needed. This zone also has this file's one
Dynamic-Type fix: the delta% `Text`'s `.frame(width: 72, alignment: .trailing)` →
`minWidth: 72`.

**Zone 2:** `PriceHistoryContentView` (the drill-down sheet) gets 2 trailing combines —
one on the delta-stat `HStack` (same reinforcement-only reasoning, no label needed), one
per snapshot row (price + date, no color).

- [ ] **Step 1: Fix `PriceShockRowView`**

```swift
private struct PriceShockRowView: View {
    let row: PriceShockRow
    let impact: PriceShockImpact?

    private var tone: Color { row.direction == .up ? .red : .green }

    /// "Used in" text — verbatim port of `page.jsx:227-231`: dishes first
    /// (slice 5, "and N more"), else recipes (slice 3, "and N more"), else
    /// the not-used fallback string.
    private var usedInText: String {
        let dishes = impact?.dishes ?? []
        let recipes = impact?.recipes ?? []
        if !dishes.isEmpty {
            let shown = dishes.prefix(5).joined(separator: ", ")
            return dishes.count > 5 ? "\(shown) and \(dishes.count - 5) more" : shown
        } else if !recipes.isEmpty {
            let shown = recipes.prefix(3).joined(separator: ", ")
            return recipes.count > 3 ? "\(shown) and \(recipes.count - 3) more" : shown
        }
        return "Not currently used in any costed recipe or dish."
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.ingredient)
                    .font(.headline)
                Text("\(row.vendor) · \(row.sku)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            PriceMoveSparkline(row: row)
                .frame(width: 60, height: 36)

            Text(fmtPct(row.deltaPct))
                .font(.system(.body, design: .rounded))
                .bold()
                .monospacedDigit()
                .foregroundStyle(tone)
                .frame(minWidth: 72, alignment: .trailing)

            VStack(alignment: .leading, spacing: 2) {
                Text("\(fmtPrice(row.baselineUnitPrice)) → \(fmtPrice(row.latestUnitPrice))")
                    .font(.caption)
                    .monospacedDigit()
                Text(usedInText)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(rowAccessibilityLabel)
    }

    /// Verbalizes ingredient/vendor/sku, delta%, before→after price, and the
    /// "used in" text as one VoiceOver stop. No tone word: `tone` is a pure
    /// function of `direction` and `fmtPct` already signs the value.
    private var rowAccessibilityLabel: String {
        "\(row.ingredient), \(row.vendor) \(row.sku), \(fmtPct(row.deltaPct)), "
        + "\(fmtPrice(row.baselineUnitPrice)) to \(fmtPrice(row.latestUnitPrice)), \(usedInText)"
    }
}
```

Only `width: 72` → `minWidth: 72` and the trailing `.accessibilityElement(children:
.combine)` + `.accessibilityLabel(rowAccessibilityLabel)` + the new
`rowAccessibilityLabel` computed property are new. The `.onTapGesture` in the parent
`PriceShocksContentView` is unchanged.

- [ ] **Step 2: Fix `PriceHistoryContentView`**

```swift
private struct PriceHistoryContentView: View {
    let row: PriceShockRow
    let series: PriceSeriesResult

    private var tone: Color { row.direction == .up ? .red : .green }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("\(row.vendor) · \(row.sku)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    Text(fmtPct(series.deltaPct))
                        .font(.system(.title2, design: .rounded))
                        .bold()
                        .monospacedDigit()
                        .foregroundStyle(tone)
                    Text("over \(series.points.count) snapshots")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)

                Chart(Array(series.points.enumerated()), id: \.offset) { _, point in
                    if let price = point.unitPrice {
                        LineMark(x: .value("Snapshot", point.snapshotAt), y: .value("Price", price))
                        PointMark(x: .value("Snapshot", point.snapshotAt), y: .value("Price", price))
                    }
                }
                .foregroundStyle(tone)
                .chartXAxis(.hidden)
                .frame(height: 160)

                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(series.points.reversed().enumerated()), id: \.offset) { _, point in
                        HStack {
                            // A nil unit_price snapshot renders as a dash, not
                            // "$0.0000" (drill-down display only). vendor_prices_history.unit_price
                            // is nullable in the web-owned schema.
                            Text(point.unitPrice == nil ? "—" : fmtPrice(point.unitPrice))
                                .font(.body)
                                .monospacedDigit()
                            Spacer()
                            Text(point.snapshotAt)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                        Divider()
                    }
                }
            }
            .padding()
        }
    }
}
```

Only the two trailing `.accessibilityElement(children: .combine)` lines (delta-stat
`HStack`, per-snapshot `HStack`) are new.

- [ ] **Step 3: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/PriceShocksView.swift
AGENT_NAME=claude git commit -m "T4: PriceShocksView — combine row + history rows, fix delta-column Dynamic-Type"
```

---

### Task 5: `VarianceAttributionView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/VarianceAttributionView.swift` (`HeaderCard`
  ~156-190, `PeriodBadge` ~192-221, `SectionCard` ~225-262, `PriceMovesTable`
  ~266-292, `CompositionChangesTable` ~294-315, `CountCorrectionsTable` ~317-343,
  `UnresolvedDepletionsTable` ~345-366)

**Interfaces:** Self-contained. Confirmed zero interactive controls anywhere in this file
(no `Button`/`Link`/`Menu`/`TextField`) — every fix below is a pure additive
`.combine`/label, no restructuring. No Dynamic-Type risk — zero fixed-width `Text`
anywhere in this file (confirmed by full read).

Moderate, multiple zones:

1. **`HeaderCard`'s "Move" tile** — the `VStack` wrapping `deltaPct`+`deltaAmount` gets
   combine only. The two `PeriodBadge`s and the "→" arrow stay independent siblings,
   matching the kpi-tiles-in-an-`HStack` precedent — no outer combine on the whole
   `HStack`.
2. **`PeriodBadge`** — confirmed color-only signal, same `ThresholdColor` enum used
   elsewhere in this tier (`CostingView`'s `variancePctColor`), same red/yellow/green
   buckets. Gets combine + a custom label verbalizing title/periodEnd/variance%/dollar
   move, with "elevated variance"/"high variance" added only for yellow/red — nothing
   for green.
3. **`SectionCard`'s title+count `HStack`** — combine only, no color.
4. **4 row tables** (`PriceMovesTable`, `CompositionChangesTable`,
   `CountCorrectionsTable`, `UnresolvedDepletionsTable`) — each gets a plain trailing
   combine per row, no color anywhere in any of them (confirmed by full read).

- [ ] **Step 1: Fix `HeaderCard`'s "Move" tile**

```swift
private struct HeaderCard: View {
    let result: VarianceAttributionResult

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 24) {
                PeriodBadge(period: result.variance.baseline, title: "Baseline")
                Text("→").foregroundStyle(.secondary)
                PeriodBadge(period: result.variance.current, title: "Current")
                VStack(alignment: .leading, spacing: 2) {
                    Text("Move").font(.caption2).foregroundStyle(.secondary)
                    HStack(spacing: 4) {
                        Text(fmtPct(result.variance.deltaPct)).bold().monospacedDigit()
                        Text("· \(fmtMoney(result.variance.deltaAmount))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                }
                .accessibilityElement(children: .combine)
            }
            Text(result.caveat)
                .font(.caption2)
                .foregroundStyle(.tertiary)
            if result.unattributed {
                Text("No in-window evidence found — nothing in price history, dish components, "
                    + "count corrections, or unresolved depletions for this window.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }
}
```

Only the trailing `.accessibilityElement(children: .combine)` on the "Move" `VStack` is
new — the enclosing `HStack(spacing: 24)` (containing the 2 `PeriodBadge`s, the arrow,
and this tile) is NOT combined, so each stays an independent VoiceOver stop.

- [ ] **Step 2: Fix `PeriodBadge`**

```swift
private struct PeriodBadge: View {
    let period: VarianceAttrPeriod?
    let title: String

    private func color(_ tc: ThresholdColor) -> Color {
        switch tc {
        case .green:  return .green
        case .yellow: return .yellow
        case .red:    return .red
        }
    }

    /// Tone word for `color`'s yellow/red buckets only — green already reads
    /// unambiguously via the signed percentage itself.
    private func toneWord(_ tc: ThresholdColor) -> String? {
        switch tc {
        case .green:  return nil
        case .yellow: return "elevated variance"
        case .red:    return "high variance"
        }
    }

    var body: some View {
        if let p = period {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(title) (\(p.periodEnd))").font(.caption2).foregroundStyle(.secondary)
                Text(fmtPct(p.variancePct))
                    .bold()
                    .monospacedDigit()
                    .foregroundStyle(color(p.thresholdColor))
                Text(fmtMoney(p.varianceAmount))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(accessibilityLabelText(p))
        } else {
            Text("\(title): —").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func accessibilityLabelText(_ p: VarianceAttrPeriod) -> String {
        var text = "\(title) (\(p.periodEnd)): \(fmtPct(p.variancePct))"
        if let word = toneWord(p.thresholdColor) {
            text += ", \(word)"
        }
        text += ", \(fmtMoney(p.varianceAmount))"
        return text
    }
}
```

The `else` branch (period is `nil`) is unchanged — it's already a single `Text`, one
VoiceOver stop. Only the `if let p = period` branch gains combine + the new
`toneWord`/`accessibilityLabelText` helpers.

- [ ] **Step 3: Fix `SectionCard`'s title+count `HStack`**

```swift
private struct SectionCard<Content: View>: View {
    let title: String
    let sub: String
    let count: Int
    let emptyMessage: String
    var note: String? = nil
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(title).font(.headline)
                Text("(\(count))").font(.caption).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)

            Text(sub)
                .font(.caption)
                .foregroundStyle(.secondary)

            if let note {
                Text(note)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            if count == 0 {
                Text(emptyMessage)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 8)
            } else {
                content()
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }
}
```

Only the trailing `.accessibilityElement(children: .combine)` on the title+count
`HStack` is new.

- [ ] **Step 4: Fix the 4 row tables**

```swift
private struct PriceMovesTable: View {
    let items: [PriceMoveItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, m in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(m.ingredient).bold()
                        Text("\(m.vendor) · \(m.sku)").font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(fmtPct(m.pctMove)).bold().monospacedDigit()
                        Text("\(fmtOptDouble(m.firstPrice)) → \(fmtOptDouble(m.lastPrice)) (\(m.snapshots) snapshots)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(m.linkedToMenu ? "linked to a dish" : "—")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                .accessibilityElement(children: .combine)
                Divider()
            }
        }
    }
}

private struct CompositionChangesTable: View {
    let items: [CompositionChangeItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, c in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.dishName).bold()
                        Text("\(c.component) (\(c.componentType))").font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(c.changeKind).font(.caption).foregroundStyle(.secondary)
                        Text(c.changedAt).font(.caption2).foregroundStyle(.tertiary)
                    }
                }
                .accessibilityElement(children: .combine)
                Divider()
            }
        }
    }
}

private struct CountCorrectionsTable: View {
    let items: [CountCorrectionItem]

    private func describe(_ row: CountCorrectionItem) -> String {
        if row.kind == "count_closed" {
            let label = row.label ?? row.countDate ?? "#\(row.countId.map(String.init) ?? "?")"
            return "Count closed — \(label) (\(row.lines ?? 0) lines)"
        }
        let what = row.entity == "inventory_count_lines" ? "count line" : "count"
        let verb = row.transition ?? row.action ?? "changed"
        let who = row.actorCookId.map { " by \($0)" } ?? ""
        return "\(what) \(verb)\(who)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, row in
                HStack {
                    Text(describe(row)).font(.caption)
                    Spacer()
                    Text(row.at).font(.caption2).foregroundStyle(.tertiary)
                }
                .accessibilityElement(children: .combine)
                Divider()
            }
        }
    }
}

private struct UnresolvedDepletionsTable: View {
    let items: [UnresolvedDepletionItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, u in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(u.itemName).bold()
                        Text(u.periodLabel ?? "—").font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(u.qtySold.map { fmtOptDouble($0) } ?? "—").font(.caption).monospacedDigit()
                        Text(fmtMoney(u.netSales)).font(.caption2).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
                .accessibilityElement(children: .combine)
                Divider()
            }
        }
    }
}
```

Only the trailing `.accessibilityElement(children: .combine)` line inside each `ForEach`
(before its `Divider()`) is new in all 4 tables; `describe(_:)` and every other line are
unchanged.

- [ ] **Step 5: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 6: Commit**

```bash
git add LariatNative/Sources/LariatApp/VarianceAttributionView.swift
AGENT_NAME=claude git commit -m "T5: VarianceAttributionView — combine header/badge/section/table rows, verbalize variance tone"
```

---

### Task 6: `MenuEngineeringView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/MenuEngineeringView.swift`
  (`MenuEngineeringContentView`'s intro block ~192-203, `MenuEngineeringRowView`
  ~372-479)

**Interfaces:** Self-contained. Edit surface concentrates in one struct
(`MenuEngineeringRowView`, ~110 of the file's 479 lines) despite the file's overall
length. Explicitly do NOT touch `CoverageBanner`/`UnlinkedDishesCallout`/
`HazardBanner`/`MedianLegendCard` — each already renders its text via Swift's `Text` `+`
concatenation operator (compiles to one `Text` view, already one VoiceOver stop), and any
color there sits on an already-spoken word. No Dynamic-Type risk anywhere in this file.

Zones:

1. **The intro VStack** (2-`Text` fragment: instructional sentence + optional "Compute
   Engine Last Ran" line) — plain combine. The amber color there is an unconditional
   decorative accent, not a state signal.
2. **`MenuEngineeringRowView`'s identity `HStack`** (name/link-badge/quadrant-label) —
   combine only. The link-badge and quadrant-label are ALREADY WORDS, not color-only
   (verified against the `Quadrant`/`DishLinkState` enum cases in this file) — color is
   reinforcement.
3. **`stat`/`prepMedianStat` helpers** — combine only, label already precedes value.
4. **`marginStat`** — CONFIRMED color-only signal (red+bold below the 20% floor, per the
   code's own doc comment) — combine + custom label, "below the 20% floor" appended only
   when margin < 20.
5. **`componentLine`** — combine only. The D/R type-tag color is a deterministic 1:1
   function of the letter shown (confirmed NOT a color-only gap) — no wording needed.

- [ ] **Step 1: Fix the intro block (inside `MenuEngineeringContentView.body`)**

```swift
VStack(alignment: .leading, spacing: 4) {
    Text("What each dish makes us, and how often it sells. Stars sell a lot and make money. Dogs do neither.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
    if let lastRun = vm.lastComputeRun {
        Text("Compute Engine Last Ran: \(lastRun)")
            .font(.caption)
            .foregroundStyle(LariatTheme.amber)
    }
}
.accessibilityElement(children: .combine)
.padding(.horizontal)
```

Only the trailing `.accessibilityElement(children: .combine)` is new; the surrounding
`MenuEngineeringContentView.body` (coverage banner, unlinked callout, hazard banner,
median legend card, row list) is unchanged.

- [ ] **Step 2: Fix `MenuEngineeringRowView`**

```swift
private struct MenuEngineeringRowView: View {
    let row: BridgedMenuEngineeringRow
    let prepMedian: BeoPrepMedian?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(row.itemName)
                    .font(.headline)
                let badge = linkBadge(row.linkState)
                Text(badge.label)
                    .font(.caption2)
                    .bold()
                    .foregroundStyle(badge.color)
                Spacer()
                Text(quadrantLabel(row.quadrant))
                    .font(.caption)
                    .bold()
                    .foregroundStyle(quadrantColor(row.quadrant))
            }
            .accessibilityElement(children: .combine)

            HStack(spacing: 14) {
                stat("Qty", String(format: "%.0f", row.qty))
                prepMedianStat(prepMedian)
                stat("Net $", formatDollars(row.netSales, decimals: 2))
                stat("Avg $", formatDollars(row.avgPrice, decimals: 2))
                stat("Cost/u", row.costPerUnit.map { formatDollars($0, decimals: 2) } ?? "—")
                marginStat(row.marginPct)
            }

            if !row.components.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(row.components.enumerated()), id: \.offset) { _, c in
                        componentLine(c)
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(.vertical, 8)
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption2).foregroundStyle(.tertiary)
            Text(value).font(.caption).monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    /// Prep-median cell (page.tsx L202-221): the median rounded to a whole
    /// number plus a muted "(N)" sample count; "—" when no `beo_prep_history`
    /// rows match this item name.
    private func prepMedianStat(_ m: BeoPrepMedian?) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Prep median").font(.caption2).foregroundStyle(.tertiary)
            if let m {
                (Text(String(format: "%.0f", m.median)).monospacedDigit()
                    + Text(" (\(m.samples))").foregroundStyle(.secondary))
                    .font(.caption)
                    .help("\(m.samples) event\(m.samples == 1 ? "" : "s") contributed")
            } else {
                Text("—").font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// Margin cell: red + bold below the 20% floor (page.tsx L225-227) — the
    /// one confirmed color-only signal in this row.
    private func marginStat(_ marginPct: Double?) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Margin %").font(.caption2).foregroundStyle(.tertiary)
            if let m = marginPct {
                Text(String(format: "%.1f%%", m))
                    .font(.caption)
                    .monospacedDigit()
                    .bold(m < 20)
                    .foregroundStyle(m < 20 ? LariatTheme.bad : .primary)
            } else {
                Text("—").font(.caption)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(marginStatAccessibilityLabel(marginPct))
    }

    private func marginStatAccessibilityLabel(_ marginPct: Double?) -> String {
        guard let m = marginPct else { return "Margin %: —" }
        var text = "Margin %: \(String(format: "%.1f%%", m))"
        if m < 20 { text += ", below the 20% floor" }
        return text
    }

    /// One component sub-line (page.tsx L231-265): R/D tag, display name,
    /// qty·unit or "(no qty)", computed $, and non-ok status flags.
    private func componentLine(_ c: DishComponentResolved) -> some View {
        HStack(spacing: 4) {
            Text(c.componentType == "vendor_item" ? "D" : "R")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(c.componentType == "vendor_item" ? .blue : LariatTheme.ok)
            Text(c.displayName)
            if let qty = c.qtyPerServing, let unit = c.unit {
                Text("· \(qty.formatted()) \(unit)")
            } else {
                Text("· (no qty)")
            }
            if let cost = c.perServingCost {
                Text("= \(formatDollars(cost, decimals: 2))")
                    .foregroundStyle(.secondary)
            }
            if c.status != .ok && c.status != .noDishComponent {
                Text("[\(c.status.rawValue)]")
                    .foregroundStyle(LariatTheme.bad)
            }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
    }
}
```

New: the identity `HStack`'s trailing combine; `stat`/`prepMedianStat`'s trailing
combine (no label); `marginStat`'s trailing combine + `.accessibilityLabel` + the new
`marginStatAccessibilityLabel` helper; `componentLine`'s trailing combine. Every other
line — including `linkBadge`/`quadrantLabel`/`quadrantColor` (declared file-scope, not
reproduced here — unchanged) — is untouched.

- [ ] **Step 3: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/MenuEngineeringView.swift
AGENT_NAME=claude git commit -m "T6: MenuEngineeringView — combine intro/identity/stat/component rows, verbalize margin floor"
```

---

### Task 7: `DishComponentsView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/DishComponentsView.swift` (`readOnlyBanner`
  ~337-351, `builderCard` ~355-480, `existingCard` ~491-567)

**Interfaces:** Self-contained. **This file performs writes** (`saveAll`/`delete` via
`DishComponentsViewModel`, backed by `LariatDB/DishComponentsRepository.swift`) — not
"the" regulated write surface the way `IngredientMastersView` is, but the same
View/ViewModel-boundary discipline applies. **`DishComponentsViewModel` is declared
inside this same file** (lines 1-259, ending right before `// MARK: - Root view` at line
261) — there is no standalone `DishComponentsViewModel.swift`, so this task's
verification step checks diff *line ranges within this file*, not a separate file's
existence.

Large file (568 lines), 3 zones, one restructuring:

1. **`readOnlyBanner`** (`Label`+`Text`, combine only) — purely additive, no interactive
   sibling.
2. **`builderCard`'s remove button** (icon-only `xmark.circle`, identical per row) —
   needs `.accessibilityLabel("Remove \(subject)")` via a new small helper
   `rowSubjectLabel(_:)` that falls back to `"this component"` when the row's
   `recipeSlug`/`vendorIngredient` are both blank, mirroring the established
   `cost.label.isEmpty ? "this cost" : cost.label` idiom from `ShowSettlementView`.
   OPTIONALLY (medium confidence, explicitly droppable): `builderCard`'s qty/unit
   `TextField` labels using the same `rowSubjectLabel` helper — dropping just this piece
   and keeping only the remove-button fix is an acceptable reduced scope.
3. **`existingCard`'s row — THE ONE RESTRUCTURING.** 5 info `Text`s
   (component-type-label/name/qty-unit/notes/updated-at) must be wrapped in a NEW inner
   `HStack(spacing: 10)` with combine, and the conditional destructive trash `Button`
   stays a SIBLING of that inner `HStack`, never nested inside its combine scope — also
   gets `.accessibilityLabel("Delete \(name) from \(dish)")`. This zone also has this
   file's one Dynamic-Type fix: the component-type-label `Text`'s
   `.frame(width: 70, alignment: .leading)` → `minWidth: 70`.

Do NOT touch the `.labelsHidden()` Pickers (Type/Recipe) in `builderCard` — per Apple's
docs their hidden title remains the accessibility name (verified reasoning in the spec).

- [ ] **Step 1: Fix `readOnlyBanner`**

```swift
/// Shown in place of the builder when the write DB failed to open —
/// mirrors the purchasing modules' lock-tile degrade, but keeps the
/// read-only components list below usable.
private var readOnlyBanner: some View {
    VStack(alignment: .leading, spacing: 4) {
        Label("Write database unavailable — read-only", systemImage: "lock")
            .font(.caption)
            .bold()
            .foregroundStyle(LariatTheme.warn)
        Text("The dish builder and delete actions are disabled until the app can open the write database. The existing components below are still current.")
            .font(.caption2)
            .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(10)
    .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
    .overlay(RoundedRectangle(cornerRadius: 10).stroke(LariatTheme.warn, lineWidth: 1))
    .accessibilityElement(children: .combine)
}
```

Only the trailing `.accessibilityElement(children: .combine)` is new.

- [ ] **Step 2: Fix `builderCard`**

```swift
private var builderCard: some View {
    VStack(alignment: .leading, spacing: 12) {
        Text("Build a dish")
            .font(.caption)
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
            .tracking(2)

        HStack(spacing: 8) {
            TextField("Dish name — e.g. ROPE BURGER", text: $vm.dishName)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 340)
            if !vm.candidateDishes.isEmpty {
                Menu("Suggestions") {
                    ForEach(vm.candidateDishes, id: \.self) { d in
                        Button(d) { vm.dishName = d }
                    }
                }
                .frame(maxWidth: 160)
            }
            if !vm.existingForDish.isEmpty {
                Button("Load \(vm.existingForDish.count) existing") {
                    vm.loadExistingIntoRows()
                }
            }
            Spacer()
        }

        Text("Components — sub-recipes AND raw distributor items (buns, patties, cheese)")
            .font(.caption2)
            .foregroundStyle(.secondary)

        ForEach($vm.rows) { $row in
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Picker("Type", selection: $row.componentType) {
                        Text("Sub-recipe").tag("recipe")
                        Text("Distributor").tag("vendor_item")
                    }
                    .labelsHidden()
                    .frame(width: 130)
                    .onChange(of: row.componentType) { _, _ in
                        row.recipeSlug = ""
                        row.vendorIngredient = ""
                    }

                    if row.componentType == "recipe" {
                        Picker("Recipe", selection: $row.recipeSlug) {
                            Text("— choose recipe —").tag("")
                            ForEach(vm.recipes, id: \.slug) { rc in
                                Text(rc.name).tag(rc.slug)
                            }
                        }
                        .labelsHidden()
                        .frame(maxWidth: 260)
                    } else {
                        TextField("e.g. Brioche Bun, 8oz Burger Patty", text: $row.vendorIngredient)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 220)
                        if !vm.distributors.isEmpty {
                            Menu("Pick") {
                                ForEach(vm.distributors, id: \.ingredient) { d in
                                    Button(distributorLabel(d)) { row.vendorIngredient = d.ingredient }
                                }
                            }
                            .frame(width: 70)
                        }
                    }

                    TextField("qty", text: $row.qty)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 70)
                        .accessibilityLabel("Quantity for \(rowSubjectLabel(row))")
                    TextField("unit", text: $row.unit)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 70)
                        .accessibilityLabel("Unit for \(rowSubjectLabel(row))")
                    Menu("Units") {
                        ForEach(Self.commonUnits, id: \.self) { u in
                            Button(u) { row.unit = u }
                        }
                    }
                    .frame(width: 70)
                    TextField("notes (optional)", text: $row.notes)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 180)
                    Button {
                        vm.removeRow(row.id)
                    } label: {
                        Image(systemName: "xmark.circle")
                    }
                    .buttonStyle(.plain)
                    .help("Remove this component")
                    .accessibilityLabel("Remove \(rowSubjectLabel(row))")
                }
                if let err = vm.rowErrors[row.id] {
                    Text(err)
                        .font(.caption2)
                        .foregroundStyle(LariatTheme.bad)
                }
            }
        }

        HStack(spacing: 10) {
            Button("+ Add component") { vm.addRow() }
            Button {
                Task { await vm.saveAll() }
            } label: {
                Text(vm.saving
                     ? "Saving…"
                     : "Save \(vm.rows.count) component\(vm.rows.count == 1 ? "" : "s")")
            }
            .buttonStyle(.borderedProminent)
            .disabled(vm.saving)
            if !vm.formError.isEmpty {
                Text(vm.formError)
                    .font(.caption)
                    .foregroundStyle(LariatTheme.bad)
            }
        }

        Text("Distributor items pull pricing from vendor_prices (preferred) or order_guide_items — pick one with $ if you can. Saving (dish, component) pairs upserts existing rows. Dish names stored canonical (lowercase + alphanumeric); the editor matches case-insensitively.")
            .font(.caption2)
            .foregroundStyle(.tertiary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
    .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
}

/// Per-row accessible subject for the remove button and (optionally) the
/// qty/unit fields — falls back to "this component" when neither field is
/// filled yet, mirroring `cost.label.isEmpty ? "this cost" : cost.label`
/// from `ShowSettlementView`'s deal-editor cost row.
private func rowSubjectLabel(_ row: DishComponentsViewModel.RowDraft) -> String {
    if !row.recipeSlug.isEmpty { return row.recipeSlug }
    let vendor = row.vendorIngredient.trimmingCharacters(in: .whitespaces)
    if !vendor.isEmpty { return vendor }
    return "this component"
}

private func distributorLabel(_ d: DishComponentsRepository.DistributorCandidate) -> String {
    if let price = d.unitPrice {
        return "\(d.ingredient) — \(d.vendor ?? "—") · \(formatDollars(price, decimals: 3))/\(d.packUnit ?? "?")"
    }
    return "\(d.ingredient) — \(d.vendor ?? "—") · no price"
}
```

New: the two qty/unit `TextField`'s `.accessibilityLabel(...)` (optional, droppable —
see task note above), the remove button's `.accessibilityLabel(...)`, and the new
`rowSubjectLabel(_:)` helper. `distributorLabel(_:)` is reproduced only for placement
context — it is unchanged. The `.labelsHidden()` Type/Recipe `Picker`s are untouched.

- [ ] **Step 3: Fix `existingCard`**

```swift
private var existingCard: some View {
    VStack(alignment: .leading, spacing: 8) {
        Text("Existing components (\(vm.components.count))")
            .font(.caption)
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
            .tracking(2)

        if vm.groupedComponents.isEmpty {
            EmptyState(message: "No dish_components rows yet.", systemImage: "fork.knife")
        } else if vm.visibleGroups.isEmpty {
            EmptyState(message: "No dishes match the search.", systemImage: "magnifyingglass")
        } else {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(vm.visibleGroups, id: \.dish) { group in
                    // Read-only session: the builder is hidden, so the
                    // dish name is a plain header instead of an edit link.
                    if vm.canWrite {
                        Button {
                            vm.editDish(group.dish)
                        } label: {
                            Text(group.dish)
                                .font(.subheadline)
                                .bold()
                        }
                        .buttonStyle(.plain)
                        .help("Load into builder to edit all components")
                        .padding(.top, 8)
                    } else {
                        Text(group.dish)
                            .font(.subheadline)
                            .bold()
                            .padding(.top, 8)
                    }

                    ForEach(group.rows) { c in
                        HStack(spacing: 10) {
                            HStack(spacing: 10) {
                                Text(c.componentType == "vendor_item" ? "distributor" : "recipe")
                                    .font(.caption2)
                                    .bold()
                                    .foregroundStyle(c.componentType == "vendor_item" ? .blue : LariatTheme.ok)
                                    .frame(minWidth: 70, alignment: .leading)
                                Text(c.recipeSlug ?? c.vendorIngredient ?? "")
                                    .font(.caption)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                Text("\(c.qtyPerServing.formatted()) \(c.unit)")
                                    .font(.caption)
                                    .monospacedDigit()
                                Text(c.notes ?? "—")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .frame(maxWidth: 160, alignment: .leading)
                                Text(String((c.updatedAt ?? "").prefix(16)))
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            .accessibilityElement(children: .combine)

                            if vm.canWrite {
                                Button(role: .destructive) {
                                    Task { await vm.delete(id: c.id) }
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .buttonStyle(.plain)
                                .help("Delete")
                                .accessibilityLabel("Delete \(c.recipeSlug ?? c.vendorIngredient ?? "this component") from \(group.dish)")
                            }
                        }
                        .padding(.vertical, 3)
                        Divider()
                    }
                }
            }
        }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
    .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
}
```

The former flat `HStack(spacing: 10)` (5 info `Text`s + conditional trash `Button`) is
restructured so the 5 info `Text`s are wrapped in a new inner `HStack(spacing: 10)` with
`.combine`; the trash `Button` stays a sibling of that inner `HStack`, at the same
nesting level as before, outside its combine scope. `width: 70` → `minWidth: 70` on the
component-type-label `Text`. The delete button's `.accessibilityLabel` uses its own
inline `?? "this component"` fallback — it does NOT change the visible `Text`'s existing
`?? ""` fallback, so sighted behavior is unchanged.

- [ ] **Step 4: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 5: Mandatory extra verification — no ViewModel/Repository changes**

`DishComponentsViewModel` has no standalone file (see Interfaces note above) — a
per-file zero-diff check would be vacuous. Instead confirm every changed diff hunk in
this commit starts at or after line 260 (i.e. inside the `View` struct only), and that
`DishComponentsRepository.swift` (in `LariatDB/`) has zero diff:

```bash
cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-costing
violation=0
while read -r startline; do
  [ -z "$startline" ] && continue
  if [ "$startline" -lt 260 ]; then
    echo "VIOLATION: DishComponentsView.swift hunk touches ViewModel-range line $startline"
    violation=1
  fi
done < <(git diff --unified=0 HEAD~1 -- LariatNative/Sources/LariatApp/DishComponentsView.swift | grep -E '^@@' | sed -E 's/^@@ -([0-9]+).*/\1/')
if git diff --quiet HEAD~1 -- LariatNative/Sources/LariatDB/DishComponentsRepository.swift 2>/dev/null && [ "$violation" -eq 0 ]; then
  echo "CONFIRMED — no changes outside the View struct in DishComponentsView.swift, and DishComponentsRepository.swift has zero diff"
else
  echo "UNEXPECTED — investigate before treating this task as done"
  exit 1
fi
```

Expected: `CONFIRMED — no changes outside the View struct in DishComponentsView.swift,
and DishComponentsRepository.swift has zero diff`.

- [ ] **Step 6: Commit**

```bash
git add LariatNative/Sources/LariatApp/DishComponentsView.swift
AGENT_NAME=claude git commit -m "T7: DishComponentsView — combine banner/existing rows, label remove/delete buttons, fix Dynamic-Type"
```

---

### Task 8: `CostingView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/CostingView.swift` (`VarianceSection`
  ~136-196, `RecipeCostVarianceSection` ~206-322, `DishCoverageSection` ~326-361 —
  sub-step A; `MenuEngineeringSection`/`QuadrantCell` ~365-500, `VarianceTrendSection`/
  `VarianceTrendSparkline` ~504-594, `AbcSection`/`AbcTierRow` ~598-699 — sub-step B)

**Interfaces:** Self-contained. Largest file in the whole sweep (734 lines) — split into
2 sub-commits, mirroring the `ShowsTonightView` T8a/T8b pattern from the Shows-tier
precedent. Confirmed zero interactive controls anywhere in this file (no
`Button`/`TextField`/`Picker`/`Link`/`Menu`) — every fix is a pure additive
`.combine`/label/width swap, no restructuring anywhere. **`variancePctColor` is
pre-existing and independently declared in both `VarianceSection` and
`RecipeCostVarianceSection` — NOT consolidated by this task (see Global Constraints).
Only the NEW `variancePctToneWord` helper is added, once per struct, deliberately
mirroring that existing duplication.**

**Sub-step A** (`VarianceSection`, `RecipeCostVarianceSection`, `DishCoverageSection`):

1. **`VarianceSection`** — combine + custom label verbalizing variance%/tone-word/
   theoretical-vs-actual amounts/snapshot date. Tone word only for yellow ("near
   threshold") / red ("over threshold") — nothing for green — via a NEW
   `variancePctToneWord` helper in this struct (alongside the pre-existing
   `variancePctColor`, unchanged).
2. **`RecipeCostVarianceSection`** — headline max/mean/over-5%-count stats get combine +
   custom label with the SAME tone-word treatment via its OWN separate
   `variancePctToneWord` helper (duplicated from `VarianceSection`'s — this mirrors the
   pre-existing `variancePctColor` duplication, not consolidated). Top-5 offender rows
   get combine + custom label with rank/name/variance%/tone-word, PLUS this file's first
   Dynamic-Type fix: the rank-number `Text`'s `width: 16` → `minWidth: 16`.
3. **`DishCoverageSection`** — combine only, ratio format "X/Y" is self-explanatory, no
   color, no reading-order fix needed.

- [ ] **Step 1 (Sub-step A): Fix `VarianceSection`**

```swift
private struct VarianceSection: View {
    let variance: AccountingVariance?

    var body: some View {
        SectionCard(
            title: "Accounting variance",
            emptyTitle: "No variance data yet",
            emptyMessage: "Run the compute engine to populate accounting_variance.",
            emptyIcon: "chart.bar.xaxis",
            isEmpty: variance == nil
        ) {
            if let v = variance {
                VStack(alignment: .leading, spacing: 6) {
                    // Primary KPI: variance_pct
                    HStack(spacing: 8) {
                        let pctStr = v.variancePct.map { String(format: "%.2f%%", $0) } ?? "—"
                        Text(pctStr)
                            .font(.system(.title2, design: .rounded))
                            .bold()
                            .monospacedDigit()
                            .foregroundStyle(variancePctColor(v.variancePct))
                        Text("variance")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    // Theoretical vs actual amounts
                    HStack(spacing: 4) {
                        Text(formatDollars(v.varianceAmount ?? 0.0))
                            .font(.caption)
                            .monospacedDigit()
                        Text("vs")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(formatDollars(v.theoreticalCogs))
                            .font(.caption)
                            .monospacedDigit()
                        Text("theoretical")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let snap = v.snapshotAt {
                        Text("as of \(snap.prefix(10))")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(varianceAccessibilityLabel(v))
            }
        }
    }

    /// Mirror web: red ≥ 5%, yellow 2–5%, green < 2%.
    private func variancePctColor(_ pct: Double?) -> Color {
        guard let pct else { return .primary }
        let abs = Swift.abs(pct)
        if abs >= 5.0 { return .red }
        if abs >= 2.0 { return .yellow }
        return .green
    }

    /// Tone word for `variancePctColor`'s yellow/red buckets only — green/nil
    /// already read unambiguously via the signed percentage itself. Mirrors
    /// the pre-existing `variancePctColor` duplication with
    /// `RecipeCostVarianceSection` (see Global Constraints) rather than
    /// extracting a shared helper.
    private func variancePctToneWord(_ pct: Double?) -> String? {
        guard let pct else { return nil }
        let abs = Swift.abs(pct)
        if abs >= 5.0 { return "over threshold" }
        if abs >= 2.0 { return "near threshold" }
        return nil
    }

    private func varianceAccessibilityLabel(_ v: AccountingVariance) -> String {
        var parts: [String] = []
        let pctStr = v.variancePct.map { String(format: "%.2f%%", $0) } ?? "—"
        var varianceStr = "\(pctStr) variance"
        if let word = variancePctToneWord(v.variancePct) {
            varianceStr += ", \(word)"
        }
        parts.append(varianceStr)
        parts.append("\(formatDollars(v.varianceAmount ?? 0.0)) vs \(formatDollars(v.theoreticalCogs)) theoretical")
        if let snap = v.snapshotAt {
            parts.append("as of \(snap.prefix(10))")
        }
        return parts.joined(separator: ", ")
    }
}
```

`variancePctColor` is unchanged. New: the trailing `.accessibilityElement(children:
.combine)` + `.accessibilityLabel(...)` on the content `VStack`, plus the
`variancePctToneWord`/`varianceAccessibilityLabel` helpers.

- [ ] **Step 2 (Sub-step A): Fix `RecipeCostVarianceSection`**

```swift
private struct RecipeCostVarianceSection: View {
    let variance: RecipeCostVariance

    /// Candidates dropped silently by the web loop (theoretical ≤ 0 or an
    /// unpriceable BOM) — everything that is neither eligible nor gate-excluded.
    private var unpriceableCount: Int {
        max(0, variance.candidateCount - variance.eligibleCount - variance.excludedHighUnmatchedCount)
    }

    var body: some View {
        SectionCard(
            title: "Recipe cost variance",
            emptyTitle: "No costed recipes yet",
            emptyMessage: "Run the costing ingest to populate recipe_costs, bom_lines and vendor_prices.",
            emptyIcon: "scalemass",
            isEmpty: variance.candidateCount == 0
        ) {
            VStack(alignment: .leading, spacing: 12) {
                if variance.eligibleCount == 0 {
                    // Candidates exist but none produced a variance — say why
                    // instead of rendering a misleading all-zero stat row.
                    TileDegrade(
                        title: "No recipe is priceable yet",
                        message: "\(variance.excludedHighUnmatchedCount) of \(variance.candidateCount) recipe(s) excluded — over 30% of their BOM lines have no matching vendor price. Improve ingredient mapping to unlock this card.",
                        systemImage: "link.badge.plus"
                    )
                    .frame(height: 100)
                } else {
                    // Headline stats: max / mean / # over 5% (web aggregates).
                    HStack(spacing: 20) {
                        statColumn("max", variance.max, color: variancePctColor(variance.max))
                        statColumn("mean", variance.mean, color: variancePctColor(variance.mean))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("over 5%")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text("\(variance.over5pctCount) of \(variance.eligibleCount)")
                                .font(.system(.body, design: .rounded))
                                .bold()
                                .monospacedDigit()
                                .foregroundStyle(variance.over5pctCount > 0 ? Color.red : .primary)
                        }
                        Spacer()
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(headlineAccessibilityLabel)

                    // Top offenders (web rows sorted variance desc, top 5).
                    if !variance.topOffenders.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Top \(variance.topOffenders.count) offenders")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .textCase(.uppercase)
                                .tracking(1)

                            ForEach(Array(variance.topOffenders.enumerated()), id: \.offset) { idx, o in
                                HStack(spacing: 6) {
                                    Text("\(idx + 1)")
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                        .frame(minWidth: 16, alignment: .trailing)
                                        .monospacedDigit()
                                    Text(o.name)
                                        .font(.caption)
                                        .lineLimit(1)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                    Text(String(format: "%.2f%%", o.variancePct))
                                        .font(.caption)
                                        .monospacedDigit()
                                        .foregroundStyle(variancePctColor(o.variancePct))
                                }
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel(offenderAccessibilityLabel(rank: idx + 1, name: o.name, pct: o.variancePct))
                            }
                        }
                        .padding(.top, 4)
                    }
                }

                // Coverage note — always rendered (eligible/total + exclusions).
                Text(coverageNote)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    private var coverageNote: String {
        var parts = ["\(variance.eligibleCount) of \(variance.candidateCount) recipes eligible"]
        if variance.excludedHighUnmatchedCount > 0 {
            parts.append("\(variance.excludedHighUnmatchedCount) excluded (>30% BOM lines unmatched)")
        }
        if unpriceableCount > 0 {
            parts.append("\(unpriceableCount) not priceable")
        }
        return parts.joined(separator: " · ")
    }

    private func statColumn(_ label: String, _ pct: Double, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(String(format: "%.2f%%", pct))
                .font(.system(.body, design: .rounded))
                .bold()
                .monospacedDigit()
                .foregroundStyle(color)
        }
    }

    /// Same thresholds as the accounting-variance tile (web colorFor):
    /// red ≥ 5%, yellow 2–5%, green < 2%.
    private func variancePctColor(_ pct: Double) -> Color {
        let abs = Swift.abs(pct)
        if abs >= 5.0 { return .red }
        if abs >= 2.0 { return .yellow }
        return .green
    }

    /// Own copy of the tone-word helper — deliberately duplicated from
    /// `VarianceSection`'s, mirroring the pre-existing `variancePctColor`
    /// duplication rather than consolidating (see Global Constraints).
    private func variancePctToneWord(_ pct: Double) -> String? {
        let abs = Swift.abs(pct)
        if abs >= 5.0 { return "over threshold" }
        if abs >= 2.0 { return "near threshold" }
        return nil
    }

    private var headlineAccessibilityLabel: String {
        var maxStr = "max \(String(format: "%.2f%%", variance.max))"
        if let word = variancePctToneWord(variance.max) { maxStr += ", \(word)" }
        var meanStr = "mean \(String(format: "%.2f%%", variance.mean))"
        if let word = variancePctToneWord(variance.mean) { meanStr += ", \(word)" }
        let overCount = "over 5%: \(variance.over5pctCount) of \(variance.eligibleCount)"
        return [maxStr, meanStr, overCount].joined(separator: ", ")
    }

    private func offenderAccessibilityLabel(rank: Int, name: String, pct: Double) -> String {
        var text = "rank \(rank), \(name), \(String(format: "%.2f%%", pct)) variance"
        if let word = variancePctToneWord(pct) { text += ", \(word)" }
        return text
    }
}
```

`variancePctColor` and `statColumn` are unchanged. New: `width: 16` → `minWidth: 16` on
the rank-number `Text`; combine + label on the headline `HStack` and on each top-offender
row; the `variancePctToneWord`/`headlineAccessibilityLabel`/`offenderAccessibilityLabel`
helpers.

- [ ] **Step 3 (Sub-step A): Fix `DishCoverageSection`**

```swift
private struct DishCoverageSection: View {
    let coverage: DishCoverageSnapshot?

    var body: some View {
        SectionCard(
            title: "Dish → recipe bridge",
            emptyTitle: "No dish coverage data",
            emptyMessage: "Dish coverage snapshot not yet populated.",
            emptyIcon: "fork.knife",
            isEmpty: coverage == nil
        ) {
            if let c = coverage {
                VStack(alignment: .leading, spacing: 6) {
                    // covered / total
                    HStack(spacing: 8) {
                        let covered = c.coveredDishes ?? 0
                        let total = c.totalDishes ?? 0
                        Text(total > 0 ? "\(covered)/\(total)" : "—")
                            .font(.system(.title2, design: .rounded))
                            .bold()
                            .monospacedDigit()
                        Text("dishes costed")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let pct = c.coveragePct {
                        Text(String(format: "%.1f%% costed", pct))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}
```

Only the trailing `.accessibilityElement(children: .combine)` on the content `VStack` is
new — no custom label (the "X/Y" ratio is self-explanatory, per the task's own
reasoning).

- [ ] **Step 4 (Sub-step A): Build**

Run: `cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-costing/LariatNative && swift build`
Expected: `Build complete!`

- [ ] **Step 5 (Sub-step A): Commit**

```bash
git add LariatNative/Sources/LariatApp/CostingView.swift
AGENT_NAME=claude git commit -m "T8a: CostingView — combine variance/coverage sections, verbalize variance tone, fix offender-rank Dynamic-Type"
```

**Sub-step B** (`MenuEngineeringSection`/`QuadrantCell`, `VarianceTrendSection`/
`VarianceTrendSparkline`, `AbcSection`/`AbcTierRow`):

4. **`MenuEngineeringSection`+`QuadrantCell`** — the thresholds-used caption gets
   combine; each `QuadrantCell` in the 2×2 grid gets combine — quadrant color is
   REINFORCEMENT ONLY since the label text already names the quadrant "Star"/"Puzzle"/
   "Plowhorse"/"Dog", no wording needed.
5. **`VarianceTrendSection`** — summary stat row gets combine, no color there; the
   `VarianceTrendSparkline` chart gets ONE decorative
   `.accessibilityLabel("COGS variance sparkline, last N days")` applied by its caller,
   matching the `ShowSoundView` "SPL sparkline" precedent — the per-bar tier color is the
   only place per-period data appears, same reasoning.
6. **`AbcSection`+`AbcTierRow`** — tier summary rows get combine, no color anywhere in
   this section; top-5-in-tier-A rows get combine + custom label with rank/name/
   margin-per-unit/qty-sold, PLUS this file's second Dynamic-Type fix: the rank-number
   `Text`'s `width: 16` → `minWidth: 16` (a DIFFERENT `ForEach` loop in a different struct
   from sub-step A's rank column).

- [ ] **Step 6 (Sub-step B): Fix `MenuEngineeringSection` + `QuadrantCell`**

```swift
private struct MenuEngineeringSection: View {
    let result: MenuEngineeringResult

    // cost_per_unit is bridge-derived since A4.3 T1; every row is 'unknown'
    // only when no dish_components are wired yet — the degrade below points
    // the operator at the fix (same guidance as the web hub's Unknown copy).
    private var allUnknown: Bool {
        result.rows.isEmpty || result.rows.allSatisfy { $0.quadrant == .unknown }
    }

    private func rowsFor(_ quadrant: Quadrant) -> [MenuEngineeringRow] {
        result.rows.filter { $0.quadrant == quadrant }
    }

    var body: some View {
        SectionCard(
            title: "Menu engineering",
            emptyTitle: "No sales data yet",
            emptyMessage: "Populate sales_lines to see quadrant analysis.",
            emptyIcon: "chart.bar.xaxis",
            isEmpty: result.rows.isEmpty
        ) {
            if allUnknown {
                // No bridge data yet — all items fall to 'unknown' until
                // dish_components rows exist (edit them on costing.components).
                TileDegrade(
                    title: "Cost data unavailable",
                    message: "All items fall to unknown quadrant. Wire dish_components for cost_per_unit.",
                    systemImage: "questionmark.circle"
                )
                .frame(height: 100)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    // Thresholds used
                    HStack(spacing: 8) {
                        Text(String(format: "Median margin %.1f%%", result.medianMargin))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                        Text("·")
                            .foregroundStyle(.tertiary)
                        Text(String(format: "Median pop %.2f", result.medianPop))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    .accessibilityElement(children: .combine)

                    // 2×2 quadrant grid
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        QuadrantCell(
                            quadrant: .star,
                            rows: rowsFor(.star),
                            color: .green
                        )
                        QuadrantCell(
                            quadrant: .puzzle,
                            rows: rowsFor(.puzzle),
                            color: .blue
                        )
                        QuadrantCell(
                            quadrant: .plowhorse,
                            rows: rowsFor(.plowhorse),
                            color: .orange
                        )
                        QuadrantCell(
                            quadrant: .dog,
                            rows: rowsFor(.dog),
                            color: .secondary
                        )
                    }

                    // Unknown fallback count
                    let unknownCount = rowsFor(.unknown).count
                    if unknownCount > 0 {
                        Text("\(unknownCount) item(s) have no cost data (unknown quadrant)")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
    }
}

private struct QuadrantCell: View {
    let quadrant: Quadrant
    let rows: [MenuEngineeringRow]
    let color: Color

    private var label: String {
        switch quadrant {
        case .star:      return "Star"
        case .puzzle:    return "Puzzle"
        case .plowhorse: return "Plowhorse"
        case .dog:       return "Dog"
        case .unknown:   return "Unknown"
        }
    }

    private var subtitle: String {
        switch quadrant {
        case .star:      return "high margin · high pop"
        case .puzzle:    return "high margin · low pop"
        case .plowhorse: return "low margin · high pop"
        case .dog:       return "low margin · low pop"
        case .unknown:   return "no cost data"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(color)
                Spacer()
                Text("\(rows.count)")
                    .font(.system(.title3, design: .rounded))
                    .bold()
                    .monospacedDigit()
            }
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(.tertiary)
            // Top item in this quadrant (by net sales)
            if let top = rows.max(by: { $0.netSales < $1.netSales }) {
                Text(top.itemName)
                    .font(.caption2)
                    .lineLimit(1)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .combine)
    }
}
```

New: combine on the thresholds-used `HStack` and on `QuadrantCell`'s outer `VStack`
(trailing modifier, no custom label — default combine order already matches visual
top-to-bottom reading order: label, count, subtitle, top item).

- [ ] **Step 7 (Sub-step B): Fix `VarianceTrendSection` + `VarianceTrendSparkline`**

```swift
private struct VarianceTrendSection: View {
    let trend: VarianceTrend

    var body: some View {
        SectionCard(
            title: "COGS variance · last \(trend.windowDays) days",
            emptyTitle: "No variance trend data",
            emptyMessage: "Run the compute engine to populate accounting_variance with period_end.",
            emptyIcon: "waveform.path.ecg",
            isEmpty: trend.rowsFound == 0
        ) {
            VStack(alignment: .leading, spacing: 12) {
                // Summary stats
                HStack(spacing: 20) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("current")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(formatVariancePct(trend.pCurrent))
                            .font(.system(.body, design: .rounded))
                            .bold()
                            .monospacedDigit()
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("average")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(formatVariancePct(trend.pAverage))
                            .font(.system(.body, design: .rounded))
                            .bold()
                            .monospacedDigit()
                    }
                    Spacer()
                    Text("\(trend.rowsFound) \(trend.rowsFound == 1 ? "run" : "runs")")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .accessibilityElement(children: .combine)

                // Sparkline using Swift Charts (mirrors VarianceTrend.jsx SVG bars)
                if !trend.points.isEmpty {
                    VarianceTrendSparkline(points: trend.points)
                        .frame(height: 60)
                        .accessibilityLabel("COGS variance sparkline, last \(trend.windowDays) days")
                }

                Text("Green ≤ 2% · Yellow 2–5% · Red ≥ 5%")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    private func formatVariancePct(_ pct: Double?) -> String {
        guard let pct else { return "—" }
        return String(format: "%+.1f%%", pct)
    }
}

private struct VarianceTrendSparkline: View {
    let points: [VarianceTrendPoint]

    private func barColor(_ tc: ThresholdColor) -> Color {
        switch tc {
        case .green:  return .green
        case .yellow: return .yellow
        case .red:    return .red
        }
    }

    var body: some View {
        Chart {
            ForEach(Array(points.enumerated()), id: \.offset) { idx, point in
                let pct = Swift.abs(point.variancePct ?? 0.0)
                BarMark(
                    x: .value("Period", idx),
                    y: .value("Variance %", pct)
                )
                .foregroundStyle(barColor(point.thresholdColor))
                .cornerRadius(2)
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis {
            AxisMarks(values: .automatic(desiredCount: 3)) { value in
                if let v = value.as(Double.self) {
                    AxisValueLabel { Text(String(format: "%.0f%%", v)).font(.caption2) }
                    AxisGridLine(stroke: StrokeStyle(dash: [3, 3]))
                }
            }
        }
    }
}
```

New: combine on the summary-stats `HStack`; `.accessibilityLabel("COGS variance
sparkline, last N days")` applied at the call site (mirrors `ShowSoundView`'s
pre-existing "SPL sparkline" label pattern) — `VarianceTrendSparkline`'s own body is
unchanged.

- [ ] **Step 8 (Sub-step B): Fix `AbcSection` + `AbcTierRow`**

```swift
private struct AbcSection: View {
    let rows: [AbcRankedRow]

    private var linkedRows: [AbcRankedRow] {
        rows.filter { $0.tier != .unranked }
    }

    private func rowsFor(_ tier: AbcTier) -> [AbcRankedRow] {
        rows.filter { $0.tier == tier }
    }

    private func tierShare(_ tier: AbcTier) -> Double {
        let total = rows.reduce(0) { $0 + $1.scoreCents }
        guard total > 0 else { return 0.0 }
        let tierTotal = rowsFor(tier).reduce(0) { $0 + $1.scoreCents }
        return (Double(tierTotal) / Double(total)) * 100.0
    }

    var body: some View {
        SectionCard(
            title: "ABC contribution",
            emptyTitle: "No sales data yet",
            emptyMessage: "Populate sales_lines to compute ABC ranking.",
            emptyIcon: "chart.bar",
            isEmpty: rows.isEmpty
        ) {
            if linkedRows.isEmpty {
                TileDegrade(
                    title: "No costed dishes yet",
                    message: "Wire dish_components for menu items before this section becomes useful.",
                    systemImage: "link.badge.plus"
                )
                .frame(height: 80)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    // Tier summary rows (mirrors AbcTile.jsx TierRow)
                    VStack(spacing: 6) {
                        AbcTierRow(label: "Tier A", rows: rowsFor(.a), share: tierShare(.a))
                        AbcTierRow(label: "Tier B", rows: rowsFor(.b), share: tierShare(.b))
                        AbcTierRow(label: "Tier C", rows: rowsFor(.c), share: tierShare(.c))
                        AbcTierRow(label: "Unranked · no costing", rows: rowsFor(.unranked), share: 0.0)
                    }

                    // Top-5 in tier A (mirrors AbcTile.jsx topA slice)
                    let topA = rowsFor(.a).prefix(5)
                    if !topA.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Top \(topA.count) in tier A")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .textCase(.uppercase)
                                .tracking(1)

                            ForEach(Array(topA.enumerated()), id: \.offset) { idx, r in
                                let marginPerUnit = r.qty > 0
                                    ? formatDollars(r.contributionDollars / r.qty, decimals: 2)
                                    : "—"
                                HStack(spacing: 6) {
                                    Text("\(idx + 1)")
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                        .frame(minWidth: 16, alignment: .trailing)
                                        .monospacedDigit()

                                    Text(r.itemName)
                                        .font(.caption)
                                        .lineLimit(1)
                                        .frame(maxWidth: .infinity, alignment: .leading)

                                    Text("\(marginPerUnit) margin/unit · \(Int(r.qty)) sold")
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                        .monospacedDigit()
                                }
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel(abcTopRowAccessibilityLabel(
                                    rank: idx + 1, name: r.itemName, marginPerUnit: marginPerUnit, qtySold: Int(r.qty)))
                            }
                        }
                        .padding(.top, 4)
                    }
                }
            }
        }
    }

    private func abcTopRowAccessibilityLabel(rank: Int, name: String, marginPerUnit: String, qtySold: Int) -> String {
        "rank \(rank), \(name), \(marginPerUnit) margin per unit, \(qtySold) sold"
    }
}

private struct AbcTierRow: View {
    let label: String
    let rows: [AbcRankedRow]
    let share: Double

    var body: some View {
        HStack {
            Text(label)
                .font(.caption)
            Spacer()
            let count = rows.count
            Text("\(count) \(count == 1 ? "dish" : "dishes") · \(Int(share.rounded()))% of margin")
                .font(.caption)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }
}
```

New: `width: 16` → `minWidth: 16` on the rank-number `Text` (moved the pre-existing
`let marginPerUnit = ...` above the `HStack` so it can be reused by the new label
without duplicating the ternary — a layout-neutral reordering of a `let` binding, not a
behavior change); combine + label on each top-5-in-tier-A row; the new
`abcTopRowAccessibilityLabel` helper; combine on `AbcTierRow`'s body (no label — no
color anywhere in this section).

- [ ] **Step 9 (Sub-step B): Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 10 (Sub-step B): Commit**

```bash
git add LariatNative/Sources/LariatApp/CostingView.swift
AGENT_NAME=claude git commit -m "T8b: CostingView — combine menu-engineering/trend/abc rows, label sparkline + tier-A ranks, fix rank Dynamic-Type"
```

---

### Task 9: Final verification

**Files:** None (verification only).

**Interfaces:** Depends on Tasks 1-8 all committed.

- [ ] **Step 1: Full build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 2: Scripted coverage audit (not prose)**

```bash
cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-costing/LariatNative
files=(
  MarginDeltasView IngredientMastersView DepletionExceptionsView PriceShocksView
  VarianceAttributionView MenuEngineeringView DishComponentsView CostingView
)
fail=0
for f in "${files[@]}"; do
  count=$(grep -cE '\.accessibilityLabel|\.accessibilityElement|\.accessibilityHint|\.accessibilityValue|\.dynamicTypeSize|accessibilityAddTraits' "Sources/LariatApp/${f}.swift")
  if [ "$count" -lt 1 ]; then
    echo "MISSING: ${f}.swift has $count accessibility modifiers (expected >= 1)"
    fail=1
  else
    echo "OK: ${f}.swift has $count accessibility modifiers"
  fi
done
if [ "$fail" -eq 0 ]; then
  echo "COVERAGE OK — all 8 files have at least one accessibility modifier"
else
  echo "COVERAGE VIOLATION — see MISSING lines above"
  exit 1
fi
```

Expected: `COVERAGE OK — all 8 files have at least one accessibility modifier`.

- [ ] **Step 3: Scope check (scripted)**

```bash
git fetch origin
base=$(git merge-base origin/main HEAD)
expected=$(cat <<'EOF'
LariatNative/Sources/LariatApp/MarginDeltasView.swift
LariatNative/Sources/LariatApp/IngredientMastersView.swift
LariatNative/Sources/LariatApp/DepletionExceptionsView.swift
LariatNative/Sources/LariatApp/PriceShocksView.swift
LariatNative/Sources/LariatApp/VarianceAttributionView.swift
LariatNative/Sources/LariatApp/MenuEngineeringView.swift
LariatNative/Sources/LariatApp/DishComponentsView.swift
LariatNative/Sources/LariatApp/CostingView.swift
EOF
)
actual=$(git diff --name-only "$base" -- LariatNative)
if diff <(echo "$expected" | sort) <(echo "$actual" | sort) > /tmp/h7a-phase2-costing-scope-diff.txt; then
  echo "SCOPE OK — exactly the expected 8 files changed under LariatNative/"
else
  echo "SCOPE VIOLATION:"
  cat /tmp/h7a-phase2-costing-scope-diff.txt
  exit 1
fi

# Extra check 1: IngredientMastersViewModel / IngredientMastersRepository
# (regulated write: audited write, audit_events, actor_source=native_mac,
# 3 quality-lock validation rules) must show zero diff.
if git diff --quiet "$base" -- LariatNative/Sources/LariatApp/IngredientMastersViewModel.swift 2>/dev/null \
   && git diff --quiet "$base" -- LariatNative/Sources/LariatDB/IngredientMastersRepository.swift 2>/dev/null; then
  echo "CONFIRMED — IngredientMastersViewModel.swift and IngredientMastersRepository.swift have zero diff, as required"
else
  echo "UNEXPECTED — IngredientMasters write/validation/audit logic changed; investigate before treating scope as OK"
  exit 1
fi

# Extra check 2: DishComponentsViewModel has no standalone file — it's declared
# inside DishComponentsView.swift itself (lines 1-259, ending right before
# "// MARK: - Root view" at line 261). Confirm every changed hunk in that file
# starts at or after line 260 (inside the View struct only), and that
# DishComponentsRepository.swift has zero diff.
violation=0
while read -r startline; do
  [ -z "$startline" ] && continue
  if [ "$startline" -lt 260 ]; then
    echo "VIOLATION: DishComponentsView.swift hunk touches ViewModel-range line $startline"
    violation=1
  fi
done < <(git diff --unified=0 "$base" -- LariatNative/Sources/LariatApp/DishComponentsView.swift | grep -E '^@@' | sed -E 's/^@@ -([0-9]+).*/\1/')
if git diff --quiet "$base" -- LariatNative/Sources/LariatDB/DishComponentsRepository.swift 2>/dev/null && [ "$violation" -eq 0 ]; then
  echo "CONFIRMED — DishComponentsViewModel (embedded in DishComponentsView.swift) and DishComponentsRepository.swift show no changes outside the View struct"
else
  echo "UNEXPECTED — DishComponentsViewModel/Repository logic may have changed; investigate before treating scope as OK"
  exit 1
fi
```

Expected: `SCOPE OK — exactly the expected 8 files changed under LariatNative/` followed
by both `CONFIRMED` lines.

- [ ] **Step 4: Mandatory final whole-branch review**

Compare all 8 files' diffs side by side. Specifically check:

- Do either of the 2 restructured zones (`DepletionExceptionsView.DepletionExceptionRow`,
  `DishComponentsView.existingCard`) nest their interactive control (the dish-name
  `Button` / the destructive trash `Button`) inside a `.combine` block? They must not.
- Does `IngredientMastersView`'s diff touch anything beyond the one Button's
  `.accessibilityLabel`? Does `DishComponentsView`'s diff touch anything inside the
  ViewModel class (lines 1-259)? Both must be no (confirmed mechanically in Step 3, but
  re-eyeball the two diffs directly).
- Do the tone-word wording additions (`DepletionExceptionsView`'s red/yellow/blue,
  `VarianceAttributionView.PeriodBadge`'s yellow/red, `MenuEngineeringView`'s
  below-20%-floor, `CostingView`'s `VarianceSection`/`RecipeCostVarianceSection`'s
  near/over-threshold) leak to cases they shouldn't (green, `.blue` in
  `MenuEngineeringView` reinforcement-only signals, etc.)?
- Confirm `DishComponentsView.builderCard`'s optional qty/unit `TextField` labels (if
  kept) and `DepletionExceptionsView`'s tone-word wording (if kept) were each either
  fully implemented or fully dropped per their disclosed fallbacks — not half-applied.
- Confirm the 4 Dynamic-Type fixes (`PriceShocksView`'s delta% column,
  `DishComponentsView.existingCard`'s component-type-label column, `CostingView`'s 2
  rank-number columns) are all `width:` → `minWidth:`, values unchanged.

- [ ] **Step 5: Manual VoiceOver spot-check (documented, non-gating)**

Needs a real desktop session. Turn on VoiceOver (Cmd+F5), open all 8 boards, and
confirm: a margin-delta row reads dish/price-move/contributors/delta as one stop; the
Ingredient Masters "Mark reviewed" button announces the dish name it targets; a
depletion-exception row announces the reason, detail, and severity wording before the
dish-name Button; a price-shock row reads ingredient/vendor/delta/price-move/used-in as
one stop and the delta% column doesn't clip at a larger text size; variance-attribution's
baseline/current badges announce "elevated variance"/"high variance" only when
applicable; a menu-engineering row's margin cell announces "below the 20% floor" only
under 20%; dish-components' remove/delete buttons each announce which component/dish
they target; Costing's variance tiles, top-offender rows, sparkline, and ABC top-5 rows
each read sensibly and the rank columns don't clip.

- [ ] **Step 6: Open PR**

```bash
git push -u origin feat/lariat-native-h7a-phase2-costing
gh pr create --base main --head feat/lariat-native-h7a-phase2-costing \
  --title "feat(native): H7a Phase 2 — VoiceOver labels for .costing tier" \
  --body "See docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-costing-tier-design.md and docs/superpowers/plans/2026-07-05-lariat-native-h7a-phase2-costing-tier.md for full detail. 9 tasks (T1-T8, with T8 split into 2 sub-commits), plus this T9 scripted verification + whole-branch review. IngredientMastersView touches only the Mark-reviewed button's accessibility label -- IngredientMastersViewModel/IngredientMastersRepository (regulated write) verified unchanged. DishComponentsView's ViewModel is embedded in the same file -- verified no diff hunk falls inside its class range."
```

**Commit message:** none (verification only).

---

## Self-Review

**1. Spec coverage:** Goal (labels + verbalize the 3 confirmed color-only signals + the 1
medium-confidence candidate with fallback + fix the 4 confirmed Dynamic-Type risks across
8 boards) ✓ — every file has its own task. Non-goals (shared cross-tier components, the
other tier, `LariatModel`/`IngredientMastersViewModel`/`IngredientMastersRepository`/
`DishComponentsViewModel`/`DishComponentsRepository` changes, new dependency, the
pre-existing `variancePctColor` duplication) — no task violates any of these. Invariants
— every touched interactive control now has an unambiguous label (Mark-reviewed,
remove/delete component buttons); all 3 confirmed color-only signals are verbalized
exactly where ambiguous (`CostingView`'s `variancePctColor` in both structs,
`VarianceAttributionView.PeriodBadge`, `MenuEngineeringView.marginStat`), left alone
where reinforcement-only (`MarginDeltasView`, `PriceShocksView`, `MenuEngineeringView`'s
quadrant/link-badge/D-R tag, `CostingView`'s `QuadrantCell`); the 1 medium-confidence
candidate (`DepletionExceptionsView`'s severity tone) carries its disclosed fallback; no
interactive control is nested inside `.combine` in either of the 2 restructured zones.
Testing/acceptance — Task 9's scripted coverage + scope-diff checks (including both extra
zero-diff/no-out-of-scope-hunk checks) mirror and extend established precedent; manual
VoiceOver spot-check documented as non-gating.

**2. Placeholder scan:** No "TBD"/"add appropriate handling"/"similar to Task N"
language anywhere — every task shows complete before/after code for its zone, including
the two explicitly-disclosed judgment calls (`DepletionExceptionsView`'s tone wording,
`DishComponentsView`'s optional qty/unit `TextField` labels), both written out in full
rather than described, per the "no placeholders" rule, with their fallback explicitly
named as a scope-reduction option rather than left unwritten.

**3. Type consistency:** `DepletionReasonTone` (Task 3) verified directly against
`LariatModel/DepletionReasonLabels.swift`'s doc comment (red/yellow/blue mapping
confirmed exact, not invented). `ThresholdColor` (Task 5, Task 8) reused unchanged in
both `VarianceAttributionView.PeriodBadge` and `CostingView`'s
`variancePctColor`/`VarianceTrendSparkline.barColor` — same 3 cases (`.green`/`.yellow`/
`.red`) confirmed by direct read in every file, no case-name guessing. `variancePctColor`
(Task 8) is read verbatim from both existing declarations — the new
`variancePctToneWord` helpers are added as siblings, never replacing or merging the
existing (intentionally duplicated) `variancePctColor` pair. `DishComponentsViewModel.
RowDraft` (Task 7) referenced by its full nested name; `rowSubjectLabel`'s fallback logic
was written to avoid touching the pre-existing `Text(c.recipeSlug ?? c.vendorIngredient
?? "")` sighted-UI fallback (kept as `""`), using a separate inline `?? "this component"`
fallback only inside the new accessibility-label string. `fmtPct`/`fmtPrice`/`formatDollars`
keep their existing signatures everywhere; `fmtPct`'s reuse by `MorningView.swift` and
`ShowsTonightView.swift` (both outside this tier) was confirmed by grep, not assumed, and
neither file is touched by this plan.

**4. Notable discrepancy found during planning (flagged per the task brief):** the
original task description asked for a Task 9 zero-diff check on
"`DishComponentsViewModel.swift`" as if it were a standalone file, mirroring
`ShowSettlementViewModel.swift` from the Shows-tier precedent. Reading `DishComponentsView.swift`
in full showed `DishComponentsViewModel` is actually declared *inside* that same file
(no separate `DishComponentsViewModel.swift` exists in `Sources/LariatApp/`) — unlike
`IngredientMastersViewModel`, which genuinely is a separate file. Task 7 and Task 9 both
route around this by checking diff-hunk line numbers within `DishComponentsView.swift`
instead of a whole-file diff, which gives an equivalent (arguably stronger) guarantee
that the ViewModel class was never touched.
