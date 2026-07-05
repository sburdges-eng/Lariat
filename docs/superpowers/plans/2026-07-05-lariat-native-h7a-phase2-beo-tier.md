# LariatNative H7a Phase 2 — BEO tier: VoiceOver labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VoiceOver labels, verbalize the 1 confirmed color-only signal, and fix the 1
confirmed Dynamic-Type risk across the 3 `.beo`-tier board views. Only 2 files receive
direct edits — `BeoBoardView.swift` and `BeoPrepHistoryView.swift`. The third,
`BeoFireScheduleView.swift`, receives **zero direct edits by design**: its only rendered
content is `BeoFireStationSection`, a `struct` declared inside `BeoBoardView.swift` and
explicitly commented "Shared station block — also used by the standalone fire-schedule
board." Fixing that shared component once, where it's declared, fixes both call sites.

**Architecture:** Per-file, inline `.accessibilityElement(children: .combine)` +
`.accessibilityLabel(...)` additions matching `SanitizerView.swift`'s existing house
pattern — no extraction to `LariatModel`, no new types, no new dependency. Where a row
mixes read-only info with an interactive control (button/field), the info combines into
its own accessibility element and the control stays a sibling outside it — never nested
inside `.combine`. `BeoBoardView.swift` (1089 lines, the largest file in this sweep) is
split into 2 sequential tasks by concern, both editing the same file:
- **Task 1 (Part A — editing surface):** `partyRow`, `totalsFooter`/`invoiceRow`,
  Tax/Service-fee field labels, `coursesPanel` course rows, `BeoEventHeaderEditor.
  labeled()` (6-field fix), `BeoLineRowEditor` (the Dynamic-Type fix), `menuPanel`
  catalog-row insurance.
- **Task 2 (Part B — read-only reference panels):** `BeoOrderGuidePanel`,
  `BeoPrepDemandsPanel`, `BeoFireStationSection` (the color-only-signal fix, shared with
  `BeoFireScheduleView.swift`), `BeoRecipeTreePanel.itemCard`, `RecipeNodeRow.header`
  insurance.

These two tasks run strictly sequentially — Task 2 builds on Task 1's commit, never in
parallel, since they touch the same file.

**Tech Stack:** SwiftUI (macOS), no new packages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-beo-tier-design.md`.
- No new dependency (this codebase has exactly one — GRDB — today).
- No extraction of accessibility-label strings into `LariatModel` — inline in the View
  body, matching `SanitizerView.swift:73`.
- No XCTest is possible for this work — `LariatApp` has no test target. Acceptance per
  task is `swift build` clean. The final task runs a scripted coverage + scope audit
  instead of a unit test.
- **`PinEntrySheet.swift` is out of scope**, same reasoning as Cook/Purchasing tiers —
  it's shared across 19 files, nearly every tier. `BeoBoardView.swift` presents it via
  `.sheet(isPresented: $vm.showPinSheet) { PinEntrySheet(...) }` at line ~39-43; do not
  touch `PinEntrySheet.swift` itself in this plan — it gets its own standalone task later.
- **`EmptyState.swift`/`TileDegrade.swift` are out of scope** — already accessible
  (`EmptyState` already carries `.combine`) and shared UI-kit primitives, not
  tier-specific views. Do not add modifiers to their call sites in this plan.
- The remaining tiers (inventory, foh, house, labor, shows, costing, manager) are
  separate future sub-projects — do not touch any file outside the 2 named below.
- Every task's changes are strictly additive (accessibility modifiers only) — no
  behavior change for a sighted user beyond the one necessary restructuring: `coursesPanel`'s
  course row splits into an inner combined info `HStack` + the pre-existing delete
  `Button` as a sibling, so the button stays outside the new `.combine` block. No other
  zone needs restructuring — every other fix is either a trailing modifier or a
  same-shape edit in place.
- **Strictly additive discipline:** a prior task in this sweep (Cook tier's T4) deleted
  2 pre-existing comments as an unintended side effect of "matching the brief exactly."
  Every task below must preserve every pre-existing comment/line not directly touched by
  its named fix.
- **Two pre-existing accessibility labels in `BeoBoardView.swift` must remain
  byte-for-byte unchanged**: `coursesPanel`'s `.accessibilityLabel("Delete
  \(course.courseLabel)")` and `BeoLineRowEditor`'s `.accessibilityLabel("Remove line")`.
  New fixes wrap or label the surrounding info, never these two buttons.
- **Task 2 depends on Task 1's commit** — both tasks edit `BeoBoardView.swift`
  sequentially. Task 2 must be built on top of Task 1's commit, never attempted in a
  parallel worktree, since both diffs touch the same file.
- **`BeoFireScheduleView.swift` expects ZERO direct edits.** Its only rendered content,
  `BeoFireStationSection`, is a `struct` declared in `BeoBoardView.swift` and fixed as
  part of Task 2. Do not create a task for this file, and do not add any modifier to it
  directly — doing so would duplicate Task 2's fix and risk drifting the two call sites
  out of sync.
- **Line ranges below are locators from the pre-implementation audit, not guaranteed
  exact** — if the file has drifted since the audit, locate the named function/struct by
  name rather than trusting the line number, and verify with the build step rather than
  guessing (same discipline as Phase 1's Task 13).
- Zero further Dynamic-Type fixes are needed beyond the one confirmed in
  `BeoLineRowEditor` — all 22 `.frame(width:|minWidth:|maxWidth:)` hits in
  `BeoBoardView.swift` were checked individually during the audit; everything else is a
  decorative divider/selection bar, a panel/sidebar region width, a form ceiling, or a
  fixed width on an interactive control (excluded per the Purchasing-tier `countField`
  precedent — controls scroll/adapt rather than clip). `BeoFireScheduleView.swift` and
  `BeoPrepHistoryView.swift` have zero fixed-width `Text` columns.

---

### Task 1: `BeoBoardView.swift` Part A — editing surface

**Files:**
- Modify: `LariatNative/Sources/LariatApp/BeoBoardView.swift` (`partyRow` ~119-144,
  `totalsFooter`/`invoiceRow` ~304-351, `coursesPanel` ~462-499,
  `BeoEventHeaderEditor.labeled()` ~610-615, `BeoLineRowEditor.body` ~627-675,
  `menuPanel` ~404-460)

**Interfaces:** Self-contained for this task — no other task depends on it. **Task 2
depends on this task's commit** (same file, sequential edits) — do not start Task 2
until this task is committed.

Six zones, covering the Sheet tab's editing surface:

1. **`partyRow`** — the sidebar party-list row reads as 2-3 fragmented stops (title,
   date/time/covers). Safe to combine wholesale: selection is handled by the enclosing
   `List(selection:)`, not by a control inside the row.
2. **`totalsFooter`/`invoiceRow`** — the Subtotal row (via `invoiceRow`) and the Total
   row are pure info, fragmented into label + value stops; combine both. The Tax and
   Service-fee rows mix a label + an interactive `CommitTextField` + a computed value —
   distinct from the Subtotal/Total combine fix, these get a direct `.accessibilityLabel`
   on the `CommitTextField` instead, since their own placeholders ("rate", "%") aren't
   field-identifying and wrapping an interactive control in `.combine` is never allowed.
3. **`coursesPanel`** — each course row's label + fire time reads as 2 stops, with a
   destructive delete button as a third. Restructured so the label+time combine into one
   element while the delete button — which already carries a pre-existing
   `.accessibilityLabel("Delete \(course.courseLabel)")` — stays an untouched sibling
   outside the new `.combine` block.
4. **`BeoEventHeaderEditor.labeled()`** — the single shared helper behind 6 header fields
   (Date, Time, Contact, Covers, Min spend, Notes). Their visible `Eyebrow` captions
   aren't wired as accessible names, so VoiceOver falls back to placeholder examples
   ("YYYY-MM-DD", "5-7pm", "0"). Fixed once, in the helper, covers all 6 uniformly — no
   call site needs its own edit.
5. **`BeoLineRowEditor`** — the sweep's one confirmed Dynamic-Type risk: the line-total
   dollar `Text` uses `.frame(width: 80, alignment: .trailing)` in a dense
   ITEM/COURSE/TIME/COST/QTY/TOTAL row, a real clipping risk at larger accessibility text
   sizes. Fix: `width: 80` → `minWidth: 80`. The struct's pre-existing
   `.accessibilityLabel("Remove line")` on the delete button is preserved untouched.
6. **`menuPanel`'s catalog-row `Button`** — optional, zero-risk insurance matching the
   established Button-auto-flattening precedent (Cook tier's `actionCard`, Purchasing
   tier's `attachSheet` rows) — not a confirmed defect. Adds
   `.accessibilityElement(children: .combine)` directly on the `Button`, which is itself
   the interactive control the modifier applies to (not some other control nested inside
   it) — this does not violate the never-nest-a-control-inside-combine rule.

- [ ] **Step 1: Fix `partyRow`**

```swift
    private func partyRow(_ ev: BeoEventRow) -> some View {
        let selected = vm.selectedEventId == ev.id
        return HStack(spacing: 10) {
            Rectangle()
                .fill(selected ? LariatBrand.terracotta : .clear)
                .frame(width: 3)
                .clipShape(Capsule())
            VStack(alignment: .leading, spacing: 3) {
                Text(ev.title)
                    .font(.system(.callout, design: .serif).weight(selected ? .semibold : .regular))
                    .foregroundStyle(LariatBrand.ink)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(ev.eventDate ?? "no date")
                    if let t = ev.eventTime { Text("· \(t)") }
                    if let g = ev.guestCount { Text("· \(g) covers") }
                }
                .font(.caption)
                .foregroundStyle(LariatBrand.inkSoft)
                .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
```

Only the trailing `.accessibilityElement(children: .combine)` line is new — every other
line must be preserved exactly. No custom `.accessibilityLabel` is needed: `.combine`
concatenates the title + date/time/covers Texts into one readable stop on its own.

- [ ] **Step 2: Fix `totalsFooter` + `invoiceRow`**

```swift
    private func totalsFooter(_ event: BeoEventRow) -> some View {
        let totals = vm.totals
        return VStack(spacing: 6) {
            invoiceRow("Subtotal", value: totals.subtotal)
            HStack(spacing: 8) {
                Text("Tax").foregroundStyle(LariatBrand.inkSoft)
                CommitTextField(value: event.taxRate.map { String($0) } ?? "", placeholder: "rate", width: 56) { raw in
                    if let v = Double(raw) { vm.requestUpdateEvent(BeoEventPatch(taxRate: v)) }
                }
                .accessibilityLabel("Tax rate")
                Text("rate").font(.caption2).foregroundStyle(LariatBrand.inkFaint)
                Spacer()
                Text(formatDollars(totals.tax, decimals: 2)).monospacedDigit()
            }
            HStack(spacing: 8) {
                Text("Service fee").foregroundStyle(LariatBrand.inkSoft)
                CommitTextField(value: event.serviceFeePct.map { String($0) } ?? "", placeholder: "%", width: 48) { raw in
                    if let v = Double(raw) { vm.requestUpdateEvent(BeoEventPatch(serviceFeePct: v)) }
                }
                .accessibilityLabel("Service fee percentage")
                Text("%").font(.caption2).foregroundStyle(LariatBrand.inkFaint)
                Spacer()
                Text(formatDollars(totals.fee, decimals: 2)).monospacedDigit()
            }
            Rectangle().fill(LariatBrand.line).frame(height: 1).padding(.vertical, 2)
            HStack {
                Text("Total")
                    .font(.system(.title3, design: .serif).weight(.semibold))
                Spacer()
                Text(formatDollars(totals.total, decimals: 2))
                    .font(.system(.title3, design: .serif).weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(LariatBrand.clay)
            }
            .accessibilityElement(children: .combine)
        }
        .font(.callout)
        .padding(12)
        .background(LariatBrand.sunk, in: RoundedRectangle(cornerRadius: 8))
        .frame(maxWidth: 360, alignment: .trailing)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.top, 4)
    }

    private func invoiceRow(_ label: String, value: Double) -> some View {
        HStack {
            Text(label).foregroundStyle(LariatBrand.inkSoft)
            Spacer()
            Text(formatDollars(value, decimals: 2)).monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }
```

New lines: `.accessibilityLabel("Tax rate")` on the Tax `CommitTextField`,
`.accessibilityLabel("Service fee percentage")` on the Service-fee `CommitTextField`,
`.accessibilityElement(children: .combine)` on the closing Total `HStack`, and
`.accessibilityElement(children: .combine)` on `invoiceRow`'s `HStack` (which covers the
Subtotal row, its only call site). Every other line is unchanged.

- [ ] **Step 3: Fix `coursesPanel`**

```swift
    private var coursesPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            SerifHeader("Courses")
            Text("Fire times for this event.")
                .font(.caption)
                .foregroundStyle(LariatBrand.inkSoft)
            if vm.courses.isEmpty {
                EmptyState(message: "No courses yet. Add one below.", systemImage: "timer")
            }
            ForEach(vm.courses) { course in
                HStack {
                    HStack {
                        Text(course.courseLabel).fontWeight(.medium)
                        Spacer()
                        Text(BeoCourseRules.isoToLocalHHMM(course.fireAt))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                    Button(role: .destructive) {
                        vm.requestDeleteCourse(id: course.id)
                    } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                    .disabled(vm.isSaving)
                    .accessibilityLabel("Delete \(course.courseLabel)")
                }
                .font(.callout)
            }
            HStack {
                TextField("Course name (e.g. Entree)", text: $vm.newCourseLabel)
                TextField("HH:MM", text: $vm.newCourseTime)
                    .frame(width: 64)
                Button("Add") { vm.requestAddCourse() }
                    .disabled(vm.isSaving)
            }
            .textFieldStyle(.roundedBorder)
            .font(.callout)
        }
    }
```

The course row's label + fire-time `Text`s are now wrapped in an inner `HStack` with
`.accessibilityElement(children: .combine)`; the delete `Button` — with its pre-existing
`.accessibilityLabel("Delete \(course.courseLabel)")` preserved byte-for-byte — stays a
sibling of that inner `HStack`, outside the combine block. The bottom "Add course" row is
untouched (its `TextField`s already carry their own visible placeholders as accessible
names, and "Add" is unambiguous with only one such button on screen).

- [ ] **Step 4: Fix `BeoEventHeaderEditor.labeled()`**

```swift
    private func labeled(_ label: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Eyebrow(label)
            content()
                .accessibilityLabel(label)
        }
    }
```

Only the trailing `.accessibilityLabel(label)` line is new. This single change fixes all
6 call sites in the header `Grid` (Date, Time, Contact, Covers, Min spend, Notes) — none
of the 6 `GridRow`s need their own edit.

- [ ] **Step 5: Fix `BeoLineRowEditor`'s Dynamic-Type risk**

```swift
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                CommitTextField(value: line.itemName, placeholder: "item", font: .body) { raw in
                    let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !t.isEmpty, t != line.itemName { onPatch(BeoLinePatch(itemName: t)) }
                }
                .frame(minWidth: 140)

                coursePicker

                CommitTextField(value: line.orderTime ?? "", placeholder: "5:30pm", width: 70) {
                    if $0 != (line.orderTime ?? "") { onPatch(BeoLinePatch(orderTime: .set($0))) }
                }
                CommitTextField(value: String(line.unitCost), placeholder: "cost", width: 70) {
                    if let v = Double($0), v != line.unitCost { onPatch(BeoLinePatch(unitCost: v)) }
                }
                CommitTextField(value: String(line.quantity), placeholder: "qty", width: 56) {
                    if let v = Double($0), v != line.quantity { onPatch(BeoLinePatch(quantity: v)) }
                }
                Text(formatDollars(BeoWorksheetCompute.lineTotal(unitCost: line.unitCost, quantity: line.quantity), decimals: 2))
                    .monospacedDigit()
                    .frame(minWidth: 80, alignment: .trailing)
                Button(role: .destructive, action: onDelete) {
                    Image(systemName: "xmark.circle")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Remove line")
            }
            HStack(spacing: 8) {
                CommitTextField(value: line.prepNotes ?? "", placeholder: "prep (e.g. Pico de Gallo, mexi slaw)") {
                    if $0 != (line.prepNotes ?? "") { onPatch(BeoLinePatch(prepNotes: .set($0))) }
                }
                CommitTextField(value: line.secondaryPrepNotes ?? "", placeholder: "secondary prep (optional)") {
                    if $0 != (line.secondaryPrepNotes ?? "") { onPatch(BeoLinePatch(secondaryPrepNotes: .set($0))) }
                }
                CommitTextField(value: line.orderItemsNotes ?? "", placeholder: "ingredients to order") {
                    if $0 != (line.orderItemsNotes ?? "") { onPatch(BeoLinePatch(orderItemsNotes: .set($0))) }
                }
            }
            .font(.caption)
            if let amountHint {
                Label(amountHint, systemImage: "number")
                    .font(.caption2)
                    .foregroundStyle(LariatBrand.inkFaint)
            }
        }
        .padding(.vertical, 2)
    }
```

The only change is `.frame(width: 80, alignment: .trailing)` →
`.frame(minWidth: 80, alignment: .trailing)` on the line-total `Text`. The pre-existing
`.accessibilityLabel("Remove line")` on the delete `Button` is preserved byte-for-byte.
`BeoLineRowEditor`'s `coursePicker` computed property is untouched by this task — not
reproduced here since no line in it changes.

- [ ] **Step 6: Fix `menuPanel`'s catalog-row `Button` (optional insurance)**

```swift
    private var menuPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            SerifHeader("Catering menu")
            Text("Pick to add a line with price + prep pre-filled.")
                .font(.caption).foregroundStyle(LariatBrand.inkSoft)
            TextField("Filter menu…", text: $vm.menuFilter)
                .textFieldStyle(.roundedBorder)
            if vm.menu.isEmpty {
                // Missing/corrupt cache is NOT a filter mismatch — say what
                // actually broke and how to fix it.
                EmptyState(
                    message: "Catering menu cache missing — run the menu ingest to rebuild data/cache/catering_menu.json.",
                    systemImage: "exclamationmark.triangle"
                )
            } else if vm.filteredMenu.isEmpty {
                EmptyState(message: "No matches.", systemImage: "magnifyingglass")
            }
            ForEach(vm.filteredMenu, id: \.category) { group in
                DisclosureGroup {
                    ForEach(group.items) { item in
                        Button {
                            vm.requestAddLine(item)
                        } label: {
                            HStack(spacing: 6) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(item.name).foregroundStyle(LariatBrand.ink)
                                    if !item.amountDescription.isEmpty {
                                        Text(item.amountDescription)
                                            .font(.caption2).foregroundStyle(LariatBrand.inkFaint)
                                    }
                                }
                                Spacer()
                                if item.hasPrepDefaults {
                                    Text("prep")
                                        .font(.caption2.weight(.semibold))
                                        .foregroundStyle(LariatBrand.clay)
                                }
                                Text(formatDollars(item.cost, decimals: 2))
                                    .foregroundStyle(LariatBrand.inkSoft)
                                    .monospacedDigit()
                                Image(systemName: "plus.circle.fill")
                                    .foregroundStyle(LariatBrand.terracotta)
                            }
                        }
                        .buttonStyle(.plain)
                        .padding(.vertical, 2)
                        .disabled(vm.isSaving || vm.selectedEvent == nil)
                        .accessibilityElement(children: .combine)
                    }
                } label: {
                    Text(group.category)
                        .font(.system(.subheadline, design: .serif).weight(.semibold))
                        .foregroundStyle(LariatBrand.clay)
                }
                .font(.callout)
            }
        }
    }
```

Only the trailing `.accessibilityElement(children: .combine)` line on the catalog-row
`Button` is new — every other line, including the pre-existing comment above the
`EmptyState` for a missing cache, must be preserved exactly.

- [ ] **Step 7: Build**

Run: `cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-beo/LariatNative && swift build`
Expected: `Build complete!`

- [ ] **Step 8: Commit**

```bash
git add LariatNative/Sources/LariatApp/BeoBoardView.swift
git commit -m "T1: BeoBoardView Part A — combine party/totals/course rows, label header fields + tax/fee, fix line-total Dynamic-Type"
```

---

### Task 2: `BeoBoardView.swift` Part B — read-only reference panels

**Files:**
- Modify: `LariatNative/Sources/LariatApp/BeoBoardView.swift` (`BeoOrderGuidePanel.body`
  ~708-723, `BeoPrepDemandsPanel.body` ~750-759, `BeoFireStationSection` ~822-866,
  `BeoRecipeTreePanel.itemCard` ~999-1020, `RecipeNodeRow.header` ~1067-1088)

**Interfaces:** **Depends on Task 1's commit.** Both tasks edit `BeoBoardView.swift` —
this task must be built sequentially on top of Task 1's committed changes, never
attempted in a parallel worktree, since a parallel diff would conflict or silently
duplicate work in the same file. Confirm `git log --oneline -1` shows Task 1's commit as
the current `HEAD` before starting.

Five zones, covering the Order guide / Prep / Fire tabs and the Recipe tab:

1. **`BeoOrderGuidePanel`** — each `GridRow` (Ingredient / Total needed / Unit / To
   order) reads as 4 separate stops with no color-only signal; combine each data row
   (the header `GridRow` is left untouched — it's just column captions, not data).
2. **`BeoPrepDemandsPanel`** — each row (`displayName` + qty/unit) reads as 2 fragmented
   stops with no color-only signal; combine.
3. **`BeoFireStationSection`** — **the sweep's one confirmed color-only signal**: the
   course fire-time `Text`'s color (green/yellow/red via the existing `color(for
   bucket:)` function) is the *only* carrier of on-time/due-soon/overdue status — no
   spoken equivalent. Fix: add a sibling `statusLabel(for bucket:)` function, switching
   on the same `BeoFireScheduleCompute.AgeBucket` cases as `color(for:)` (not duplicating
   its logic, not inventing a new type — there's no pre-existing `Tone`/status enum in
   this file to reuse instead), and apply it as a custom `.accessibilityLabel` on the
   fire-time `Text` itself. This is a targeted fix, not a general fragmentation cleanup
   of this struct's rows — `BeoFireStationSection` is declared shared with
   `BeoFireScheduleView.swift`, so fixing it here also fixes that file with zero edits
   there.
4. **`BeoRecipeTreePanel.itemCard`** — the header row (item name + timing chips) reads as
   N+1 fragmented stops; every chip already carries visible text (`t.label`, not
   color-only), so this is a pure fragmentation fix — combine.
5. **`RecipeNodeRow.header`** (optional insurance) — the `DisclosureGroup`'s label row
   (name + "in-house" badge + timing + station) reads as up to 4 fragmented stops with no
   separate button inside it (the `DisclosureGroup`'s own disclosure chrome handles the
   expand/collapse tap target) — safe, zero-risk insurance to combine, matching the
   Cook/Purchasing precedent for optional fixes.

- [ ] **Step 1: Fix `BeoOrderGuidePanel`**

```swift
private struct BeoOrderGuidePanel: View {
    let cascade: BeoCascadeOutcome?
    let loading: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if loading {
                    ProgressView("Running the cascade…")
                } else if let cascade {
                    BeoUnmappedCallout(unmapped: cascade.unmapped, engineError: cascade.engineError)
                    if cascade.orderGuide.isEmpty, cascade.unmapped.isEmpty, cascade.engineError == nil {
                        EmptyState(message: "No order guide items for this event yet.", systemImage: "cart")
                    } else {
                        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 4) {
                            GridRow {
                                Text("Ingredient").fontWeight(.semibold)
                                Text("Total needed").fontWeight(.semibold)
                                Text("Unit").fontWeight(.semibold)
                                Text("To order").fontWeight(.semibold)
                            }
                            ForEach(Array(cascade.orderGuide.enumerated()), id: \.offset) { _, row in
                                GridRow {
                                    Text(row.ingredient)
                                    Text(row.totalNeeded.formatted()).monospacedDigit()
                                    Text(row.unit)
                                    Text(row.toOrder.formatted()).monospacedDigit()
                                }
                                .accessibilityElement(children: .combine)
                            }
                        }
                        .font(.callout)
                    }
                } else {
                    EmptyState(message: "Couldn't load order guide — reopen the tab to retry.", systemImage: "cart.badge.questionmark")
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
```

Only the trailing `.accessibilityElement(children: .combine)` on the data `GridRow` is
new. The header `GridRow` (column captions) is untouched.

- [ ] **Step 2: Fix `BeoPrepDemandsPanel`**

```swift
private struct BeoPrepDemandsPanel: View {
    let cascade: BeoCascadeOutcome?
    let loading: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if loading {
                    ProgressView("Running the cascade…")
                } else if let cascade {
                    BeoUnmappedCallout(unmapped: cascade.unmapped, engineError: cascade.engineError)
                    if cascade.prepDemands.isEmpty, cascade.unmapped.isEmpty, cascade.engineError == nil {
                        EmptyState(message: "No prep demands for this event yet.", systemImage: "list.clipboard")
                    } else {
                        ForEach(Array(cascade.prepDemands.enumerated()), id: \.offset) { _, row in
                            HStack {
                                Text(row.displayName)
                                Spacer()
                                Text("\(row.qty.formatted()) \(row.unit)")
                                    .monospacedDigit()
                                    .foregroundStyle(.secondary)
                            }
                            .font(.callout)
                            .accessibilityElement(children: .combine)
                        }
                    }
                } else {
                    EmptyState(message: "Couldn't load prep demands — reopen the tab to retry.", systemImage: "list.clipboard")
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
```

Only the trailing `.accessibilityElement(children: .combine)` on the row `HStack` is new.

- [ ] **Step 3: Fix `BeoFireStationSection` — the confirmed color-only-signal fix**

```swift
/// Shared station block — also used by the standalone fire-schedule board.
struct BeoFireStationSection: View {
    let station: BeoFireScheduleCompute.StationBucket
    var now: Date = Date()

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(station.stationId == BeoFireScheduleCompute.unassigned ? "Unassigned" : station.stationId)
                .font(.headline)
            ForEach(station.courses) { course in
                let bucket = BeoFireScheduleCompute.ageBucketFor(course.fireAt, now: now)
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(course.courseLabel).fontWeight(.medium)
                        Text(course.eventTitle).font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Text(BeoCourseRules.isoToLocalHHMM(course.fireAt))
                            .monospacedDigit()
                            .foregroundStyle(color(for: bucket))
                            .fontWeight(.semibold)
                            .accessibilityLabel("\(BeoCourseRules.isoToLocalHHMM(course.fireAt)), \(statusLabel(for: bucket))")
                    }
                    ForEach(course.lines) { line in
                        HStack(spacing: 6) {
                            Text(line.itemName)
                            Text("×\(line.quantity.formatted())").foregroundStyle(.secondary)
                            if let notes = line.prepNotes {
                                Text(notes).font(.caption).foregroundStyle(.tertiary)
                            }
                        }
                        .font(.callout)
                    }
                }
                .padding(8)
                .background(color(for: bucket).opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    private func color(for bucket: BeoFireScheduleCompute.AgeBucket) -> Color {
        switch bucket {
        case .green: return LariatTheme.ok
        case .yellow: return LariatTheme.warn
        case .red: return LariatTheme.bad
        }
    }

    private func statusLabel(for bucket: BeoFireScheduleCompute.AgeBucket) -> String {
        switch bucket {
        case .green: return "on time"
        case .yellow: return "due soon"
        case .red: return "overdue"
        }
    }
}
```

New: the `statusLabel(for:)` function (a sibling of `color(for:)`, same switch shape,
same three cases, no shared body — it can't call into `color(for:)` since one returns
`Color` and the other `String`) and the `.accessibilityLabel(...)` on the fire-time
`Text`, which now speaks the time and the status word together (e.g. "6:30 PM, due
soon") instead of relying on color alone. Nothing else in this struct changes — this is
a targeted fix, not a fragmentation cleanup of the course/line rows.

- [ ] **Step 4: Fix `BeoRecipeTreePanel.itemCard`**

```swift
    @ViewBuilder
    private func itemCard(_ item: String) -> some View {
        let nodes = breakdown(item)
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                SerifHeader(item)
                Spacer()
                ForEach(timings(item), id: \.self) { t in
                    timingChip(t)
                }
            }
            .accessibilityElement(children: .combine)
            if nodes.isEmpty {
                Text("No in-house recipe breakdown on file — this item plates as-is.")
                    .font(.caption)
                    .foregroundStyle(LariatBrand.inkSoft)
            } else {
                ForEach(nodes) { node in
                    RecipeNodeRow(node: node, depth: 0)
                }
            }
        }
        .worksheetCard(14)
    }

    private func timingChip(_ t: PrepTiming) -> some View {
        Text(t.label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .foregroundStyle(t.accent)
            .background(t.accent.opacity(0.14), in: Capsule())
    }
```

Only the trailing `.accessibilityElement(children: .combine)` on the header `HStack` is
new. `timingChip` is unchanged (each chip already carries visible text via `t.label`, so
`.combine` on the parent correctly concatenates item name + all chip labels).

- [ ] **Step 5: Fix `RecipeNodeRow.header` (optional insurance)**

```swift
    private var header: some View {
        HStack(spacing: 8) {
            Text(node.name)
                .font(.system(.subheadline, design: .serif).weight(.semibold))
                .foregroundStyle(LariatBrand.ink)
            Text("in-house")
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
                .foregroundStyle(LariatBrand.clay)
                .overlay(Capsule().stroke(LariatBrand.clay.opacity(0.4), lineWidth: 1))
            Text(node.timing.label)
                .font(.caption2)
                .foregroundStyle(node.timing.accent)
            if !node.station.isEmpty {
                Text("· \(node.station)")
                    .font(.caption2)
                    .foregroundStyle(LariatBrand.inkFaint)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
```

Only the trailing `.accessibilityElement(children: .combine)` is new. `header` is used as
`DisclosureGroup`'s `label:` — it contains no separate button of its own (the
`DisclosureGroup`'s built-in disclosure chrome is the tap target for expand/collapse), so
combining its content does not nest a control inside `.combine`.

- [ ] **Step 6: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 7: Commit**

```bash
git add LariatNative/Sources/LariatApp/BeoBoardView.swift
git commit -m "T2: BeoBoardView Part B — combine order-guide/prep-demand/recipe-tree rows, verbalize fire-time status"
```

---

### Task 3: `BeoPrepHistoryView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/BeoPrepHistoryView.swift` (`historyRow`
  ~142-167, recent-events `ForEach` block ~120-137)

**Interfaces:** Self-contained — no other task depends on this file, and it does not
depend on Tasks 1-2 (different file entirely).

Two trivial trailing-`.combine` fixes, no color-only signal, no interactive controls in
either zone:

- [ ] **Step 1: Fix `historyRow`**

```swift
    private func historyRow(item: String, row: BeoPrepHistoryRow) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(item).fontWeight(.medium)
                Spacer()
                Text(row.eventDate ?? "undated").font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                Text(row.client ?? "unknown client")
                if let qty = row.amountQty { Text("× \(qty)") }
                if let type = row.type { Text(type).foregroundStyle(.tertiary) }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            if let prepDay = row.prepDay {
                Text("Prep day: \(prepDay)").font(.caption2).foregroundStyle(.secondary)
            }
            if let pre = row.prePrepNotes {
                Text("Pre-prep: \(pre)").font(.caption2).foregroundStyle(.secondary)
            }
            if let plating = row.platingNotes {
                Text("Plating: \(plating)").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
```

Only the trailing `.accessibilityElement(children: .combine)` line is new.

- [ ] **Step 2: Fix the recent-events `ForEach` block**

```swift
            Section("Recent catering events") {
                if vm.recent.isEmpty {
                    EmptyState(message: "No prep history imported yet.", systemImage: "tray")
                }
                ForEach(Array(vm.recent.enumerated()), id: \.offset) { _, event in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(event.eventDate).fontWeight(.medium).monospacedDigit()
                            Text(event.client ?? "unknown client").foregroundStyle(.secondary)
                        }
                        ForEach(Array(event.items.enumerated()), id: \.offset) { _, item in
                            HStack(spacing: 6) {
                                Text(item.item)
                                if let qty = item.amountQty {
                                    Text("× \(qty)").foregroundStyle(.secondary)
                                }
                            }
                            .font(.callout)
                        }
                    }
                    .padding(.vertical, 2)
                    .accessibilityElement(children: .combine)
                }
            }
```

Only the trailing `.accessibilityElement(children: .combine)` on the event `VStack` is
new — every other line, including the `Section` title and the empty-state message, is
unchanged.

- [ ] **Step 3: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/BeoPrepHistoryView.swift
git commit -m "T3: BeoPrepHistoryView — combine history row + recent-events block into single VoiceOver stops"
```

---

### Task 4: Final verification

**Files:** None (verification only).

**Interfaces:** Depends on Tasks 1-3 all committed, in order (Task 2 specifically on top
of Task 1).

- [ ] **Step 1: Full build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 2: Scripted coverage audit (not prose) — only 2 files**

```bash
cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-beo/LariatNative
files=(
  BeoBoardView BeoPrepHistoryView
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
# BeoFireScheduleView.swift is intentionally NOT checked here. It renders
# BeoFireStationSection — a struct declared and fixed in BeoBoardView.swift
# (Task 2) — and is expected to carry ZERO accessibility modifiers of its
# own. That is the correct, designed outcome, not a coverage gap.
if [ "$fail" -eq 0 ]; then
  echo "COVERAGE OK — both files have at least one accessibility modifier"
else
  echo "COVERAGE VIOLATION — see MISSING lines above"
  exit 1
fi
```

Expected: `COVERAGE OK — both files have at least one accessibility modifier`.

- [ ] **Step 3: Scope check (scripted) — expect exactly 2 files, not 3**

```bash
git fetch origin
base=$(git merge-base origin/main HEAD)
expected=$(cat <<'EOF'
LariatNative/Sources/LariatApp/BeoBoardView.swift
LariatNative/Sources/LariatApp/BeoPrepHistoryView.swift
EOF
)
actual=$(git diff --name-only "$base" -- LariatNative)
if diff <(echo "$expected" | sort) <(echo "$actual" | sort) > /tmp/h7a-phase2-beo-scope-diff.txt; then
  echo "SCOPE OK — exactly the expected 2 files changed under LariatNative/"
else
  echo "SCOPE VIOLATION:"
  cat /tmp/h7a-phase2-beo-scope-diff.txt
  exit 1
fi

# Belt-and-suspenders: BeoFireScheduleView.swift must show literally zero
# diff lines, confirming it correctly inherited Task 2's fix without a
# direct edit of its own.
if git diff --quiet "$base" -- LariatNative/Sources/LariatApp/BeoFireScheduleView.swift; then
  echo "CONFIRMED — BeoFireScheduleView.swift has zero diff, as expected (inherits its fix from the shared BeoFireStationSection struct)"
else
  echo "UNEXPECTED — BeoFireScheduleView.swift changed; investigate before treating scope as OK"
  exit 1
fi
```

Expected: `SCOPE OK — exactly the expected 2 files changed under LariatNative/` followed
by `CONFIRMED — BeoFireScheduleView.swift has zero diff...`.

- [ ] **Step 4: Mandatory final whole-branch review**

Dispatch an independent review comparing the `BeoBoardView.swift` diff (Task 1 + Task 2
together) and the `BeoPrepHistoryView.swift` diff side by side — not a re-review of each
task individually. Specifically check:
- Do Task 1 and Task 2's edits to `BeoBoardView.swift` conflict or duplicate work in the
  same function? (They should touch entirely disjoint zones — Task 1 the editing
  surface, Task 2 the read-only panels.)
- Does any step nest a `Button`, `Link`, or `Menu` inside a `.accessibilityElement
  (children: .combine)` block? (`coursesPanel`'s delete button and `BeoLineRowEditor`'s
  remove button must both remain explicit siblings, not descendants, of any `.combine`
  block.)
- Are the two pre-existing `.accessibilityLabel` strings (`"Delete
  \(course.courseLabel)"`, `"Remove line"`) byte-for-byte unchanged from before this
  branch?
- Does `BeoFireScheduleView.swift` correctly show zero diff, confirming
  `BeoFireStationSection`'s fix in Task 2 benefits both call sites without a direct edit
  to that file?
- Do all fixes use consistent wording/structure for equivalent situations (e.g. do the
  field-label fixes in Task 1 and the color-only-signal fix in Task 2 both read
  naturally when spoken aloud)?

- [ ] **Step 5: Manual VoiceOver spot-check (documented, non-gating)**

Needs a real desktop session — not verifiable headless (same limitation as Phase 1/Cook/
Purchasing). Turn on VoiceOver (Cmd+F5), open the BEO board, and confirm:
- The party sidebar list announces title + date/time/covers per row.
- The Tax and Service-fee fields announce "Tax rate" / "Service fee percentage" instead
  of "rate" / "%".
- The 6 header fields (Date, Time, Contact, Covers, Min spend, Notes) announce their
  field name instead of a placeholder example value.
- A course row's delete button still announces "Delete <course name>" and still deletes
  on activation (same class of risk as Phase 1's `SdsView` defect).
- The Fire tab's course fire-time announces "<time>, on time" / "due soon" / "overdue"
  matching its color, not just a bare time.
- The Recipe tab's item header announces the item name followed by its timing chip
  labels in one pass.

- [ ] **Step 6: Open PR**

```bash
git push -u origin feat/lariat-native-h7a-phase2-beo
gh pr create --base main --head feat/lariat-native-h7a-phase2-beo \
  --title "feat(native): H7a Phase 2 — VoiceOver labels for .beo tier" \
  --body "See docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-beo-tier-design.md and docs/superpowers/plans/2026-07-05-lariat-native-h7a-phase2-beo-tier.md for full detail. 3 implementation tasks (T1: BeoBoardView Part A, T2: BeoBoardView Part B, T3: BeoPrepHistoryView), one commit per task, plus this T4 scripted verification + whole-branch review. BeoFireScheduleView.swift intentionally shows zero diff — it inherits its fix from the shared BeoFireStationSection struct fixed in T2. PinEntrySheet.swift intentionally out of scope (shared across 19 files, nearly every tier) — deferred to its own follow-up task."
```

**Commit message:** none (verification only).

---

## Self-Review

**1. Spec coverage:** Goal (VoiceOver labels + verbalize the 1 confirmed color-only
signal + fix the 1 confirmed Dynamic-Type risk across the `.beo` tier, with
`BeoFireScheduleView.swift` receiving zero direct edits) ✓ — Task 1 covers the editing
surface, Task 2 the read-only panels, Task 3 the standalone prep-history board. Non-goals
(`PinEntrySheet`, `EmptyState`/`TileDegrade`, the other 7 remaining tiers, `LariatModel`
extraction, new dependency) — no task violates any of these. Invariants — every touched
interactive control now has an unambiguous label naming its target or field identity
(Tax/Service-fee `CommitTextField`s, the 6 header fields via `labeled()`, the
`menuPanel`/course-delete buttons keep or gain correct labels); the one status-bearing
element relying on color alone (`BeoFireStationSection`'s fire-time text) now also
verbalizes its state via `statusLabel(for:)`; no interactive control is ever nested
inside a `.combine` block in any task (`coursesPanel`'s restructuring and
`BeoLineRowEditor`'s untouched delete button both keep controls as siblings). Testing/
acceptance — Task 4's scripted coverage (2 files, not 3) + scope-diff check (exactly
`BeoBoardView.swift` + `BeoPrepHistoryView.swift`) + the explicit
`BeoFireScheduleView.swift` zero-diff check + mandatory whole-branch review mirror the
Phase 1/Cook/Purchasing precedent exactly, with the extra zero-diff check this tier's
spec specifically calls for; the manual VoiceOver spot-check is documented as
non-gating.

**2. Placeholder scan:** No "TBD"/"add appropriate handling"/"similar to Task N"
language anywhere — every step shows the complete before/after code for its zone, not a
diff snippet or a prose description. Untouched helper functions adjacent to a touched
zone (`BeoLineRowEditor.coursePicker`, `BeoRecipeTreePanel.timingChip`) are explicitly
called out as unchanged rather than silently omitted.

**3. Type consistency:** `statusLabel(for:)` (Task 2, Step 3) switches on the exact same
`BeoFireScheduleCompute.AgeBucket` type and the same three cases (`.green`/`.yellow`/
`.red`) as the pre-existing `color(for:)` in the same struct — confirmed by reading the
struct directly during the audit, not invented, and it does not duplicate `color(for:)`'s
body (impossible anyway, since one returns `Color` and the other `String`).
`BeoEventHeaderEditor.labeled()`'s fix is a single shared helper — all 6 `Grid` call
sites (Date, Time, Contact, Covers, Min spend, Notes) benefit without any call-site edit,
confirmed by reading all 6 sites route through `labeled(...)`. No task declares a
duplicate type or helper another task also declares, and Task 1/Task 2's zones are
confirmed disjoint (Task 1: `partyRow`, `totalsFooter`/`invoiceRow`, `coursesPanel`,
`BeoEventHeaderEditor.labeled()`, `BeoLineRowEditor`, `menuPanel`; Task 2:
`BeoOrderGuidePanel`, `BeoPrepDemandsPanel`, `BeoFireStationSection`,
`BeoRecipeTreePanel.itemCard`, `RecipeNodeRow.header`) — no overlap in touched
functions/structs between the two tasks.
