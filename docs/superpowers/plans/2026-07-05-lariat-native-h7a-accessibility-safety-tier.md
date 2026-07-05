# LariatNative H7a Phase 1 — VoiceOver labels: `.safety` tier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VoiceOver labels + fix the one real Dynamic-Type risk across the 13
`.safety`-tier board views that currently have zero accessibility coverage.

**Architecture:** Per-file, inline `.accessibilityElement(children: .combine)` +
`.accessibilityLabel(...)` additions matching `SanitizerView.swift`'s existing house
pattern — no extraction to `LariatModel`, no new types, no new dependency. Each task
touches exactly one file.

**Tech Stack:** SwiftUI (macOS), no new packages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-lariat-native-h7a-accessibility-safety-tier-design.md`.
- No new dependency (this codebase has exactly one — GRDB — today).
- No extraction of accessibility-label strings into `LariatModel` — inline in the View
  body, matching `SanitizerView.swift:73`.
- No XCTest is possible for this work — `LariatApp` has no test target. Acceptance per
  task is `swift build` clean. The final task runs a scripted coverage audit instead of
  a unit test.
- iPad cook tier and the other 13 tiers are out of scope — do not touch any file outside
  the 13 named below.
- Every task's changes are strictly additive (accessibility modifiers, one `width` →
  `minWidth` swap in Task 13) — no behavior change for a sighted user.

**Correction from the spec, found while reading each file for this plan:** the spec's
claim ("`HaccpPlanView.swift` is the only one with a hostile fixed-size pattern") was
based on a grep proxy (`\.frame(height: [0-9]+)`) that matched `SigLine`'s 1pt decorative
divider (`Rectangle().frame(height: 1)`, line 340) — a false positive; that divider has
no text to clip. There is **no** literal `.font(.system(size:))` fixed-pixel font in any
of the 13 files. The **actual** Dynamic-Type risk in `HaccpPlanView.swift` is different:
several `Text` columns use fixed `.frame(width: N, alignment: .leading)` in dense tables
(`CcpRow`, the calibration-records loop, the probes loop, the rule-modules loop) — a
fixed *width* on a text column clips content that needs more room at larger accessibility
text sizes, unlike a fixed *height* on a divider. Task 13 fixes the real issue
(`width` → `minWidth`) and ignores the false one (the divider is untouched).

---

### Task 1: `FoodSafetyHubView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/FoodSafetyHubView.swift:56-62`

**Interfaces:** Self-contained — no other task depends on this file.

Current `button(for:)` already renders a `Label(module.title, systemImage:)`, so
VoiceOver already announces the visible title text by default. The genuine gap: nothing
tells VoiceOver users this is a *navigation* action (as opposed to, say, a toggle).

- [ ] **Step 1: Add a navigation hint to the hub buttons**

```swift
private func button(for module: FeatureModule) -> some View {
    Button {
        context.navigate(module.id)
    } label: {
        Label(module.title, systemImage: Self.icons[module.id] ?? "square.grid.2x2")
    }
    .accessibilityHint("Opens the \(module.title) board")
}
```

- [ ] **Step 2: Build**

Run: `cd /Users/seanburdges/Dev/hospitality/Lariat/worktrees/native-h7a-accessibility/LariatNative && swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/FoodSafetyHubView.swift
git commit -m "T1: accessibility hint on FoodSafetyHubView navigation buttons"
```

---

### Task 2: `TempLogView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/TempLogView.swift:86-112`

**Interfaces:** Self-contained.

`tempTile(_:)` is a composite `VStack` (label / bound / reading, 3 separate `Text`s)
wrapped in a colored border (`tileColor(tile.status)`) — the tone (green/yellow/red/gray)
is conveyed by color ALONE, invisible to VoiceOver, and the 3 Texts would be read as
separate stops instead of one tile.

- [ ] **Step 1: Combine the tile and verbalize its status**

```swift
private func tempTile(_ tile: TempPointSummary) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(tile.label)
            .font(.subheadline.weight(.semibold))
            .lineLimit(2)
        Text(boundLabel(tile))
            .font(.caption)
            .foregroundStyle(.secondary)
        if let last = tile.lastReadingF {
            Text(String(format: "%.1f°F", last))
                .font(.title3.monospacedDigit())
        } else {
            Text("Not read")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
    .padding(10)
    .frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
    .background(tileColor(tile.status).opacity(0.18))
    .overlay(
        RoundedRectangle(cornerRadius: 10)
            .stroke(tileColor(tile.status), lineWidth: 2)
    )
    .clipShape(RoundedRectangle(cornerRadius: 10))
    .onTapGesture { pointId = tile.pointId }
    .accessibilityElement(children: .combine)
    .accessibilityLabel(
        "\(tile.label), \(statusWord(tile.status)), " +
        (tile.lastReadingF.map { String(format: "%.1f degrees", $0) } ?? "not read")
    )
    .accessibilityHint("Selects this point to log a new reading")
}

private func statusWord(_ status: TempTileStatus) -> String {
    switch status {
    case .green: return "in range"
    case .yellow: return "warning"
    case .red: return "out of range"
    case .gray: return "no data"
    }
}
```

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/TempLogView.swift
git commit -m "T2: combine + verbalize status for TempLogView tiles"
```

---

### Task 3: `CoolingView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/CoolingView.swift:84-126`

**Interfaces:** Self-contained.

`openBatchRow(_:)` conveys urgency (on-track/approaching/over) via `tone(scan).color`
alone on the countdown text — no word equivalent for VoiceOver.

- [ ] **Step 1: Combine the row and verbalize its tone**

```swift
@ViewBuilder
private func openBatchRow(_ row: CoolingRow) -> some View {
    let scan = vm.scanEntry(for: row)
    let stage = scan?.stage ?? (row.stage1At == nil ? 1 : 2)
    let stageCeiling = stage == 1 ? 70 : 41

    VStack(alignment: .leading, spacing: 6) {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.item).font(.headline)
                Text(metaLine(row)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(clockText(scan?.minutesRemaining))
                    .font(.title3.monospacedDigit())
                    .foregroundStyle(tone(scan).color)
                Text("Stage \(stage) · \(tone(scan) == .red ? "OVER" : "to ≤\(stageCeiling)°F")")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }

        if let s1 = row.stage1At, let s1r = row.stage1ReadingF {
            Text("Stage 1 closed \(timeText(s1)) @ \(fmtTemp(s1r))°F")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(row.item), stage \(stage), \(toneWord(tone(scan))), \(clockText(scan?.minutesRemaining))")

    HStack {
        TextField("Current temp °F (target ≤ \(stageCeiling))",
                  text: Binding(get: { reading[row.id] ?? "" }, set: { reading[row.id] = $0 }))
        TextField("Corrective action (if out of range)",
                  text: Binding(get: { note[row.id] ?? "" }, set: { note[row.id] = $0 }))
        Button(vm.isSaving ? "Saving…" : "Log stage \(stage)") {
            Task {
                await vm.logReading(id: row.id, readingText: reading[row.id] ?? "", note: note[row.id] ?? "")
                if vm.actionError == nil { reading[row.id] = ""; note[row.id] = "" }
            }
        }
        .disabled(vm.isSaving)
        .accessibilityLabel("Log stage \(stage) reading for \(row.item)")
    }
    .padding(.vertical, 2)
}

private func toneWord(_ t: Tone) -> String {
    switch t {
    case .green: return "on track"
    case .amber: return "approaching limit"
    case .red: return "over time limit"
    }
}
```

**Note:** the original function body wraps everything in one `VStack(...).padding(.vertical, 2)`
at the end (see the file's current lines 90-125). This step splits the informational
top half (combined + labeled) from the action row (TextFields + button) so the
`.accessibilityElement(children: .combine)` only merges the read-only info, not the
interactive controls — matching the pattern used in later tasks (e.g. Task 8). Preserve
the original `.padding(.vertical, 2)` on the outer container; adjust braces so the
function still returns a single `some View` (wrap both blocks in an outer `VStack` if
the compiler requires it — verify with the build step below rather than guessing).

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`. If the two-block split above doesn't compile as a single
`@ViewBuilder` return, wrap both in an outer `VStack(alignment: .leading, spacing: 6) { ... }`
and move `.padding(.vertical, 2)` to that outer wrapper.

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/CoolingView.swift
git commit -m "T3: combine + verbalize tone for CoolingView open-batch rows"
```

---

### Task 4: `DateMarkView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/DateMarkView.swift:67-81`

**Interfaces:** Self-contained.

The `statusBadge` already has visible text ("Expired"/"Due today") — reasonably
accessible already. The real gaps: the row's item+date info isn't combined, and the
"Discard" button doesn't say discard *what*.

- [ ] **Step 1: Combine the info block and label the Discard button**

```swift
ForEach(filteredActive) { row in
    HStack {
        VStack(alignment: .leading, spacing: 4) {
            Text(row.item).font(.headline)
            Text("Discard by \(row.discardOn)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(row.item), discard by \(row.discardOn)\(statusSuffix(vm.status(for: row)))")
        Spacer()
        statusBadge(vm.status(for: row))
        Button("Discard") { discardTarget = row }
            .font(.caption)
            .accessibilityLabel("Discard \(row.item)")
    }
}
```

Add this new private helper (place near `statusBadge`, e.g. directly above it):

```swift
private func statusSuffix(_ status: ExpiringBatchStatus?) -> String {
    switch status {
    case .expired: return ", expired"
    case .dueToday: return ", due today"
    case .ok, .none: return ""
    }
}
```

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/DateMarkView.swift
git commit -m "T4: combine info block + label Discard button in DateMarkView"
```

---

### Task 5: `CalibrationsView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/CalibrationsView.swift:71-84`

**Interfaces:** Self-contained.

The recent-calibrations row already has visible "Pass"/"Fail" text (color is
reinforcement, not the only signal) — the gap is purely that VoiceOver reads the
thermometer id, method/reading, and pass/fail as 3 separate stops.

- [ ] **Step 1: Combine the row**

```swift
ForEach(snap.rows) { row in
    HStack {
        VStack(alignment: .leading, spacing: 2) {
            Text(row.thermometerId).font(.headline)
            Text("\(CalibrationMethod(rawValue: row.method)?.label ?? row.method) · \(row.beforeReadingF.map { String(format: "%.1f°F", $0) } ?? "—")")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        Spacer()
        Text(row.passed == 1 ? "Pass" : "Fail")
            .font(.caption.weight(.semibold))
            .foregroundStyle(row.passed == 1 ? .green : .red)
    }
    .accessibilityElement(children: .combine)
}
```

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/CalibrationsView.swift
git commit -m "T5: combine recent-calibration rows into one VoiceOver element"
```

---

### Task 6: `CleaningView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/CleaningView.swift:44-51`

**Interfaces:** Self-contained.

No color-only signal here — purely a fragmented-read fix.

- [ ] **Step 1: Combine the today-row**

```swift
ForEach(snap.rows) { row in
    VStack(alignment: .leading, spacing: 4) {
        Text(row.task).font(.headline)
        Text("\(row.area) · \(row.completedAt)")
            .font(.caption)
            .foregroundStyle(.secondary)
    }
    .accessibilityElement(children: .combine)
}
```

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/CleaningView.swift
git commit -m "T6: combine CleaningView today-rows into one VoiceOver element"
```

---

### Task 7: `BreakBoardView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/BreakBoardView.swift:92-112`

**Interfaces:** Self-contained.

`breakRow(_:)`'s info half should combine; the "End" button doesn't say whose/what break
it ends.

- [ ] **Step 1: Combine the info block and label the End button**

```swift
@ViewBuilder
private func breakRow(_ row: ShiftBreakRow, scopedToCook: Bool) -> some View {
    HStack {
        VStack(alignment: .leading) {
            Text(row.breakKind?.label ?? row.kind).font(.headline)
            Text(scopedToCook ? row.startedAt : "\(vm.workerName(row.cookId)) · \(row.startedAt)")
                .font(.caption).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        Spacer()
        if row.endedAt != nil {
            Text("Done").font(.caption).foregroundStyle(.secondary)
        } else if row.cookId == vm.cookStore.cookId {
            Button("End") {
                Task { await vm.endBreak(id: row.id) }
            }
            .font(.caption)
            .accessibilityLabel("End \(row.breakKind?.label ?? row.kind)")
        } else {
            Text("On break").font(.caption).foregroundStyle(.secondary)
        }
    }
}
```

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/BreakBoardView.swift
git commit -m "T7: combine info block + label End button in BreakBoardView"
```

---

### Task 8: `TphcView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/TphcView.swift:103-131`

**Interfaces:** Self-contained.

The countdown text's color (green/amber/red) reinforces urgency that the text
(`minutesText`) already partially conveys ("Nm past cutoff" implies expired) — combining
+ an explicit tone word removes any ambiguity. The per-reason discard buttons currently
just say e.g. "Quality — off flavor/look" with no item context.

- [ ] **Step 1: Combine the info block, verbalize tone, and label discard buttons**

```swift
@ViewBuilder
private func openBatchRow(_ row: TphcRow) -> some View {
    let scan = vm.scanEntry(for: row)
    let t = tone(scan)

    VStack(alignment: .leading, spacing: 6) {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                Text(row.item).font(.headline)
                Spacer()
                Text(minutesText(scan?.minutesUntilCutoff))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(t.color)
            }
            Text(metaLine(row))
                .font(.caption).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(row.item), \(toneWord(t)), \(minutesText(scan?.minutesUntilCutoff))")

        HStack(spacing: 6) {
            ForEach(vm.discardReasons, id: \.self) { reason in
                Button(reasonLabel(reason)) {
                    Task { await vm.discard(id: row.id, reason: reason) }
                }
                .font(.caption)
                .buttonStyle(.bordered)
                .disabled(vm.isSaving)
                .accessibilityLabel("\(reasonLabel(reason)) — \(row.item)")
            }
        }
    }
    .padding(.vertical, 2)
}

private func toneWord(_ t: Tone) -> String {
    switch t {
    case .green: return "on track"
    case .amber: return "approaching cutoff"
    case .red: return "past cutoff"
    }
}
```

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/TphcView.swift
git commit -m "T8: combine + verbalize tone for TphcView open-batch rows"
```

---

### Task 9: `PestView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/PestView.swift:49-71`

**Interfaces:** Self-contained.

No color coding at all — purely a fragmented-read fix across the multi-line entry row.

- [ ] **Step 1: Combine the recent-entry row**

```swift
ForEach(snap.rows) { row in
    VStack(alignment: .leading, spacing: 4) {
        HStack {
            Text(row.entryType).font(.headline)
            Spacer()
            Text(dateLabel(row)).font(.caption).foregroundStyle(.secondary)
        }
        let vt = vendorTech(row)
        if !vt.isEmpty {
            Text(vt).font(.subheadline)
        }
        let ps = pestSeverity(row)
        if !ps.isEmpty {
            Text(ps).font(.caption).foregroundStyle(.secondary)
        }
        if let f = row.findings, !f.isEmpty {
            Text(f).font(.caption)
        }
        if let c = row.correctiveAction, !c.isEmpty {
            Text("Action: \(c)").font(.caption).foregroundStyle(.secondary)
        }
    }
    .accessibilityElement(children: .combine)
}
```

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/PestView.swift
git commit -m "T9: combine PestView recent-entry rows into one VoiceOver element"
```

---

### Task 10: `SdsView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/SdsView.swift:91-120`

**Interfaces:** Self-contained.

`registryRow(_:)` is a 3-line composite with no color coding — a fragmented-read fix.

- [ ] **Step 1: Combine the registry row**

```swift
@ViewBuilder
private func registryRow(_ row: SdsRow) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(row.productName).font(.headline)
        HStack(spacing: 6) {
            if let mfr = row.manufacturer { Text(mfr) }
            if let hz = row.hazardClass {
                Text(hz)
                    .font(.caption2)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.quaternary, in: Capsule())
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)

        let sheet = row.pdfPath ?? row.url
        HStack(spacing: 12) {
            if let storage = row.storageLocation {
                Label(storage, systemImage: "archivebox")
            }
            if let sheet {
                sheetReference(sheet)
            }
            Text("reviewed \(fmtDate(row.lastReviewed))")
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
    }
    .accessibilityElement(children: .combine)
}
```

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/SdsView.swift
git commit -m "T10: combine SdsView registry rows into one VoiceOver element"
```

---

### Task 11: `SickWorkerView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/SickWorkerView.swift:111-139`

**Interfaces:** Self-contained.

The action badge (excluded/restricted, color-coded) already has visible uppercase text —
reasonably accessible. The gaps: the info block isn't combined, and the "Clear to
return…" menu doesn't say whose clearance it is.

- [ ] **Step 1: Combine the info block and label the clearance menu**

```swift
@ViewBuilder
private func activeRow(_ row: SickWorkerRow) -> some View {
    VStack(alignment: .leading, spacing: 6) {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(vm.workerName(row.cookId)).font(.headline)
                Spacer()
                Text(row.action.uppercased())
                    .font(.caption2).padding(4)
                    .background(tone(row.action).opacity(0.2)).clipShape(Capsule())
                    .foregroundStyle(tone(row.action))
            }
            Text(metaLine(row)).font(.caption).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)

        if vm.pinOk {
            Menu {
                ForEach(SickWorkerViewModel.clearanceSources, id: \.id) { source in
                    Button(source.label) {
                        Task { await vm.clear(id: row.id, source: source.id) }
                    }
                }
            } label: {
                Label("Clear to return…", systemImage: "checkmark.seal")
                    .font(.caption)
            }
            .disabled(vm.isSaving)
            .accessibilityLabel("Clear \(vm.workerName(row.cookId)) to return")
        }
    }
    .padding(.vertical, 2)
}
```

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/SickWorkerView.swift
git commit -m "T11: combine info block + label clearance menu in SickWorkerView"
```

---

### Task 12: `ReceivingView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/ReceivingView.swift:88-107`

**Interfaces:** Self-contained.

`categoryTile(_:)` has the most significant color-only gap of the 13: the large
`\(s.total)` count's color (clean/note/reject) has no verbal equivalent at all — the row
does have `statusLine(s)` giving a breakdown, but the tile's own headline number's tone
is otherwise silent to VoiceOver.

- [ ] **Step 1: Combine the tile and add the tone word**

```swift
@ViewBuilder
private func categoryTile(_ s: ReceivingCategorySummary) -> some View {
    HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 2) {
            Text(s.label).font(.headline)
            Text(boundLabel(s)).font(.caption2).foregroundStyle(.secondary)
            Text(statusLine(s)).font(.caption).foregroundStyle(.secondary)
        }
        Spacer()
        VStack(alignment: .trailing, spacing: 2) {
            Text("\(s.total)").font(.title3.monospacedDigit()).foregroundStyle(tone(s.status).color)
            if let last = s.lastAt {
                Text("Last \(timeText(last))").font(.caption2).foregroundStyle(.secondary)
            } else {
                Text("None yet").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(s.label), \(toneWord(tone(s.status))), \(s.total) today, \(statusLine(s))")
}

private func toneWord(_ t: Tone) -> String {
    switch t {
    case .green: return "all clean"
    case .amber: return "some with notes"
    case .red: return "has rejects"
    }
}
```

**Note:** `ReceivingView` already declares a private `enum Tone` (see the file's existing
`tone(_:)` helper and its `Tone` cases `.green`/`.amber`/`.red` around line 227) — the
`toneWord` function above switches over that SAME existing `Tone` type; do not declare a
second `Tone` enum.

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/ReceivingView.swift
git commit -m "T12: combine + verbalize tone for ReceivingView category tiles"
```

---

### Task 13: `HaccpPlanView.swift` — labels + the real Dynamic-Type fix

**Files:**
- Modify: `LariatNative/Sources/LariatApp/HaccpPlanView.swift` (four spots: `programsSection`
  lines 142-163, `CcpRow` lines 320-334, the calibration-records loop lines 210-230, the
  probes loop lines 237-254)

**Interfaces:** Self-contained.

Per the Global Constraints correction above: this task does **two** things — (a) combine
each dense row into one VoiceOver announcement (currently 4-7 separate `Text` stops per
row), and (b) fix the genuine Dynamic-Type risk (`width` → `minWidth` on the fixed-width
`Text` columns, so they grow instead of clip at larger accessibility text sizes). The
`SigLine`/`CcpHeaderRow` short static header labels are left untouched — clipping risk
there is negligible and changing them adds churn with no real value.

- [ ] **Step 1: Fix `CcpRow`**

```swift
private struct CcpRow: View {
    let ccp: String, point: String, limit: String, citation: String, logs: String, corrective: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(ccp).font(.caption).monospacedDigit().frame(minWidth: 70, alignment: .leading)
            Text(point).font(.caption).frame(minWidth: 130, alignment: .leading)
            Text(limit).font(.caption).monospacedDigit().frame(minWidth: 110, alignment: .leading)
            Text(citation).font(.caption2).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
            Text(logs).font(.caption).monospacedDigit().frame(minWidth: 90, alignment: .leading)
            Text(corrective).font(.caption).monospacedDigit().frame(minWidth: 90, alignment: .leading)
        }
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(ccp), \(point), critical limit \(limit), \(citation), \(logs) logs, \(corrective) corrective actions")
    }
}
```

- [ ] **Step 2: Fix the `programsSection` rows**

```swift
private var programsSection: some View {
    SectionCard(title: "Food-safety programs") {
        VStack(spacing: 0) {
            ForEach(plan.ruleModules) { m in
                HStack(alignment: .top, spacing: 12) {
                    Text(m.name)
                        .font(.subheadline).fontWeight(.semibold)
                        .frame(minWidth: 180, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(m.citation)
                            .font(.caption).foregroundStyle(.secondary)
                        Text("\(m.records) \(m.evidenceLabel)")
                            .font(.caption).foregroundStyle(m.active ? .primary : .tertiary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 6)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(m.name), \(m.citation), \(m.records) \(m.evidenceLabel)")
                Divider()
            }
        }
    }
}
```

- [ ] **Step 3: Fix the calibration-records loop (inside `calibrationSection`)**

```swift
VStack(spacing: 0) {
    ForEach(plan.calibrations.records) { r in
        HStack(spacing: 12) {
            Text(fmtTs(r.calibratedAt)).font(.caption).monospacedDigit()
                .frame(minWidth: 130, alignment: .leading)
            Text(r.thermometerId).font(.caption).fontWeight(.semibold)
                .frame(minWidth: 90, alignment: .leading)
            Text(r.method).font(.caption2).foregroundStyle(.secondary)
                .frame(minWidth: 90, alignment: .leading)
            Text(r.beforeReadingF.map { "\(fmtF($0))°F" } ?? "—").font(.caption).monospacedDigit()
            Text(r.passed ? "Pass" : "Fail")
                .font(.caption2).bold()
                .foregroundStyle(r.passed ? Color.green : Color.red)
            Text(r.actionTaken ?? "—").font(.caption2).foregroundStyle(.secondary)
            Spacer()
            Text(r.cookId ?? "—").font(.caption2).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(r.thermometerId), calibrated \(fmtTs(r.calibratedAt)), \(r.method), \(r.passed ? "pass" : "fail")")
        Divider()
    }
}
```

- [ ] **Step 4: Fix the probes loop (inside `calibrationSection`)**

```swift
VStack(spacing: 0) {
    ForEach(plan.calibrations.probes) { p in
        HStack(spacing: 12) {
            Text(p.thermometerId).font(.caption).fontWeight(.semibold)
                .frame(minWidth: 110, alignment: .leading)
            Text(p.status.rawValue)
                .font(.caption2).bold()
                .foregroundStyle(probeColor(p.status))
                .frame(minWidth: 90, alignment: .leading)
            Text("Last: \(fmtTs(p.lastCalibratedAt))").font(.caption2).foregroundStyle(.secondary)
            Spacer()
            Text("Next due: \(fmtTs(p.nextDueAt))").font(.caption2).foregroundStyle(.secondary)
        }
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(p.thermometerId), \(p.status.rawValue), last calibrated \(fmtTs(p.lastCalibratedAt)), next due \(fmtTs(p.nextDueAt))")
        Divider()
    }
}
```

- [ ] **Step 5: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 6: Commit**

```bash
git add LariatNative/Sources/LariatApp/HaccpPlanView.swift
git commit -m "T13: HaccpPlanView — VoiceOver row labels + fix real Dynamic-Type risk (width -> minWidth)"
```

---

### Task 14: Final verification

**Files:** None (verification only).

**Interfaces:** Depends on Tasks 1-13 all committed.

- [ ] **Step 1: Full build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 2: Scripted coverage audit (not prose)**

```bash
cd /Users/seanburdges/Dev/hospitality/Lariat/worktrees/native-h7a-accessibility/LariatNative
files=(
  FoodSafetyHubView TempLogView CoolingView DateMarkView CalibrationsView
  CleaningView BreakBoardView TphcView PestView SdsView SickWorkerView
  ReceivingView HaccpPlanView
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
  echo "COVERAGE OK — all 13 files have at least one accessibility modifier"
else
  echo "COVERAGE VIOLATION — see MISSING lines above"
  exit 1
fi
```

Expected: `COVERAGE OK — all 13 files have at least one accessibility modifier`.

- [ ] **Step 3: Scope check (scripted, mirrors the H6a plan's T8 precedent)**

```bash
git fetch origin
base=$(git merge-base origin/main HEAD)
expected=$(cat <<'EOF'
LariatNative/Sources/LariatApp/FoodSafetyHubView.swift
LariatNative/Sources/LariatApp/TempLogView.swift
LariatNative/Sources/LariatApp/CoolingView.swift
LariatNative/Sources/LariatApp/DateMarkView.swift
LariatNative/Sources/LariatApp/CalibrationsView.swift
LariatNative/Sources/LariatApp/CleaningView.swift
LariatNative/Sources/LariatApp/BreakBoardView.swift
LariatNative/Sources/LariatApp/TphcView.swift
LariatNative/Sources/LariatApp/PestView.swift
LariatNative/Sources/LariatApp/SdsView.swift
LariatNative/Sources/LariatApp/SickWorkerView.swift
LariatNative/Sources/LariatApp/ReceivingView.swift
LariatNative/Sources/LariatApp/HaccpPlanView.swift
EOF
)
actual=$(git diff --name-only "$base" -- LariatNative)
if diff <(echo "$expected" | sort) <(echo "$actual" | sort) > /tmp/h7a-scope-diff.txt; then
  echo "SCOPE OK — exactly the expected 13 files changed under LariatNative/"
else
  echo "SCOPE VIOLATION:"
  cat /tmp/h7a-scope-diff.txt
  exit 1
fi
```

Expected: `SCOPE OK — exactly the expected 13 files changed under LariatNative/`.

- [ ] **Step 4: Manual VoiceOver spot-check (documented, non-gating)**

Needs a real desktop session — not verifiable headless (same limitation as the H6a
plan's foreground-banner/tap-to-navigate checks). Turn on VoiceOver (Cmd+F5), open each
of the 13 boards from the sidebar, and confirm tiles/buttons announce sensibly (item +
status/tone word, not just a bare number or color).

- [ ] **Step 5: Open PR**

```bash
git push -u origin feat/lariat-native-h7a-accessibility
gh pr create --base main --head feat/lariat-native-h7a-accessibility \
  --title "feat(native): H7a Phase 1 — VoiceOver labels for .safety tier" \
  --body "See docs/superpowers/specs/2026-07-05-lariat-native-h7a-accessibility-safety-tier-design.md and docs/superpowers/plans/2026-07-05-lariat-native-h7a-accessibility-safety-tier.md for full detail. 13 tasks (T1-T13), one commit per file, plus this T14 scripted verification. Corrects a spec false-positive: the real Dynamic-Type fix is in HaccpPlanView's fixed-width table columns (width -> minWidth), not the SigLine divider the original grep flagged."
```

**Commit message:** none (verification only).

---

## Self-Review

**1. Spec coverage:** Goal (VoiceOver labels + Dynamic Type fix across 13 `.safety`
files) ✓ — every file has its own task. Non-goals (iPad, other tiers, new dependency,
LariatModel extraction) — no task violates any of these; every fix is inline, matching
`SanitizerView`. Invariants — every touched interactive control now has a label
(Discard/End/Log/Clear buttons all labeled with context); every status-bearing tile now
verbalizes its tone word, not just relying on color; Dynamic Type — the one real risk
(fixed-width text columns in `HaccpPlanView`) is fixed via `minWidth`, and the spec's
false-positive claim is corrected in the Global Constraints section rather than silently
implemented as originally (mis)stated. Testing/acceptance — Task 14's scripted coverage
audit and scope check mirror the spec's requirement exactly; the manual VoiceOver
spot-check is documented as non-gating, per spec.

**2. Placeholder scan:** No "TBD"/"add appropriate handling"/"similar to Task N" language
anywhere — every task shows the complete before/after code for its file.

**3. Type consistency:** `toneWord` is defined per-file against that file's OWN existing
private `Tone` enum (CoolingView, TphcView, ReceivingView each already declare their own
`Tone` — confirmed by reading each file; Task 12's note explicitly flags this to prevent
an implementer from declaring a duplicate). `statusWord`/`statusSuffix` are each
file-local helpers, not shared across tasks — no cross-task naming collision.
`TempTileStatus`, `ExpiringBatchStatus` are pre-existing types read directly from each
file, not invented.
