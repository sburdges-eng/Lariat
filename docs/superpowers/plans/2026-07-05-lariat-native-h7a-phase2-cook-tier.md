# LariatNative H7a Phase 2 — Cook tier: VoiceOver labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VoiceOver labels + verbalize the 3 confirmed color-only signals across the
10 `.cook`-tier board views that currently have zero or partial accessibility coverage.

**Architecture:** Per-file, inline `.accessibilityElement(children: .combine)` +
`.accessibilityLabel(...)` additions matching `SanitizerView.swift`'s existing house
pattern — no extraction to `LariatModel`, no new types, no new dependency. Each task
touches exactly one file. Where a row mixes read-only info with an interactive control
(button/link/menu), the info is combined into its own accessibility element and the
control stays a sibling outside it — never nested inside `.combine`.

**Tech Stack:** SwiftUI (macOS), no new packages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-cook-tier-design.md`.
- No new dependency (this codebase has exactly one — GRDB — today).
- No extraction of accessibility-label strings into `LariatModel` — inline in the View
  body, matching `SanitizerView.swift:73`.
- No XCTest is possible for this work — `LariatApp` has no test target. Acceptance per
  task is `swift build` clean. The final task runs a scripted coverage + scope audit
  instead of a unit test.
- **`CookIdentityPicker.swift` is out of scope.** It is presented from 19 call sites
  across 4 tiers (Safety, Cook, FOH, plus the shared `CookIdentityStore` interrupt
  family), not the Cook tier alone. Do not touch it in this plan — it gets its own
  standalone task later.
- The other 9 remaining `FeatureTier`s (labor, inventory, manager, costing, purchasing,
  foh, shows, house, beo) are out of scope — do not touch any file outside the 10 named
  below.
- Every task's changes are strictly additive (accessibility modifiers only) — no
  behavior change for a sighted user, except the structural splits noted per-task to keep
  interactive controls outside `.combine` blocks.
- **Line ranges below are locators from the pre-implementation audit, not guaranteed
  exact** — if a file has drifted since the audit, locate the named function/struct by
  name rather than trusting the line number, and verify with the build step rather than
  guessing (same discipline as Phase 1's Task 13).
- Zero Dynamic-Type (`width` → `minWidth`) fixes are needed in this tier — every
  fixed-size `.frame()` hit found during the audit was a decorative status dot, not a
  text column. No task below includes such a change.

---

### Task 1: `TodayView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/TodayView.swift` (five spots: `statCard`
  ~114-134/264-272, `actionCard`/`actionRow` ~136-158, `stationCard` ~160-204,
  stock-move rows ~206-233, `eightySixSection` ~235-261)

**Interfaces:** Self-contained — no other task depends on this file.

Five gaps: (1) `statCard`'s value+label pair reads as 2 separate stops; (2)
`actionCard`/`actionRow` — lower-confidence, SwiftUI Buttons typically auto-flatten their
label's text, but add `.combine` anyway as cheap, zero-risk insurance matching house
style; (3) `stationCard` — name + tone-colored status text (already verbal via
`StationProgressLabels.label(for:)`, so NOT color-only, just fragmented) + a purely
decorative tone dot; (4) stock-move rows read as 2 separate stops with no control; (5)
**`eightySixSection` chips — the one confirmed color-only gap in this file**: 86'd items
(red chip) and cascade-affected recipes (orange chip) render as visually-identical bare
`Text` with no spoken distinction between "genuinely out" and "affected because an
ingredient cascaded."

- [ ] **Step 1: Fix `statCard`**

```swift
private func statCard(value: String, label: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(value).font(.title.bold())
        Text(label).font(.caption).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, minHeight: 86, alignment: .leading)
    .padding(14)
    .background(.background.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(value) \(label)")
}
```

- [ ] **Step 2: Fix `actionCard`**

```swift
private func actionCard(eyebrow: String, title: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(eyebrow).font(.caption.weight(.heavy)).foregroundStyle(.secondary).textCase(.uppercase)
        Text(title).font(.headline)
    }
    .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
    .padding(16)
    .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(eyebrow): \(title)")
}
```

- [ ] **Step 3: Fix `stationCard`**

```swift
private func stationCard(_ row: StationWithProgress) -> some View {
    let tone = StationProgressLabels.tone(for: row.progress)
    return HStack {
        VStack(alignment: .leading, spacing: 6) {
            Text(row.station.name).font(.headline)
            Text(StationProgressLabels.label(for: row.progress))
                .font(.subheadline.weight(.bold))
                .foregroundStyle(LariatTheme.color(for: tone))
        }
        Spacer(minLength: 8)
        Circle()
            .fill(LariatTheme.color(for: tone))
            .frame(width: 12, height: 12)
    }
    .frame(minHeight: 78)
    .padding(14)
    .background(.background.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(row.station.name), \(StationProgressLabels.label(for: row.progress))")
}
```

- [ ] **Step 4: Fix the stock-moves rows**

```swift
private func stockMovesSection(_ snap: TodayBoardSnapshot) -> some View {
    VStack(alignment: .leading, spacing: 12) {
        HStack {
            Text("Stock moves").font(.title3.bold())
            Spacer()
            Text("Latest").font(.caption).foregroundStyle(.secondary)
        }
        if snap.recentMoves.isEmpty {
            EmptyState(message: "No stock moves yet", systemImage: "shippingbox")
                .padding(10)
                .background(.background.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
        } else {
            ForEach(Array(snap.recentMoves.enumerated()), id: \.offset) { _, move in
                HStack {
                    Text(move.item).font(.headline)
                    Spacer()
                    Text(stockMoveDetail(move))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(10)
                .background(.background.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
                .accessibilityElement(children: .combine)
            }
        }
    }
    .padding()
    .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
}
```

- [ ] **Step 5: Fix `eightySixSection` — the confirmed color-only gap**

```swift
private func eightySixSection(_ snap: TodayBoardSnapshot) -> some View {
    VStack(alignment: .leading, spacing: 12) {
        HStack {
            Text("86 right now").font(.title3.bold())
            Spacer()
            Text(openCountLabel(snap.openEightySixItems.count))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        FlowLayout(spacing: 8) {
            ForEach(Array(snap.openEightySixItems.enumerated()), id: \.offset) { _, item in
                Text(item)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(Color.red.opacity(0.2), in: Capsule())
                    .accessibilityLabel("\(item), 86’d")
            }
            ForEach(snap.cascadedRecipes, id: \.slug) { recipe in
                Text(recipe.name)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(Color.orange.opacity(0.18), in: Capsule())
                    .accessibilityLabel("\(recipe.name), affected — via \(recipe.via)")
            }
        }
    }
    .padding()
    .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
}
```

- [ ] **Step 6: Build**

Run: `cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-cook/LariatNative && swift build`
Expected: `Build complete!`

- [ ] **Step 7: Commit**

```bash
git add LariatNative/Sources/LariatApp/TodayView.swift
git commit -m "T1: TodayView — VoiceOver labels + verbalize 86-vs-cascade chip distinction"
```

---

### Task 2: `EightySixView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/EightySixView.swift` (`cascadeSection`
  ~144-167, `activeSection` ~184-202, `resolvedSection` ~211-221)

**Interfaces:** Self-contained.

No color-only signal in this file. Gaps: active/resolved rows read as fragmented stops;
`"Back on menu"` doesn't name the item; cascade Confirm/Cancel don't name the recipe.

- [ ] **Step 1: Fix `cascadeSection`**

```swift
private func cascadeSection(_ cascaded: [CascadedRecipe]) -> some View {
    VStack(alignment: .leading, spacing: 10) {
        Text("Also hits the menu").font(.headline)
        ForEach(cascaded, id: \.slug) { recipe in
            if vm.confirmCascade?.slug == recipe.slug {
                HStack {
                    Text(recipe.name)
                    Spacer()
                    Button("Confirm") {
                        Task { await submitCascadeConfirm(recipe) }
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityLabel("Confirm adding \(recipe.name)")
                    Button("Cancel") { vm.confirmCascade = nil }
                        .accessibilityLabel("Cancel adding \(recipe.name)")
                }
            } else {
                Button {
                    vm.confirmCascade = recipe
                } label: {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(recipe.name).font(.headline)
                            Text("via \(recipe.via)").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "plus.circle")
                    }
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(recipe.name), via \(recipe.via)")
            }
        }
    }
    .padding()
    .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
}
```

- [ ] **Step 2: Fix `activeSection`**

```swift
private func activeSection(_ rows: [EightySixRow], totalCount: Int) -> some View {
    VStack(alignment: .leading, spacing: 10) {
        Text("Out now").font(.headline)
        if rows.isEmpty {
            if totalCount > 0 {
                EmptyState(message: "No items match “\(query)”", systemImage: "magnifyingglass")
            } else {
                EmptyState(message: "Nothing out right now", systemImage: "checkmark.circle")
            }
        } else {
            ForEach(rows) { row in
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.item).font(.headline)
                        if let meta = activeMeta(row) {
                            Text(meta).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    Spacer()
                    Button(vm.isResolving(row.id) ? "…" : "Back on menu") {
                        Task { await submitResolve(id: row.id) }
                    }
                    .buttonStyle(.bordered)
                    .disabled(vm.isResolving(row.id))
                    .accessibilityLabel("Put \(row.item) back on the menu")
                }
                .padding(10)
                .background(.background.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }
    .padding()
    .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
}
```

- [ ] **Step 3: Fix `resolvedSection`**

```swift
private func resolvedSection(_ rows: [EightySixRow]) -> some View {
    VStack(alignment: .leading, spacing: 10) {
        Text("Resolved today (\(rows.count))").font(.headline)
        ForEach(rows) { row in
            HStack {
                Text(row.item)
                Spacer()
                if let meta = resolvedMeta(row) {
                    Text(meta).font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(8)
            .background(.background.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
            .accessibilityElement(children: .combine)
        }
    }
    .padding()
    .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
}
```

- [ ] **Step 4: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatApp/EightySixView.swift
git commit -m "T2: EightySixView — combine rows + label back-on-menu/cascade actions"
```

---

### Task 3: `StationsListView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/StationsListView.swift:57-70` (`stationRow`)

**Interfaces:** Self-contained. Reuses the same `StationProgressLabels`/`LariatTheme`
helpers as Task 1's `TodayView.stationCard` — keep the label wording identical since
both render the same underlying station-progress data.

Same shape as `TodayView`'s `stationCard`: name + already-verbal status text (not
color-only) + a decorative tone dot, fragmented across up to 3 stops.

- [ ] **Step 1: Fix `stationRow`**

```swift
private func stationRow(_ row: StationListRow) -> some View {
    let tone = StationProgressLabels.tone(for: row.progress)
    return HStack {
        VStack(alignment: .leading, spacing: 4) {
            Text(row.station.name).font(.headline)
            Text(StationProgressLabels.label(for: row.progress))
                .font(.subheadline)
                .foregroundStyle(LariatTheme.color(for: tone))
        }
        Spacer()
        Circle().fill(LariatTheme.color(for: tone)).frame(width: 10, height: 10)
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(row.station.name), \(StationProgressLabels.label(for: row.progress))")
}
```

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/StationsListView.swift
git commit -m "T3: StationsListView — combine station rows into one VoiceOver element"
```

---

### Task 4: `StationChecklistView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/StationChecklistView.swift:141-162`
  (`statusButton`)

**Interfaces:** Self-contained. Reuses the `.isSelected` `accessibilityAddTraits` idiom
already established in this codebase at `DatapackSearchView.swift:86` — do not invent a
new pattern for "currently selected" state.

**Confirmed color-only gap:** `.tint(state.status == status ? .accentColor : .secondary)`
is the ONLY indicator of which status (Pass/Fail/N/A) is currently recorded for a line
item — no spoken equivalent. The button labels ("Pass"/"Fail"/"N/A") also don't name the
item.

`countField` TextFields and the glove-change `Toggle` already carry their own visible
labels ("Par"/"Have"/"Need"/"Gloves changed") — no gap, leave untouched.
**Considered-and-rejected:** `countField`'s `.frame(maxWidth: 90)` is a `maxWidth`
ceiling on a `TextField` (which scrolls, not clips), not a fixed-`width` `Text` column —
this is NOT a Dynamic-Type risk, do not touch it.

- [ ] **Step 1: Fix `statusButton`**

```swift
private func statusButton(
    item: String,
    label: String,
    status: LineCheckStatus,
    state: LineCheckItemState
) -> some View {
    Button(label) {
        let note = noteDrafts[item] ?? state.note
        let par = parDrafts[item] ?? state.par
        let have = haveDrafts[item] ?? state.have
        let need = needDrafts[item] ?? state.need
        let glove: Bool? = (gloveDrafts[item] ?? (state.gloveChangeAttested == true)) ? true : nil
        Task {
            await submitPost(item: item, status: status, par: par, have: have, need: need, note: note, glove: glove)
        }
    }
    .buttonStyle(.bordered)
    .tint(state.status == status ? .accentColor : .secondary)
    .disabled(vm.isSaving || vm.snapshot?.signoff != nil)
    .accessibilityLabel("Mark \(item) \(label)")
    .accessibilityAddTraits(state.status == status ? [.isSelected] : [])
}
```

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/StationChecklistView.swift
git commit -m "T4: StationChecklistView — verbalize Pass/Fail/N/A selection state"
```

---

### Task 5: `KdsPunchView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/KdsPunchView.swift` (`ticketRow` ~114-138,
  draft-line rows ~89-96)

**Interfaces:** Self-contained.

No color-only signal (the green "Bumped" label already says so in text). Gaps:
`ticketRow`'s info block isn't combined; `"Bump"`/`"Remove"` don't name their target.

- [ ] **Step 1: Fix `ticketRow`**

```swift
@ViewBuilder
private func ticketRow(_ ticket: KdsOpenTicket) -> some View {
    HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 4) {
            Text("Order \(ticket.orderNumber)").font(.headline)
            Text(ticket.placedAt).font(.caption).foregroundStyle(.secondary)
            ForEach(ticket.lines) { line in
                Text("\(line.quantity)× \(line.itemName) · \(line.station)")
                    .font(.subheadline)
            }
        }
        .accessibilityElement(children: .combine)
        Spacer()
        if let bumpedAt = ticket.bumpedAt {
            Label(bumpedLabel(bumpedAt), systemImage: "checkmark.circle.fill")
                .font(.caption)
                .foregroundStyle(.green)
        } else {
            Button(vm.isBumping(ticket.id) ? "…" : "Bump") {
                Task { await vm.bump(ticket.id) }
            }
            .buttonStyle(.borderedProminent)
            .disabled(vm.isBumping(ticket.id))
            .accessibilityLabel("Bump order \(ticket.orderNumber)")
        }
    }
}
```

- [ ] **Step 2: Fix the draft-line rows**

```swift
if !draftLines.isEmpty {
    ForEach(Array(draftLines.enumerated()), id: \.offset) { idx, line in
        HStack {
            Text("\(line.quantity)× \(line.itemName) · \(line.station)")
            Spacer()
            Button("Remove") { draftLines.remove(at: idx) }
                .font(.caption)
                .accessibilityLabel("Remove line \(line.itemName)")
        }
    }
}
```

- [ ] **Step 3: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/KdsPunchView.swift
git commit -m "T5: KdsPunchView — combine ticket rows + label Bump/Remove actions"
```

---

### Task 6: `PrepView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/PrepView.swift` (`taskRow` ~172-192,
  `actionButtons` ~222-260, `closedSection` ~267-288)

**Interfaces:** Self-contained. Already has one pre-existing modifier
(`.accessibilityLabel("Drop \(row.task)")` on the destructive ✕ button) — preserve it,
it's folded into Step 2 below unchanged.

No color-only signal: `priorityBadge`'s tint and `rowBackground`'s matching tint are
redundant with the badge's own visible text ("Rush"/"High"), not color-only. Gaps: the
info block isn't combined; action buttons ("Claim"/"Start"/"Drop claim"/"Done"/"Skip")
don't name the task; `closedSection` rows aren't combined and `"Reopen"` doesn't name the
task. Three sub-steps given the file's size (largest in this tier, 3 distinct zones).

- [ ] **Step 1: Fix `taskRow`'s info block**

```swift
@ViewBuilder
private func taskRow(_ row: PrepTaskRow) -> some View {
    let busy = vm.isBusy(row.id)
    VStack(alignment: .leading, spacing: 6) {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(row.task).font(.headline)
                    if let qty = row.qty, !qty.isEmpty {
                        Text(qty).font(.subheadline).foregroundStyle(.secondary)
                    }
                    priorityBadge(row.priorityLevel)
                }
                Text(metaLine(row)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(taskAccessibilityLabel(row))
        actionButtons(row, busy: busy)
    }
    .padding(10)
    .background(rowBackground(row.priorityLevel), in: RoundedRectangle(cornerRadius: 8))
}

private func taskAccessibilityLabel(_ row: PrepTaskRow) -> String {
    var parts = [row.task]
    if let qty = row.qty, !qty.isEmpty { parts.append(qty) }
    if row.priorityLevel != .normal { parts.append(row.priorityLevel.label) }
    parts.append(metaLine(row))
    return parts.joined(separator: ", ")
}
```

- [ ] **Step 2: Fix `actionButtons`**

```swift
@ViewBuilder
private func actionButtons(_ row: PrepTaskRow, busy: Bool) -> some View {
    HStack(spacing: 8) {
        if row.statusValue == .todo && (row.assignedCookId?.isEmpty ?? true) {
            Button(vm.cookId != nil ? "Claim" : "Set cook first") {
                Task { await submitClaim(row.id) }
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy)
            .accessibilityLabel(vm.cookId != nil ? "Claim \(row.task)" : "Set a cook before claiming \(row.task)")
        }
        if row.statusValue == .todo && !(row.assignedCookId?.isEmpty ?? true) {
            Button("Start") { Task { await submitStatus(row.id, .inProgress) } }
                .buttonStyle(.bordered)
                .disabled(busy)
                .accessibilityLabel("Start \(row.task)")
            if isMine(row) {
                Button("Drop claim") { Task { await vm.releaseClaim(row.id) } }
                    .buttonStyle(.bordered)
                    .disabled(busy)
                    .accessibilityLabel("Drop your claim on \(row.task)")
            }
        }
        if row.statusValue == .inProgress {
            Button("Done") { Task { await submitStatus(row.id, .done) } }
                .buttonStyle(.borderedProminent)
                .disabled(busy)
                .accessibilityLabel("Mark \(row.task) done")
            Button("Skip") { Task { await submitStatus(row.id, .skipped) } }
                .buttonStyle(.bordered)
                .disabled(busy)
                .accessibilityLabel("Skip \(row.task)")
        }
        Button(role: .destructive) {
            deleteTarget = row
        } label: {
            Image(systemName: "xmark")
        }
        .buttonStyle(.bordered)
        .disabled(busy)
        .accessibilityLabel("Drop \(row.task)")
    }
    .frame(minHeight: 44)
}
```

- [ ] **Step 3: Fix `closedSection`**

```swift
private func closedSection(_ rows: [PrepTaskRow]) -> some View {
    VStack(alignment: .leading, spacing: 10) {
        Text("Done · \(rows.count)").font(.headline)
        ForEach(rows) { row in
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.task)
                        .strikethrough(row.statusValue == .skipped)
                    Text(closedMeta(row)).font(.caption).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                Spacer()
                Button("Reopen") { Task { await vm.setStatus(row.id, .todo) } }
                    .buttonStyle(.bordered)
                    .disabled(vm.isBusy(row.id))
                    .accessibilityLabel("Reopen \(row.task)")
            }
            .padding(8)
            .background(.background.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
        }
    }
    .padding()
    .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
}
```

- [ ] **Step 4: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatApp/PrepView.swift
git commit -m "T6: PrepView — combine task rows + label all action buttons by task"
```

---

### Task 7: `PrepParView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/PrepParView.swift:154-167` (`rowView`)

**Interfaces:** Self-contained.

No color-only signal. Straightforward fragmented-read + unlabeled-button fix, same shape
as Phase 1's `DateMarkView` task.

- [ ] **Step 1: Fix `rowView`**

```swift
@ViewBuilder
private func rowView(_ row: PrepParRow) -> some View {
    HStack {
        VStack(alignment: .leading, spacing: 4) {
            Text(row.label).font(.headline)
            Text(metaLine(row))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        Spacer()
        Button("Remove") { deleteTarget = row }
            .font(.caption)
            .accessibilityLabel("Remove \(row.label)")
    }
}
```

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/PrepParView.swift
git commit -m "T7: PrepParView — combine row + label Remove button by item"
```

---

### Task 8: `MorningView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/MorningView.swift:107-123` (`topHeadsUp`)

**Interfaces:** Self-contained.

**Confirmed color-only gap:** the severity dot (`Circle().fill(alert.severity == .red ?
Color.red : Color.orange)`) is the only signal distinguishing a critical alert from a
warning — `alert.message` carries no severity word. All other sections in this file
(`eightySixSection`, `priceShocksSection`, `certsSection`, `maintenanceSection`,
`beoPrepSection`) already render one self-describing `Text` per row with no color coding
— no gap there, do not touch them.

**Before implementing:** confirm the exact type/case name for `alert.severity` by reading
the alert model's declaration (do not assume `MorningAlertSeverity` — verify against the
actual source, then use the confirmed name in `severityWord`'s parameter type).

- [ ] **Step 1: Fix `topHeadsUp`**

```swift
private var topHeadsUp: some View {
    MorningSectionCard(title: "Top heads-up",
                       sub: "\(digest.alerts.count) live alerts") {
        if digest.alerts.isEmpty {
            Text("No red flags right now.").foregroundStyle(.secondary)
        } else {
            ForEach(Array(digest.alerts.prefix(5).enumerated()), id: \.offset) { _, alert in
                HStack(spacing: 8) {
                    Circle()
                        .fill(alert.severity == .red ? Color.red : Color.orange)
                        .frame(width: 7, height: 7)
                    Text(alert.message).font(.callout)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(severityWord(alert.severity)): \(alert.message)")
            }
        }
    }
}

private func severityWord(_ severity: MorningAlertSeverity) -> String {
    severity == .red ? "Critical" : "Warning"
}
```

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`. If `MorningAlertSeverity` is not the actual type name, fix
`severityWord`'s parameter type to match what the file actually declares before treating
this as a build failure.

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/MorningView.swift
git commit -m "T8: MorningView — verbalize alert severity in top-heads-up rows"
```

---

### Task 9: `DatapackSearchView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/DatapackSearchView.swift` (`usdaDetail`
  ~120-143, `offDetail` ~145-160, `fdaDetail` ~162-177, `wikibooksDetail` ~179-195)

**Interfaces:** Self-contained. Already has one pre-existing modifier —
`.accessibilityAddTraits(vm.isOpen(hit) ? [.isSelected] : [])` on the disclosure button
in `hitRow` (line ~86) — preserve as-is, do not touch it; it's the source pattern Task 4
reuses.

No color-only signal in the 4 detail panels. Four independent sub-fixes:

- `usdaDetail`: combine the header block; combine each nutrient row **individually**
  (do NOT merge the whole nutrient list into one giant stop — each nutrient stays its own
  browsable stop).
- `offDetail`: no interactive controls, safe to combine as one block.
- `fdaDetail`: combine the 2-line header only; leave the `ScrollView { Text(body) }`
  **uncombined and separate** (folding a long scrollable body into the header would
  create one enormous spoken block).
- `wikibooksDetail`: **structural care required** — do not wrap the whole outer `VStack`
  in `.combine` (would swallow the `Link`'s tap target). Split into an inner combined
  info block + the `Link` left as a sibling, matching Phase 1's `CoolingView`
  restructuring.

- [ ] **Step 1: Fix `usdaDetail`**

```swift
@ViewBuilder
private func usdaDetail(_ food: UsdaFood, _ nutrients: [UsdaNutrient]) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(food.description ?? "(no description)").font(.caption.weight(.semibold))
        Text("fdc_id \(food.fdcId)"
             + (food.foodCategory.map { " · \($0)" } ?? "")
             + (food.brandOwner.map { " · \($0)" } ?? "")
             + (food.sourceArchive.map { " · \($0)" } ?? ""))
            .font(.caption2).foregroundStyle(.secondary)
    }
    .accessibilityElement(children: .combine)
    Group {
        let top = DatapackSearchCompute.pickTopNutrients(nutrients)
        if top.isEmpty {
            Text("No top-line nutrients reported.").font(.caption2).foregroundStyle(.secondary)
        } else {
            ForEach(top, id: \.nutrientId) { n in
                HStack {
                    Text(n.nutrientName ?? "").foregroundStyle(.secondary)
                    Spacer()
                    Text("\(n.amount.map { JsValueFormat.numberString($0) } ?? "")\(n.unitName.map { " \($0)" } ?? "")")
                        .monospacedDigit()
                }
                .font(.caption2)
                .accessibilityElement(children: .combine)
            }
        }
    }
}
```

- [ ] **Step 2: Fix `offDetail`**

```swift
@ViewBuilder
private func offDetail(_ product: OffProduct) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(product.productName ?? "(no product name)").font(.caption.weight(.semibold))
        Text("code \(product.code)" + (product.brands.map { " · \($0)" } ?? ""))
            .font(.caption2).foregroundStyle(.secondary)
        if let ingredients = product.ingredientsText, !ingredients.isEmpty {
            Text("Ingredients").font(.caption2).foregroundStyle(.secondary)
            Text(ingredients).font(.caption2)
        }
        let allergens = AllergenLookupHelpers.parseAllergenTags(product.allergensTagsJson)
        if !allergens.isEmpty {
            Text("Allergens: " + allergens.joined(separator: ", ")).font(.caption2)
        }
    }
    .accessibilityElement(children: .combine)
}
```

- [ ] **Step 3: Fix `fdaDetail`**

```swift
@ViewBuilder
private func fdaDetail(_ section: FdaSection) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        VStack(alignment: .leading, spacing: 2) {
            Text(section.title ?? "(no title)").font(.caption.weight(.semibold))
            Text((section.sectionId.map { "\($0) · " } ?? "")
                 + (section.chapter.map { "Ch. \($0)" } ?? "")
                 + (section.annex.map { "Annex \($0)" } ?? ""))
                .font(.caption2).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        ScrollView {
            Text(section.body)
                .font(.caption2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 240)
    }
}
```

- [ ] **Step 4: Fix `wikibooksDetail`**

```swift
@ViewBuilder
private func wikibooksDetail(_ page: WikibooksPage) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        VStack(alignment: .leading, spacing: 4) {
            Text(page.title ?? "(no title)").font(.caption.weight(.semibold))
            if let slug = page.slug {
                Text(slug).font(.caption2).foregroundStyle(.secondary)
            }
            if let summary = page.plainTextSummary, !summary.isEmpty {
                Text(summary).font(.caption2)
            } else {
                Text("No summary in index.").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        if let urlString = page.sourceUrl, let url = URL(string: urlString) {
            Link(urlString, destination: url).font(.caption2)
        }
    }
}
```

- [ ] **Step 5: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 6: Commit**

```bash
git add LariatNative/Sources/LariatApp/DatapackSearchView.swift
git commit -m "T9: DatapackSearchView — combine detail-panel info blocks, keep Link a sibling"
```

---

### Task 10: `KitchenAssistantView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/KitchenAssistantView.swift` (`composer`
  ~207-212, `turnRow` ~137-170)

**Interfaces:** Self-contained.

**Confirmed gap:** the composer's send button is icon-only
(`Image(systemName: "paperplane.fill")`) with zero accessibility label. `turnRow`'s
assistant case has the message bubble, an optional Undo button, an optional undo-message
label, source chips, and a model/latency caption all as separate stops — combine the
bubble text + latency caption into one stop, but leave the Undo **button** and
`sourcesChips` as siblings (never nested inside `.combine`) since each chip is meant to
stay independently browsable, same as any other chip list in this codebase.

`bubbleColor`'s background tint (error/blocked/executed/neutral) is a **soft, optional**
finding, not a required fix — the assistant's own natural-language reply text is expected
to already narrate the outcome conversationally. Do not add a spoken severity prefix in
this task; that's an explicit non-goal for this pass. `reachabilityBadge`/`tierBadge`
already have visible text inside their labels — no gap, leave untouched.

- [ ] **Step 1: Fix the composer's send button**

```swift
private var composer: some View {
    HStack(spacing: 8) {
        TextField(
            "Ask LaRi… (\"what's 86?\", \"86 the salmon\", \"scale chicken stock by 2\")",
            text: $model.input,
            axis: .vertical
        )
        .textFieldStyle(.roundedBorder)
        .lineLimit(1...4)
        .onSubmit { model.send() }
        Button {
            model.send()
        } label: {
            Image(systemName: "paperplane.fill")
        }
        .disabled(model.input.trimmingCharacters(in: .whitespaces).isEmpty || model.isThinking)
        .accessibilityLabel("Send message")
    }
    .padding(.horizontal)
    .padding(.vertical, 10)
}
```

- [ ] **Step 2: Fix `turnRow`'s assistant case**

```swift
@ViewBuilder
private func turnRow(_ turn: KitchenAssistantViewModel.ChatTurn) -> some View {
    switch turn.role {
    case .cook:
        HStack {
            Spacer(minLength: 60)
            Text(turn.text)
                .padding(10)
                .background(LariatTheme.amber.opacity(0.18), in: RoundedRectangle(cornerRadius: 10))
        }
        .padding(.horizontal)
    case .assistant:
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(turn.text)
                        .textSelection(.enabled)
                        .padding(10)
                        .background(bubbleColor(turn), in: RoundedRectangle(cornerRadius: 10))
                    if turn.latencyMs > 0 {
                        Text("\(turn.model) · \(turn.latencyMs) ms")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                .accessibilityElement(children: .combine)
                if model.undoAvailable(turn) {
                    Button {
                        model.undo(turnId: turn.id)
                    } label: {
                        Label("Undo (\(model.undoSecondsLeft(turn))s)", systemImage: "arrow.uturn.backward")
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)
                }
                if let undoMessage = turn.undoMessage {
                    Label(undoMessage, systemImage: "arrow.uturn.backward.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if !turn.sources.isEmpty {
                    sourcesChips(turn.sources)
                }
            }
            Spacer(minLength: 60)
        }
        .padding(.horizontal)
    }
}
```

- [ ] **Step 3: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/KitchenAssistantView.swift
git commit -m "T10: KitchenAssistantView — label send button + combine assistant turn info"
```

---

### Task 11: Final verification

**Files:** None (verification only).

**Interfaces:** Depends on Tasks 1-10 all committed.

- [ ] **Step 1: Full build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 2: Scripted coverage audit (not prose)**

```bash
cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-cook/LariatNative
files=(
  TodayView EightySixView StationsListView StationChecklistView KdsPunchView
  PrepView PrepParView MorningView DatapackSearchView KitchenAssistantView
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
  echo "COVERAGE OK — all 10 files have at least one accessibility modifier"
else
  echo "COVERAGE VIOLATION — see MISSING lines above"
  exit 1
fi
```

Expected: `COVERAGE OK — all 10 files have at least one accessibility modifier`.

- [ ] **Step 3: Scope check (scripted, mirrors Phase 1's T14 precedent)**

```bash
git fetch origin
base=$(git merge-base origin/main HEAD)
expected=$(cat <<'EOF'
LariatNative/Sources/LariatApp/TodayView.swift
LariatNative/Sources/LariatApp/EightySixView.swift
LariatNative/Sources/LariatApp/StationsListView.swift
LariatNative/Sources/LariatApp/StationChecklistView.swift
LariatNative/Sources/LariatApp/KdsPunchView.swift
LariatNative/Sources/LariatApp/PrepView.swift
LariatNative/Sources/LariatApp/PrepParView.swift
LariatNative/Sources/LariatApp/MorningView.swift
LariatNative/Sources/LariatApp/DatapackSearchView.swift
LariatNative/Sources/LariatApp/KitchenAssistantView.swift
EOF
)
actual=$(git diff --name-only "$base" -- LariatNative)
if diff <(echo "$expected" | sort) <(echo "$actual" | sort) > /tmp/h7a-phase2-cook-scope-diff.txt; then
  echo "SCOPE OK — exactly the expected 10 files changed under LariatNative/"
else
  echo "SCOPE VIOLATION:"
  cat /tmp/h7a-phase2-cook-scope-diff.txt
  exit 1
fi
```

Expected: `SCOPE OK — exactly the expected 10 files changed under LariatNative/`.

- [ ] **Step 4: Mandatory final whole-branch review**

Dispatch an independent review comparing all 10 files' diffs side by side — not a
re-review of each task individually. This is the gate that caught Phase 1's one real
cross-file defect (`SdsView`'s interactive `Link` nested inside `.combine`, which every
other file avoided correctly). Specifically check: does any task above nest a `Button`,
`Link`, or `Menu` inside a `.accessibilityElement(children: .combine)` block? Do all 10
files use consistent wording/structure for equivalent situations (e.g. do all "combine +
verbalize tone" fixes follow the same label-construction style)?

- [ ] **Step 5: Manual VoiceOver spot-check (documented, non-gating)**

Needs a real desktop session — not verifiable headless (same limitation as Phase 1).
Turn on VoiceOver (Cmd+F5), open each of the 10 boards from the sidebar, and confirm
tiles/buttons announce sensibly (item + status/tone word, not just a bare number or
color). Specifically worth confirming: `DatapackSearchView`'s wikibooks "view" link still
opens on double-tap post-fix (same class of risk as the `SdsView` defect Phase 1 found).

- [ ] **Step 6: Open PR**

```bash
git push -u origin feat/lariat-native-h7a-phase2-cook
gh pr create --base main --head feat/lariat-native-h7a-phase2-cook \
  --title "feat(native): H7a Phase 2 — VoiceOver labels for .cook tier" \
  --body "See docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-cook-tier-design.md and docs/superpowers/plans/2026-07-05-lariat-native-h7a-phase2-cook-tier.md for full detail. 10 tasks (T1-T10), one commit per file, plus this T11 scripted verification + whole-branch review. CookIdentityPicker.swift intentionally out of scope (shared across 4 tiers, 19 call sites) — deferred to its own follow-up task."
```

**Commit message:** none (verification only).

---

## Self-Review

**1. Spec coverage:** Goal (VoiceOver labels + verbalize the 3 confirmed color-only
signals across the 10 `.cook` files) ✓ — every file has its own task. Non-goals
(`CookIdentityPicker`, other 9 tiers, `LariatModel` extraction, new dependency) — no task
violates any of these. Invariants — every touched interactive control now has a label
naming its target; every status-bearing row/tile relying on color alone now also
verbalizes state (TodayView 86-chips, StationChecklistView status buttons, MorningView
severity dots); no interactive control is nested inside `.combine` in any task (the
`DatapackSearchView` wikibooks fix and `KitchenAssistantView`'s Undo button both keep
controls as explicit siblings). Testing/acceptance — Task 11's scripted coverage +
scope-diff checks mirror Phase 1's Task 14 exactly; the manual VoiceOver spot-check is
documented as non-gating, per spec; Dynamic-Type — spec states none found in this tier,
no task claims one.

**2. Placeholder scan:** No "TBD"/"add appropriate handling"/"similar to Task N"
language anywhere — every task shows complete before/after code for its file. The one
explicit uncertainty (Task 8's `alert.severity` type name) is flagged as a
verify-before-build step, not silently assumed, matching Phase 1's own precedent for
handling audit uncertainty transparently.

**3. Type consistency:** `stationCard` (Task 1) and `stationRow` (Task 3) both call
`StationProgressLabels.tone(for:)` / `StationProgressLabels.label(for:)` /
`LariatTheme.color(for:)` — same helper names, same usage shape, confirmed consistent
across both tasks. Task 4's `.isSelected` idiom matches the pre-existing
`DatapackSearchView.swift:86` pattern referenced in Task 9's header, not a new
invention. No task declares a duplicate type or helper another task also declares —
each task's added private functions (`taskAccessibilityLabel`, `severityWord`, etc.) are
file-local and uniquely named within their own file.
