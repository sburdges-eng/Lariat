# LariatNative H7a Phase 2 — Shows tier: VoiceOver labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VoiceOver labels, verbalize the 3 confirmed color-only signals, and fix the
3 confirmed Dynamic-Type risks across the 7 `.shows`-tier board views plus the
shared-within-tier `ShowsBoardSupport.swift`.

**Architecture:** Per-file, inline `.accessibilityElement(children: .combine)` +
`.accessibilityLabel(...)` additions matching `SanitizerView.swift`'s house pattern — no
extraction to `LariatModel`, no new types, no new dependency. Four zones need a
layout-neutral wrapper to isolate read-only info from a sibling interactive control;
everything else is a trailing modifier.

**Tech Stack:** SwiftUI (macOS), no new packages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-shows-tier-design.md`.
- No new dependency (this codebase has exactly one — GRDB — today).
- No extraction of accessibility-label strings into `LariatModel` — inline in the View
  body, matching `SanitizerView.swift:73`.
- **No `LariatModel`/compute changes of any kind, and NO changes to
  `ShowSettlementViewModel`** (money-critical settlement math). This plan touches only
  `View` structs.
- No XCTest is possible for this work — `LariatApp` has no test target. Acceptance per
  task is `swift build` clean. The final task runs a scripted coverage + scope audit.
- **`TileDegrade.swift`, `EmptyState.swift`, `CookIdentityPicker.swift`,
  `PinEntrySheet.swift` are out of scope** — shared cross-tier/app-wide components.
- The other 2 remaining `FeatureTier`s are out of scope — do not touch any file outside
  the 8 named below.
- **`ShowSoundView.swift`'s pre-existing `.accessibilityLabel("SPL sparkline")` must
  remain byte-for-byte unchanged.** It covers only the decorative sparkline `ZStack`.
- Every task's changes are strictly additive except the necessary restructurings named
  per-task below — no other zone in this tier needs restructuring.
- **Line ranges are locators from the pre-implementation audit, not guaranteed exact** —
  if a file has drifted, locate the named function/struct by name.
- The 3 Dynamic-Type fixes in this tier: `ShowsTonightView.runOfShowSection`
  (`width: 90`), `ShowsTonightView.pipelineSection` (`width: 100`), and
  `ShowsArchiveView`'s row date column (`width: 100`) — all `width:` → `minWidth:`. No
  other file needs a Dynamic-Type fix; two borderline fixed-width `TextField`s
  (`ShowSettlementView`, `ShowStageView`) are explicitly left untouched per established
  precedent (fixed-width input controls scroll, they don't clip like `Text`).
- **Strictly additive discipline:** a prior task in this sweep (Cook tier's T4) deleted
  2 pre-existing comments as an unintended side effect of "matching the brief exactly."
  Every task below must preserve every pre-existing comment/line not directly touched by
  its named fix.
- **Commit tooling note:** the MACP file-claim guardrail (`scripts/check-session-branch.mjs`)
  defaults to treating the committer as agent `"gemini"` unless `AGENT_NAME` is set.
  Every commit step below MUST be run with `AGENT_NAME=claude` set, e.g.
  `AGENT_NAME=claude git commit -m "..."`.
- **`ShowStageView.swift`'s findings (Task 6) came from a bonus audit pass**, not the
  same cross-checked-against-compute rigor as the other 7 files. Its implementer and
  reviewer should re-verify each finding against current source before implementing,
  same discipline as any task, with slightly less inherited confidence.

---

### Task 1: `ShowsArchiveView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/ShowsArchiveView.swift` (`content`'s row loop
  ~46-57)

**Interfaces:** Self-contained.

One fragmentation gap (date/bandName/era, up to 3 stops) plus this file's one confirmed
Dynamic-Type risk: the row date column's `width: 100` → `minWidth: 100`. No color signal
(muted styling on date/era is not semantic state).

- [ ] **Step 1: Fix `content`'s row loop**

```swift
@ViewBuilder
private var content: some View {
    if let err = vm.fetchError, vm.rows.isEmpty {
        TileDegrade(title: "Could not load the archive", message: err, systemImage: "archivebox")
    } else {
        List {
            Section {
                Picker("Era", selection: $vm.era) {
                    Text("All eras").tag(nil as Int?)
                    ForEach(vm.eras, id: \.self) { era in
                        Text(String(era)).tag(era as Int?)
                    }
                }
                .pickerStyle(.menu)
            }
            Section("Shows (\(vm.rows.count))") {
                if vm.rows.isEmpty {
                    EmptyState(message: "No archived shows match.", systemImage: "archivebox")
                } else {
                    ForEach(vm.rows) { row in
                        HStack {
                            Text(row.showDate).foregroundStyle(.secondary)
                                .frame(minWidth: 100, alignment: .leading)
                            Text(row.bandName)
                            Spacer()
                            if let era = row.eraYear {
                                Text(String(era)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .font(.callout)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
        .searchable(text: $vm.query, prompt: "Search bands")
        .onChange(of: vm.query) { Task { await vm.refresh() } }
        .onChange(of: vm.era) { Task { await vm.refresh() } }
    }
}
```

Only `width: 100` → `minWidth: 100` and the trailing `.accessibilityElement(children:
.combine)` are new.

- [ ] **Step 2: Build**

Run: `cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-shows/LariatNative && swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/ShowsArchiveView.swift
AGENT_NAME=claude git commit -m "T1: ShowsArchiveView — combine row + fix date-column Dynamic-Type"
```

---

### Task 2: `ShowsBoardSupport.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/ShowsBoardSupport.swift` (`ShowsLockedView`
  ~176-192)

**Interfaces:** Self-contained. This file is shared *within* the `.shows` tier only
(`ShowsGateModel`/`ShowsGatedBoard`/`ShowPickerModel`/`ShowPickerRow`, used by all 8
files audited, no cross-tier consumer) — fixing `ShowsLockedView` here benefits every
shows-tier board's PIN-locked state, matching the BEO-tier `BeoFireStationSection`
precedent.

Restructuring: icon+title+subtitle (currently flat siblings of the outer `VStack`) must
be wrapped in a new inner `VStack` so the "Unlock" Button stays a sibling, not a
descendant of the combined element. `ShowPickerRow` needs no changes (its `Picker` has a
visible title; its error `Text` is already self-describing, reinforcement-only tint).

- [ ] **Step 1: Fix `ShowsLockedView`**

```swift
private struct ShowsLockedView: View {
    let title: String
    let onUnlock: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            VStack(spacing: 12) {
                Image(systemName: "lock.fill").font(.largeTitle).foregroundStyle(.secondary)
                Text("\(title) requires a manager PIN")
                    .font(.headline)
                Text("Shows surfaces are PIN-protected (parity with the web app).")
                    .font(.callout).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)

            Button("Unlock") { onUnlock() }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
```

The icon+title+subtitle are now wrapped in a new inner `VStack(spacing: 12)` — the same
spacing value as the outer `VStack`, so the visual gap is unchanged. The "Unlock"
`Button` stays a sibling of the new inner `VStack`, outside its `.combine` scope.

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/ShowsBoardSupport.swift
AGENT_NAME=claude git commit -m "T2: ShowsBoardSupport — combine ShowsLockedView info, keep Unlock a sibling"
```

---

### Task 3: `ShowSoundView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/ShowSoundView.swift` (`kpi` ~183-190,
  `splSection` ~50-81, `scenesSection`'s row ~131-147)

**Interfaces:** Self-contained. **Preserve the pre-existing
`.accessibilityLabel("SPL sparkline")` at line ~107 (inside `sparkline`) exactly
unchanged — do not touch that function.**

Two zones:

1. **`kpi` — reading-order fix + the tier's SPL-threshold color-only signal.** The
   "latest" tile's color (green/amber/red/unset from `SplTelemetryCompute.
   splThresholdStatus`) is genuinely ambiguous for amber (near limit) and red (over
   limit) — green/unset already read unambiguously via the bare value. "over limit"
   tile's own count+label needs no extra word. `peak`/`avg`/`limit` tiles have no status
   coloring at all.
2. **`scenesSection`'s row — restructuring.** Info (scene name/meta/optional limit)
   must be wrapped so the destructive trash `Button` (currently unlabeled, identical
   across rows) stays a sibling.

- [ ] **Step 1: Fix `splSection` + `kpi`**

```swift
@ViewBuilder
private var splSection: some View {
    Section("SPL") {
        let summary = vm.splSummary
        let latestStatus = SplTelemetryCompute.splThresholdStatus(summary.latest, limit: summary.limitDb)
        HStack {
            kpi(summary.latest.map { db($0) } ?? "—", "latest",
                color: statusColor(latestStatus), status: latestStatus)
            kpi(summary.peak.map { db($0) } ?? "—", "peak")
            kpi(summary.avgLastN.map { db($0) } ?? "—", "avg")
            kpi("\(summary.overLimitCount)", "over limit",
                color: summary.overLimitCount > 0 ? LariatTheme.bad : LariatTheme.ok)
            kpi(summary.limitDb.map { db($0) } ?? "—", "limit")
        }
        sparkline
        HStack {
            TextField("dB (30–160)", text: $vm.splText)
                .frame(maxWidth: 140)
            Button("Log reading") { vm.appendReading() }
                .disabled(vm.splText.trimmingCharacters(in: .whitespaces).isEmpty
                          || picker.selectedShow == nil)
        }
        if vm.readings.isEmpty {
            EmptyState(message: "No SPL readings yet.", systemImage: "waveform")
        }
    }
}

@ViewBuilder
private func kpi(_ value: String, _ label: String, color: Color = .primary, status: SplStatus? = nil) -> some View {
    VStack(spacing: 2) {
        Text(value).font(.headline).monospacedDigit().foregroundStyle(color)
        Text(label).font(.caption2).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .combine)
    .accessibilityLabel(kpiAccessibilityLabel(value: value, label: label, status: status))
}

/// Verbalizes the tile's value+label in "label: value" order (default
/// combine reads "value, label" backwards), plus the one status this
/// board's "latest" tile conveys by color alone: amber (90–100% of the
/// configured limit) and red (over limit) are genuinely ambiguous without
/// sight — green/unset already read unambiguously via the value itself
/// ("—" for unset; a plain dB number for green), and "over limit"'s own
/// count+label needs no extra word.
private func kpiAccessibilityLabel(value: String, label: String, status: SplStatus?) -> String {
    var text = "\(label): \(value)"
    switch status {
    case .amber: text += ", near limit"
    case .red: text += ", over limit"
    case .green, .unset, .none: break
    }
    return text
}
```

Verify `SplStatus` has exactly the cases `.green`/`.amber`/`.red`/`.unset` before
implementing this switch — if it differs, adjust the case list to match the actual type
rather than guessing.

- [ ] **Step 2: Fix `scenesSection`'s row**

```swift
ForEach(vm.scenes) { scene in
    HStack {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(scene.sceneName).font(.callout)
                Text("\(scene.plot.channels.count) ch · \(scene.plot.monitors.count) mon · \(scene.savedAt)")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            if let limit = scene.splLimitDb {
                Text("limit \(db(limit))").font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)

        Button(role: .destructive) { vm.deleteScene(scene) } label: {
            Image(systemName: "trash")
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("Delete scene \(scene.sceneName)")
    }
}
```

The former flat `HStack` (info + trash Button) is restructured so the info half is
wrapped in an inner `HStack` with `.combine`; the trash `Button` stays a sibling of that
inner `HStack`, outside its combine scope. The inner `HStack`'s own `Spacer()` still
absorbs the same slack as before (layout-neutral).

- [ ] **Step 3: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/ShowSoundView.swift
AGENT_NAME=claude git commit -m "T3: ShowSoundView — verbalize SPL threshold + combine scene rows, label delete"
```

---

### Task 4: `ShowPlaybookView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/ShowPlaybookView.swift` (`header` ~92-104,
  `checklistSection`'s ticket-price row ~120-126, `statusPillRow` ~177-193)

**Interfaces:** Self-contained.

Three zones, one of which (`statusPillRow`) is a single shared helper covering 14
checklist-field call sites across 4 tabs:

1. **`header`** — 3-Text fragmentation, no color signal.
2. **Ticket-price row** — label+price fragmentation, no color signal.
3. **`statusPillRow` — confirmed color-only signal, the tier's `.neutral` case.**
   Verified against `ShowStatusCompute.swift:54`: `.neutral` always renders literal
   label `"—"`, a genuinely information-free em dash. Red/amber/green badges already
   show the raw spreadsheet token as text (verbatim by design) — do NOT reinterpret
   those, only `.neutral` gets an added word.

- [ ] **Step 1: Fix `header`**

```swift
@ViewBuilder
private func header(_ show: ShowRow) -> some View {
    Section {
        VStack(alignment: .leading, spacing: 4) {
            Text("SHOW MARKETING · PLAYBOOK")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .kerning(2)
            Text(show.bandName).font(.title2).bold()
            Text(show.showDate).font(.callout).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}
```

- [ ] **Step 2: Fix the ticket-price row (inside `checklistSection`'s `.tickets` case)**

```swift
@ViewBuilder
private func checklistSection(_ show: ShowRow) -> some View {
    let status = show.status
    switch vm.tab {
    case .ads:
        Section("Ad checklist") {
            ForEach(ShowPlaybookViewModel.adsFields, id: \.key) { field in
                pillRow(field.label, status[field.key], column: field.key)
            }
        }
    case .tickets:
        Section("Tickets") {
            HStack {
                Text("Advance ticket price")
                Spacer()
                Text(show.price.map { formatDollars($0, decimals: 2) } ?? "—")
                    .monospacedDigit()
            }
            .font(.callout)
            .accessibilityElement(children: .combine)
            statusPillRow(
                "Door price (door tix)",
                ShowStatusCompute.statusColor(show.doorTix, "door_tix"),
                column: "door_tix",
                rawValue: show.doorTix
            )
            pillRow("DICE tickets created", status["create_dice_tickets"], column: "create_dice_tickets")
            pillRow("Co-host sent", status["co_host_sent"], column: "co_host_sent")
        }
    case .news:
        Section("Newsletter") {
            pillRow("Newsletter included", status["newsletter"], column: "newsletter")
            pillRow("Announce date", status["announce_date"], column: "announce_date")
        }
    case .dayof:
        Section("Day of") {
            ForEach(ShowPlaybookViewModel.dayOfFields, id: \.key) { field in
                pillRow(field.label, status[field.key], column: field.key)
            }
        }
    }
}
```

Only the trailing `.accessibilityElement(children: .combine)` on the ticket-price
`HStack` is new; every other case/row is unchanged (they call the existing `pillRow`/
`statusPillRow` helpers, fixed once in Step 3).

- [ ] **Step 3: Fix `statusPillRow` — the confirmed color-only signal**

```swift
@ViewBuilder
private func statusPillRow(
    _ label: String, _ badge: ShowStatusBadge, column: String, rawValue: String?
) -> some View {
    HStack {
        Text(label)
        Spacer()
        Text(badge.label)
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(pillColor(badge.color).opacity(0.15), in: Capsule())
            .foregroundStyle(pillColor(badge.color))
            .help("\(column): \(rawValue ?? "—")")
    }
    .font(.callout)
    .accessibilityElement(children: .combine)
    .accessibilityLabel(statusPillAccessibilityLabel(label, badge))
}

/// Verbalizes the one genuinely information-free color signal in this
/// board: `ShowStatusCompute.statusColor` always renders the `.neutral`
/// case with the literal label "—" — an em dash with no accompanying
/// word, unlike red/amber/green cases whose label is always the raw
/// spreadsheet token itself (already spoken). Only `.neutral` needs an
/// added word; the other three tokens are shown verbatim by design and
/// must NOT be reinterpreted.
private func statusPillAccessibilityLabel(_ label: String, _ badge: ShowStatusBadge) -> String {
    if badge.color == .neutral {
        return "\(label): not set"
    }
    return "\(label): \(badge.label)"
}
```

Verify `ShowStatusBadge.color`'s type has a `.neutral` case (per the audit's read of
`ShowStatusCompute.swift`) before implementing — if the case name differs, use the
actual name.

`pillRow` (the plain, non-color-badge sibling helper used by most checklist fields) is
NOT modified in this task — confirm during implementation whether it needs its own
combine (if it exists as a separate, simpler helper without a colored badge) or is
simply an alias; if it's a distinct function, treat it as out of scope for this task
unless the same fragmentation gap applies, and flag to the reviewer if so.

- [ ] **Step 4: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatApp/ShowPlaybookView.swift
AGENT_NAME=claude git commit -m "T4: ShowPlaybookView — combine header/ticket row + verbalize neutral status"
```

---

### Task 5: `ShowBoxOfficeView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/ShowBoxOfficeView.swift` (`kpi` ~152-159,
  `content`'s completeness row ~53-61, `lineRow` ~86-115)

**Interfaces:** Self-contained.

Three zones:

1. **`kpi`** — reading-order fix (5 tiles: tickets/revenue/fees/scanned/unscanned).
2. **Completeness row** — fragmentation only; the percent tint is reinforcement (the
   percentage itself, derived from a 3-milestone score, already discloses complete vs.
   not) — no extra label text needed.
3. **`lineRow` — restructuring.** Info (source/class/ref, qty/price/fees) must be
   wrapped so the scan-state icon/Button stays a sibling. The scanned-state checkmark
   currently relies only on a `.help()` tooltip (not a guaranteed VoiceOver label); the
   unscanned "Scan" button is identical across every row.

- [ ] **Step 1: Fix `kpi`**

```swift
@ViewBuilder
private func kpi(_ value: String, _ label: String) -> some View {
    VStack(spacing: 2) {
        Text(value).font(.headline).monospacedDigit()
        Text(label).font(.caption2).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(label): \(value)")
}
```

- [ ] **Step 2: Fix the completeness row (inside `content`)**

```swift
let completeness = BoxOfficeCompleteness.from(summary: s)
HStack {
    Text("Completeness").foregroundStyle(.secondary)
    Spacer()
    Text("\(Int((completeness.score * 100).rounded()))%")
        .monospacedDigit()
        .foregroundStyle(completeness.score >= 1 ? LariatTheme.ok : LariatTheme.warn)
}
.font(.callout)
.accessibilityElement(children: .combine)
```

Only the trailing `.accessibilityElement(children: .combine)` is new; every other line
in this block is unchanged.

- [ ] **Step 3: Fix `lineRow`**

```swift
@ViewBuilder
private func lineRow(_ line: BoxOfficeLineRow) -> some View {
    HStack {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(SettlementPrintCompute.sourceLabel(line.source)).font(.callout)
                    if let cls = line.ticketClass {
                        Text(cls).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                if let ref = line.externalRef {
                    Text(ref).font(.caption2).foregroundStyle(.secondary)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(line.qty) × \(money(line.facePrice ?? 0))").monospacedDigit().font(.callout)
                if let fees = line.fees, fees != 0 {
                    Text("+ \(money(fees)) fees").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(lineRowAccessibilityLabel(line))

        if line.scannedAt != nil {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(LariatTheme.ok)
                .help("Scanned in")
                .accessibilityLabel("Scanned in")
        } else {
            Button("Scan") { vm.markScanned(line) }
                .buttonStyle(.bordered)
                .accessibilityLabel("Scan in \(SettlementPrintCompute.sourceLabel(line.source)) ticket line")
        }
    }
}

/// Verbalizes the line's source/class/ref + qty/price/fees fragments as one
/// VoiceOver stop; the scan-state icon/button stays a sibling outside this
/// combine scope so it remains independently reachable/interactive.
private func lineRowAccessibilityLabel(_ line: BoxOfficeLineRow) -> String {
    var parts = [SettlementPrintCompute.sourceLabel(line.source)]
    if let cls = line.ticketClass { parts.append(cls) }
    if let ref = line.externalRef { parts.append(ref) }
    parts.append("\(line.qty) at \(money(line.facePrice ?? 0)) each")
    if let fees = line.fees, fees != 0 {
        parts.append("plus \(money(fees)) fees")
    }
    return parts.joined(separator: ", ")
}
```

The former flat `HStack` (2 info VStacks + Spacer + scan-state control) is restructured
so the info half is wrapped in an inner `HStack` with `.combine` + an explicit label;
the scan-state `Image`/`Button` stays a sibling of that inner `HStack`. The inner
`HStack`'s own `Spacer()` absorbs the same slack as before (layout-neutral).

- [ ] **Step 4: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatApp/ShowBoxOfficeView.swift
AGENT_NAME=claude git commit -m "T5: ShowBoxOfficeView — combine kpi/completeness/line rows, label scan state"
```

---

### Task 6: `ShowStageView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/ShowStageView.swift` (`completenessSection`'s
  `flag(_:_:)` ~157-164, `roomSection`'s description ~84-89, `ridersSection`'s
  `TextEditor`s ~126/131, `runOfShowSection`'s row ~103-116)

**Interfaces:** Self-contained. **This file's findings came from a bonus audit pass —
re-verify each finding against the current source before implementing, same discipline
as any task, with slightly less inherited confidence than other files in this plan.**

Four zones:

1. **`flag(_:_:)` — confirmed icon+color-only signal.** Checkmark-or-circle shape/color
   is the ONLY on/off completeness indicator per tile; the label text never says
   complete/incomplete. The section's overall %-complete number is reinforcement only —
   do not touch that.
2. **`roomSection`'s description block** — already isolated (sibling of the `Picker`,
   no restructuring needed) — pure trailing `.combine`.
3. **`ridersSection`'s 2 `TextEditor`s — confirmed field-label gap.** Unlike `TextField`,
   `TextEditor(text:)` has no title parameter and generates no fallback accessible name.
4. **`runOfShowSection`'s row — restructuring.** 3 TextFields + an unlabeled, per-row
   identical trash Button.

- [ ] **Step 1: Verify and fix `flag(_:_:)`**

Read the current `flag(_:_:)` function first to confirm its exact signature and the
icon/color logic before applying. Expected shape (adjust names to match actual source if
they've drifted):

```swift
private func flag(_ label: String, _ complete: Bool) -> some View {
    HStack(spacing: 6) {
        Image(systemName: complete ? "checkmark.circle.fill" : "circle")
            .foregroundStyle(complete ? LariatTheme.ok : Color.secondary)
        Text(label).font(.caption)
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(label): \(complete ? "complete" : "incomplete")")
}
```

- [ ] **Step 2: Fix `roomSection`'s description block**

Read the current block first to confirm its exact structure; add a trailing
`.accessibilityElement(children: .combine)` to the 3-`Text` `VStack` only — do not touch
the sibling `Picker`.

- [ ] **Step 3: Fix `ridersSection`'s `TextEditor`s**

Read the current section first; add `.accessibilityLabel("Hospitality rider JSON")` to
the hospitality-rider `TextEditor` and `.accessibilityLabel("Tech rider JSON")` to the
tech-rider `TextEditor` — verify the exact field names/purpose against the surrounding
`Text`/`Section` titles before finalizing the label wording.

- [ ] **Step 4: Fix `runOfShowSection`'s row**

Read the current row first (3 `TextField`s + a trash `Button`) and restructure so the 3
`TextField`s remain individually-focusable siblings (do NOT wrap interactive
`TextField`s in `.combine` — each must stay its own VoiceOver stop for editing, matching
the established `BeoLineRowEditor` precedent from BEO tier) while the trash `Button`
gets `.accessibilityLabel("Remove run-of-show entry")` or a more specific label if the
row exposes an entry name/time to reference.

- [ ] **Step 5: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 6: Commit**

```bash
git add LariatNative/Sources/LariatApp/ShowStageView.swift
AGENT_NAME=claude git commit -m "T6: ShowStageView — verbalize completeness flags, label riders + run-of-show delete"
```

---

### Task 7: `ShowSettlementView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/ShowSettlementView.swift` (`moneyRow` ~256-266,
  `plainRow` ~268-276, `ticketsSection`'s inline row ~90-98, `netDoorSection` ~144-153,
  `dealEditor`'s cost row ~169-178)

**Interfaces:** Self-contained. **MONEY-CRITICAL — do not touch `ShowSettlementViewModel`
(starts ~line 279) or any compute/write logic. Only the `View` struct (~lines 17-277)
changes.**

Five zones, two of which are single-helper fixes covering ~14 call sites combined:

1. **`moneyRow`/`plainRow`** — shared fix point for `ticketsSection` (Gross/Fees/Net),
   `toastSection` (Net sales/Orders/Guests), `dealSection` (Guarantee/Buyout/cost-off-top
   rows/Total costs off top/vs % after costs), `talentSection` (Guarantee/vs bonus/
   Buyout/Total). Label already precedes value in both helpers — no explicit
   `.accessibilityLabel` override needed, just `.combine`. The `strong` bold-weight
   distinction is typographic only (the word "Total"/"Net" is already in the label
   text) — not a color signal.
2. **`ticketsSection`'s inline per-source row** — bespoke `HStack` not using `moneyRow`,
   same fragmentation, its own single fix site.
3. **`netDoorSection` — restructuring, the one non-purely-additive change in this
   file.** The big number + formula caption are bare `Section` children today (2
   separate List rows) — wrapping them in a `VStack` merges them into 1 row. No
   interactive control involved. The negative-red tint is reinforcement only (the
   dollar formatter already prepends an explicit "-" sign, which VoiceOver reads aloud)
   — no extra label text needed.
4. **Deal-editor cost row** — the `TextField("$", ...)` and destructive trash `Button`
   are both interactive and must NOT be combined; each needs its own per-row label
   instead.

- [ ] **Step 1: Fix `moneyRow` and `plainRow`**

```swift
@ViewBuilder
private func moneyRow(_ label: String, _ cents: Int, strong: Bool = false) -> some View {
    HStack {
        Text(label).foregroundStyle(strong ? .primary : .secondary)
        Spacer()
        Text(SettlementPrintCompute.dollars(cents))
            .monospacedDigit()
            .fontWeight(strong ? .bold : .regular)
    }
    .font(.callout)
    .accessibilityElement(children: .combine)
}

@ViewBuilder
private func plainRow(_ label: String, _ value: String) -> some View {
    HStack {
        Text(label).foregroundStyle(.secondary)
        Spacer()
        Text(value).monospacedDigit()
    }
    .font(.callout)
    .accessibilityElement(children: .combine)
}
```

Only the trailing `.accessibilityElement(children: .combine)` line in each helper is
new — every call site (all ~14 of them across `ticketsSection`/`toastSection`/
`dealSection`/`talentSection`) inherits the fix with zero call-site edits.

- [ ] **Step 2: Fix `ticketsSection`'s inline per-source row**

```swift
ForEach(Array(sources.enumerated()), id: \.offset) { _, src in
    HStack {
        Text(src.label).foregroundStyle(.secondary)
        Spacer()
        Text("\(src.qty) · \(SettlementPrintCompute.dollars(src.grossCents))")
            .monospacedDigit()
    }
    .font(.callout)
    .accessibilityElement(children: .combine)
}
```

Only the trailing `.accessibilityElement(children: .combine)` is new.

- [ ] **Step 3: Fix `netDoorSection`**

```swift
@ViewBuilder
private func netDoorSection(_ s: SettlementSummary) -> some View {
    Section("Net to door") {
        VStack(alignment: .leading, spacing: 4) {
            Text(SettlementPrintCompute.dollars(s.netDoorCents))
                .font(.system(size: 34, weight: .bold)).monospacedDigit()
                .foregroundStyle(s.netDoorCents < 0 ? LariatTheme.bad : .primary)
            Text("tickets net − costs off top − talent payout")
                .font(.caption).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}
```

The 2 bare `Text` siblings are now wrapped in a `VStack(alignment: .leading, spacing:
4)` with a trailing `.combine` — this merges what were 2 separate List rows into 1 row.
Flag this explicitly to the reviewer: it's the one place in this tier where a fix
changes row count, not just accessibility metadata (still no information lost, same
content, same visual appearance modulo row-separator removal between the two lines).

- [ ] **Step 4: Fix the deal-editor cost row**

```swift
@ViewBuilder
private var dealEditor: some View {
    NavigationStack {
        Form {
            TextField("Guarantee ($)", text: $vm.formGuarantee)
            TextField("vs % after costs (0–100, blank = flat)", text: $vm.formVsPct)
            TextField("Buyout ($)", text: $vm.formBuyout)
            Section("Costs off top") {
                // Identity-based ForEach + delete-by-id: index bindings
                // with remove(at:) fatal-error when SwiftUI re-resolves a
                // stale $vm.formCosts[i] past the new count (e.g. deleting
                // row 0 while a later row's field holds focus).
                ForEach($vm.formCosts) { $cost in
                    HStack {
                        TextField("Label", text: $cost.label)
                        TextField("$", text: $cost.amount)
                            .frame(width: 100)
                            .accessibilityLabel("Amount in dollars for \(cost.label.isEmpty ? "this cost" : cost.label)")
                        Button(role: .destructive) {
                            vm.formCosts.removeAll { $0.id == cost.id }
                        } label: { Image(systemName: "trash") }
                        .accessibilityLabel("Delete cost \(cost.label.isEmpty ? "(unnamed)" : cost.label)")
                    }
                }
                Button("Add cost") { vm.formCosts.append(.init()) }
            }
            if let err = vm.submitError {
                Text(err).font(.caption).foregroundStyle(LariatTheme.bad)
            }
        }
        .navigationTitle("Deal terms")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { vm.showDealEditor = false }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { vm.saveDeal() }
            }
        }
    }
    .frame(minWidth: 420, minHeight: 420)
}
```

Only the two trailing `.accessibilityLabel(...)` lines are new. The pre-existing
"Identity-based ForEach" comment must survive verbatim. The `$100`-width `TextField` is
NOT changed to `minWidth` — it's a fixed-width input control, not a `Text` column, per
the established precedent (left untouched, matching the spec's explicit non-fix note).

- [ ] **Step 5: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 6: Mandatory extra verification — no compute/ViewModel changes**

```bash
cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-shows
git diff --unified=0 HEAD~1 -- LariatNative/Sources/LariatApp/ShowSettlementView.swift | grep -n "^+" | grep -v "accessibilityElement\|accessibilityLabel\|^+++\|VStack(alignment: .leading, spacing: 4)\|^+$" || echo "no unexpected additions found"
```

Manually confirm the only non-accessibility-modifier line changes are the
`netDoorSection` `VStack` wrapper (Step 3) — no line inside `ShowSettlementViewModel`
should appear in this diff at all.

- [ ] **Step 7: Commit**

```bash
git add LariatNative/Sources/LariatApp/ShowSettlementView.swift
AGENT_NAME=claude git commit -m "T7: ShowSettlementView — combine money/plain/ticket rows, merge net-to-door display, label cost row"
```

---

### Task 8: `ShowsTonightView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/ShowsTonightView.swift` (`headline` ~51-80,
  `attendanceSection` ~83-110, `boxOfficeSection`/`kpi` ~113-134/236-243,
  `runOfShowSection` ~136-154, `stageSoundSection` ~156-179, `pipelineSection` ~203-232)

**Interfaces:** Self-contained. Largest and most complex file in the tier — 7 fix zones
across 6 `@ViewBuilder` functions + 1 shared `kpi` helper. Split into 2 sub-steps.

**Sub-step A** (`headline`, `attendanceSection`, `boxOfficeSection`/`kpi`):

1. **`headline`** — show-info block (bandName+date/price/doors) fragments into up to 4
   stops; "Last show" line fragments into 2 stops. No color signal.
2. **`attendanceSection`** — 3 sub-tiles fragment into up to 5 stops. Color tint on
   scanned/pct is reinforcement only — verified against `ShowsTonightCompute`: whenever
   capacity exists, the status word (`"near"`/`"at"`/`"over"`/`"under"`) is already
   displayed as plain text in the same section — no extra label text needed once
   combined.
3. **`boxOfficeSection`/`kpi`** — reading-order fix (4 tiles); `bySource` rows fragment
   into 2 stops.

**Sub-step B** (`runOfShowSection`, `stageSoundSection`, `pipelineSection`) — includes
both of this file's Dynamic-Type fixes:

4. **`runOfShowSection`** — time+label rows fragment into 2 stops; time column
   `width: 90` → `minWidth: 90`.
5. **`stageSoundSection`** — 2 label/value rows each fragment into 2 stops. No color.
6. **`pipelineSection`** — pipeline-stage tiles have the same reading-order bug as
   `kpi` (a separate `VStack` shape, not the same helper); date column
   `width: 100` → `minWidth: 100`; upcoming rows fragment into up to 3 stops (the stage
   capsule is decorative/constant, not semantic — the stage name is already spoken).

`capacitySection` needs NO fix — already a single `Text` plus flat, uniquely-worded
`TextField`/`Button("Set")`/`Button("Clear")` siblings; do not touch it.

- [ ] **Step 1 (Sub-step A): Fix `headline`, `attendanceSection`, `boxOfficeSection` + `kpi`**

```swift
@ViewBuilder
private func headline(_ snap: ShowsRepository.TonightSnapshot) -> some View {
    Section {
        if let show = snap.show {
            VStack(alignment: .leading, spacing: 4) {
                Text(show.bandName).font(.title2).bold()
                HStack(spacing: 12) {
                    Text(show.showDate)
                    if let price = show.price {
                        Text(String(format: "$%.2f", price))
                    }
                    if let doors = vm.doorsLabel() {
                        Text("Doors \(doors)")
                    }
                }
                .font(.callout).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
        } else {
            EmptyState(message: "No show tonight (\(snap.date)).", systemImage: "moon.zzz")
        }
        if let prev = snap.previousShow {
            HStack {
                Text("Last show").foregroundStyle(.secondary)
                Spacer()
                Text("\(prev.bandName) · \(prev.showDate)")
            }
            .font(.caption)
            .accessibilityElement(children: .combine)
        }
    }
}

@ViewBuilder
private func attendanceSection(_ snap: ShowsRepository.TonightSnapshot) -> some View {
    if let a = snap.attendance {
        Section("Attendance") {
            HStack(spacing: 16) {
                VStack(alignment: .leading) {
                    Text("\(a.scannedQty)").font(.title).monospacedDigit()
                        .foregroundStyle(attendanceColor(a.status))
                    Text("scanned in").font(.caption2).foregroundStyle(.secondary)
                }
                VStack(alignment: .leading) {
                    Text("\(a.soldQty)").font(.title).monospacedDigit()
                    Text("sold").font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                if let cap = a.capacity, let pct = a.scannedPct {
                    VStack(alignment: .trailing) {
                        Text("\(fmtPct(pct))% of \(cap)")
                            .font(.headline).monospacedDigit()
                            .foregroundStyle(attendanceColor(a.status))
                        Text(a.status.rawValue).font(.caption2).foregroundStyle(.secondary)
                    }
                } else {
                    Text("capacity unset").font(.caption).foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }
}

@ViewBuilder
private func boxOfficeSection(_ snap: ShowsRepository.TonightSnapshot) -> some View {
    if let s = snap.boxOfficeSummary {
        Section("Box office") {
            HStack {
                kpi("\(s.totalQty)", "tickets")
                kpi(money(s.totalFaceValue), "face value")
                kpi(money(s.totalFees), "fees")
                kpi(money(s.totalRevenue), "revenue")
            }
            ForEach(BoxOfficeSource.allCases, id: \.rawValue) { src in
                if let bucket = s.bySource[src], bucket.qty > 0 {
                    HStack {
                        Text(SettlementPrintCompute.sourceLabel(src.rawValue))
                        Spacer()
                        Text("\(bucket.qty) · \(money(bucket.revenue))").monospacedDigit()
                    }
                    .font(.callout)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

@ViewBuilder
private func kpi(_ value: String, _ label: String) -> some View {
    VStack(spacing: 2) {
        Text(value).font(.headline).monospacedDigit()
        Text(label).font(.caption2).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(label): \(value)")
}
```

- [ ] **Step 2 (Sub-step A): Build**

Run: `cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-shows/LariatNative && swift build`
Expected: `Build complete!`

- [ ] **Step 3 (Sub-step A): Commit**

```bash
git add LariatNative/Sources/LariatApp/ShowsTonightView.swift
AGENT_NAME=claude git commit -m "T8a: ShowsTonightView — combine headline/attendance/box-office rows, fix kpi reading order"
```

- [ ] **Step 4 (Sub-step B): Fix `runOfShowSection`, `stageSoundSection`, `pipelineSection`**

```swift
@ViewBuilder
private func runOfShowSection(_ snap: ShowsRepository.TonightSnapshot) -> some View {
    if snap.show != nil {
        Section("Run of show") {
            if snap.runOfShow.isEmpty {
                EmptyState(message: "No run-of-show entries yet.", systemImage: "list.bullet")
            } else {
                ForEach(Array(snap.runOfShow.enumerated()), id: \.offset) { _, entry in
                    HStack {
                        Text(entry.time ?? "—").foregroundStyle(.secondary)
                            .frame(minWidth: 90, alignment: .leading)
                        Text(entry.label)
                    }
                    .font(.callout)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

@ViewBuilder
private func stageSoundSection(_ snap: ShowsRepository.TonightSnapshot) -> some View {
    if snap.show != nil {
        Section("Stage · Sound") {
            HStack {
                Text("Room config").foregroundStyle(.secondary)
                Spacer()
                Text(snap.stageSetup.flatMap { StageRoomCatalog.config(for: $0.roomConfig)?.name }
                     ?? snap.stageSetup?.roomConfig ?? "—")
            }
            .accessibilityElement(children: .combine)
            HStack {
                Text("Latest scene").foregroundStyle(.secondary)
                Spacer()
                if let scene = snap.latestSoundScene {
                    Text(scene.splLimitDb.map { "\(scene.sceneName) · limit \(fmtPct($0)) dB" }
                         ?? scene.sceneName)
                } else {
                    Text("—")
                }
            }
            .accessibilityElement(children: .combine)
        }
        .font(.callout)
    }
}

@ViewBuilder
private var pipelineSection: some View {
    Section("Upcoming · 5 weeks") {
        HStack(spacing: 10) {
            ForEach(PipelineStage.allCases, id: \.rawValue) { stage in
                VStack(spacing: 2) {
                    Text("\(vm.pipelineCounts[stage] ?? 0)").font(.headline).monospacedDigit()
                    Text(stage.rawValue).font(.caption2).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(stage.rawValue): \(vm.pipelineCounts[stage] ?? 0)")
            }
        }
        if vm.upcoming.isEmpty {
            EmptyState(message: "No upcoming shows in the window.", systemImage: "calendar")
        } else {
            ForEach(vm.upcoming) { show in
                HStack {
                    Text(show.showDate).foregroundStyle(.secondary)
                        .frame(minWidth: 100, alignment: .leading)
                    Text(show.bandName)
                    Spacer()
                    Text(vm.stage(for: show).rawValue)
                        .font(.caption).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Capsule().fill(Color.secondary.opacity(0.15)))
                }
                .font(.callout)
                .accessibilityElement(children: .combine)
            }
        }
    }
}
```

`capacitySection` is NOT reproduced here — it is unchanged, do not touch it.

- [ ] **Step 5 (Sub-step B): Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 6 (Sub-step B): Commit**

```bash
git add LariatNative/Sources/LariatApp/ShowsTonightView.swift
AGENT_NAME=claude git commit -m "T8b: ShowsTonightView — combine run-of-show/stage-sound/pipeline rows, fix 2 Dynamic-Type columns"
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
cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-shows/LariatNative
files=(
  ShowsArchiveView ShowsBoardSupport ShowSoundView ShowPlaybookView
  ShowBoxOfficeView ShowStageView ShowSettlementView ShowsTonightView
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
LariatNative/Sources/LariatApp/ShowsArchiveView.swift
LariatNative/Sources/LariatApp/ShowsBoardSupport.swift
LariatNative/Sources/LariatApp/ShowSoundView.swift
LariatNative/Sources/LariatApp/ShowPlaybookView.swift
LariatNative/Sources/LariatApp/ShowBoxOfficeView.swift
LariatNative/Sources/LariatApp/ShowStageView.swift
LariatNative/Sources/LariatApp/ShowSettlementView.swift
LariatNative/Sources/LariatApp/ShowsTonightView.swift
EOF
)
actual=$(git diff --name-only "$base" -- LariatNative)
if diff <(echo "$expected" | sort) <(echo "$actual" | sort) > /tmp/h7a-phase2-shows-scope-diff.txt; then
  echo "SCOPE OK — exactly the expected 8 files changed under LariatNative/"
else
  echo "SCOPE VIOLATION:"
  cat /tmp/h7a-phase2-shows-scope-diff.txt
  exit 1
fi

# Extra check: ShowSettlementViewModel (money-critical compute) must show zero diff.
if git diff --quiet "$base" -- LariatNative/Sources/LariatApp/ShowSettlementViewModel.swift 2>/dev/null; then
  echo "CONFIRMED — ShowSettlementViewModel.swift has zero diff (or doesn't exist as a separate file), as required"
else
  echo "UNEXPECTED — ShowSettlementViewModel.swift changed; investigate before treating scope as OK"
  exit 1
fi
```

Expected: `SCOPE OK — exactly the expected 8 files changed under LariatNative/` followed
by the `ShowSettlementViewModel` confirmation.

- [ ] **Step 4: Mandatory final whole-branch review**

Compare all 8 files' diffs side by side. Specifically check: do any of the 4 restructured
zones (`ShowsBoardSupport.ShowsLockedView`, `ShowBoxOfficeView.lineRow`,
`ShowSoundView.scenesSection`, `ShowStageView.runOfShowSection`) nest their interactive
control inside a `.combine` block? Does `ShowSettlementView`'s diff touch anything beyond
the `View` struct? Do the `.neutral`-only (`ShowPlaybookView`) and amber/red-only
(`ShowSoundView`) wording additions leak to other cases? Re-verify `ShowStageView`'s
fixes against current source given its lighter initial audit pass. Confirm
`ShowSoundView`'s pre-existing `"SPL sparkline"` label is untouched.

- [ ] **Step 5: Manual VoiceOver spot-check (documented, non-gating)**

Needs a real desktop session. Turn on VoiceOver (Cmd+F5), open all 7 boards, and
confirm: a PIN-locked shows board announces the lock message and "Unlock" separately; a
`.neutral` playbook checklist item announces "not set"; SoundView's SPL "latest" tile
announces "near limit"/"over limit" when applicable; box-office scan-state controls
announce sensibly; settlement's net-to-door reads as one combined stop; stage's
completeness flags announce complete/incomplete.

- [ ] **Step 6: Open PR**

```bash
git push -u origin feat/lariat-native-h7a-phase2-shows
gh pr create --base main --head feat/lariat-native-h7a-phase2-shows \
  --title "feat(native): H7a Phase 2 — VoiceOver labels for .shows tier" \
  --body "See docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-shows-tier-design.md and docs/superpowers/plans/2026-07-05-lariat-native-h7a-phase2-shows-tier.md for full detail. 9 tasks (T1-T8, with T8 split into 2 sub-commits), plus this T9 scripted verification + whole-branch review. ShowSettlementView touches only the View struct -- ShowSettlementViewModel (money-critical compute) verified unchanged."
```

**Commit message:** none (verification only).

---

## Self-Review

**1. Spec coverage:** Goal (labels + verbalize the 3 confirmed color-only signals + fix
the 3 confirmed Dynamic-Type risks across 7 boards + 1 shared support file) ✓ — every
file has its own task. Non-goals (shared cross-tier components, other 2 tiers,
`LariatModel`/`ShowSettlementViewModel` changes, new dependency) — no task violates any
of these. Invariants — every touched interactive control now has an unambiguous label;
all 3 color-only signals are verbalized exactly where ambiguous, left alone where
reinforcement-only; no interactive control is nested inside `.combine` in any of the 4
restructured zones; `ShowSoundView`'s pre-existing label is explicitly preserved.
Testing/acceptance — Task 9's scripted coverage + scope-diff checks (including the extra
`ShowSettlementViewModel` zero-diff check) mirror and extend established precedent;
manual VoiceOver spot-check documented as non-gating.

**2. Placeholder scan:** No "TBD"/"add appropriate handling"/"similar to Task N"
language anywhere — every task shows complete before/after code for its zone, except
Task 6 (`ShowStageView`), which explicitly instructs the implementer to re-read and
verify current source given its lighter audit confidence — this is a deliberate,
disclosed exception matching the file's own noted lower-confidence status, not an
omission.

**3. Type consistency:** `SplStatus` (Task 3), `ShowStatusBadge`/`.neutral` (Task 4) are
both read directly from their respective compute files during the audit, not invented —
Task 3 and Task 4 each include an explicit instruction to verify the exact case names
before implementing, since neither audit fully traced the type declaration the way the
Labor tier's `BarTone`/`color(for:)` case-parity check did. `moneyRow`/`plainRow` (Task
7) keep their existing signatures unchanged. No task declares a duplicate type or helper
another task also declares; `kpi` is redeclared independently and correctly in 3
separate files (`ShowsTonightView`, `ShowBoxOfficeView`, `ShowSoundView`) as 3 distinct
private functions, not a shared symbol — confirmed no naming collision since each is
file-private.
