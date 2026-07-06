# LariatNative H7a Phase 2 — FOH tier: VoiceOver labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VoiceOver labels, verbalize the 1 confirmed selection-state signal, and fix
the 1 confirmed Dynamic-Type risk across the 4 `.foh`-tier board views.

**Architecture:** Per-file, inline `.accessibilityElement(children: .combine)` +
`.accessibilityLabel(...)` / `.accessibilityAddTraits(...)` additions matching
`SanitizerView.swift`'s house pattern — no extraction to `LariatModel`, no new types, no
new dependency. Two zones need a layout-neutral wrapper container to isolate read-only
info from sibling interactive controls; everything else is a trailing modifier.

**Tech Stack:** SwiftUI (macOS), no new packages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-foh-tier-design.md`.
- No new dependency (this codebase has exactly one — GRDB — today).
- No extraction of accessibility-label strings into `LariatModel` — inline in the View
  body, matching `SanitizerView.swift:73`.
- No XCTest is possible for this work — `LariatApp` has no test target. Acceptance per
  task is `swift build` clean. The final task runs a scripted coverage + scope audit.
- **`CookIdentityPicker.swift`, `PinEntrySheet.swift`, `TileDegrade.swift`,
  `EmptyState.swift` are all out of scope** — shared cross-tier/app-wide components, not
  tier-specific. Do not touch them in this plan.
- The other 4 remaining `FeatureTier`s are out of scope — do not touch any file outside
  the 4 named below.
- **Three pre-existing accessibility labels must remain byte-for-byte unchanged**:
  `FloorView.tableTile`'s `.accessibilityLabel("Table \(table.id), \(statusLabel(table.status)), \(table.capacity) seats")`,
  `ReservationsBoardView.reservationRow`'s `.accessibilityLabel("Delete reservation for \(r.partyName)")`,
  and `BookingBoardView.header`'s `.accessibilityLabel("Next show: \(next.bandName). Open tonight's board.")`.
  New fixes add alongside these, never replace or duplicate them.
- Every task's changes are strictly additive except two necessary, layout-neutral
  wrapper restructurings: `FloorView.actionPanel`'s name/status line (wrapped in a new
  inner `VStack` matching the outer's own spacing) and `HostStandView.waitingRow`'s info
  block (wrapped in a new inner `HStack` matching the outer's own spacing) — both
  preserve the exact existing visual gaps.
- **Line ranges are locators from the pre-implementation audit, not guaranteed exact** —
  if a file has drifted, locate the named function/struct by name.
- The ONE Dynamic-Type fix in this tier: `BookingBoardView.showTable`'s 6 fixed-`width`
  `Text` columns (Date/Price/Door × header + data row) → `minWidth`. No other file in
  this tier needs a Dynamic-Type fix.
- **Strictly additive discipline:** a prior task in this sweep (Cook tier's T4) deleted
  2 pre-existing comments as an unintended side effect of "matching the brief exactly."
  Every task below must preserve every pre-existing comment/line not directly touched by
  its named fix.

---

### Task 1: `FloorView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/FloorView.swift` (`tableTile` ~132-151,
  `actionPanel` ~153-197)

**Interfaces:** Self-contained — no other task depends on this file.

Two zones:

1. **`tableTile` — confirmed selection-state gap.** The tile's selected-state stroke
   overlay is a border-only signal with no spoken equivalent. Fix: reuse the established
   `.accessibilityAddTraits(condition ? [.isSelected] : [])` idiom
   (`DatapackSearchView.swift:86`). The pre-existing `.accessibilityLabel("Table
   \(table.id), \(statusLabel(table.status)), \(table.capacity) seats")` on this same
   Button must remain untouched — the new trait is added alongside it.
2. **`actionPanel` — fragmentation gap, needs a wrapper.** The table name/capacity line
   and the status-badge line are two sibling `Text`s sitting flat among button-bearing
   siblings in one outer `VStack` — wrap both in a new inner `VStack(alignment: .leading,
   spacing: 12)` (matching the outer's own spacing value, so the visual gap is
   unchanged) with a trailing `.combine`.

`seatReservationSection`'s buttons are NOT touched — each Button's own label already
embeds the party name via its compound Text content.

- [ ] **Step 1: Fix `tableTile`'s selection trait**

```swift
    private func tableTile(_ table: DiningTableRow) -> some View {
        Button {
            vm.selectedId = table.id == vm.selectedId ? nil : table.id
        } label: {
            VStack(spacing: 4) {
                Text(table.id).font(.headline.bold())
                Text("ppl \(table.capacity)").font(.caption)
                Text(statusLabel(table.status)).font(.caption2)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 84)
            .background(statusColor(table.status), in: RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(table.id == vm.selectedId ? Color.primary : .clear, lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Table \(table.id), \(statusLabel(table.status)), \(table.capacity) seats")
        .accessibilityAddTraits(table.id == vm.selectedId ? [.isSelected] : [])
    }
```

Only the trailing `.accessibilityAddTraits(...)` line is new. The pre-existing
`.accessibilityLabel(...)` line directly above it is unchanged.

- [ ] **Step 2: Fix `actionPanel`'s fragmentation**

```swift
    private func actionPanel(_ table: DiningTableRow) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(table.id).font(.title3.bold())
                Spacer()
                Button("Close panel") { vm.selectedId = nil }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 12) {
                Text(table.name == table.id ? "ppl \(table.capacity)" : "\(table.name) · ppl \(table.capacity)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(statusLabel(table.status))
                    .font(.caption.bold())
                    .padding(.horizontal, 10)
                    .padding(.vertical, 3)
                    .background(statusColor(table.status), in: Capsule())
                    .foregroundStyle(.white)
            }
            .accessibilityElement(children: .combine)

            // Status verbs gated by the current status — the canonical
            // state machine (FloorCompute.actions).
            VStack(spacing: 6) {
                ForEach(FloorCompute.actions(for: table.status), id: \.target) { action in
                    Button(action.label) {
                        Task { await vm.changeStatus(id: table.id, to: action.target) }
                    }
                    .buttonStyle(.bordered)
                    .tint(action.isPrimary ? .accentColor : nil)
                    .disabled(vm.isBusy)
                    .frame(maxWidth: .infinity, minHeight: 36)
                }
            }

            if table.status == "open" && !vm.reservations.isEmpty {
                seatReservationSection(table)
            }

            if let notes = table.notes, !notes.isEmpty {
                Divider()
                Text(notes).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
    }
```

The two former flat sibling `Text`s (name/capacity line, status-badge line) are now
wrapped in a new inner `VStack(alignment: .leading, spacing: 12)` — the same spacing
value as the outer `VStack`, so the visual gap before/after this block and around
`seatReservationSection`/notes is unchanged. The pre-existing "Status verbs..." comment
must survive verbatim.

- [ ] **Step 3: Build**

Run: `cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-foh/LariatNative && swift build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/FloorView.swift
git commit -m "T1: FloorView — verbalize tile selection state + combine actionPanel summary"
```

---

### Task 2: `HostStandView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/HostStandView.swift` (`waitingRow` ~138-169,
  `seatedSection` ~171-190)

**Interfaces:** Self-contained.

Zero pre-existing accessibility modifiers in this file. Two zones:

1. **`waitingRow` — fragmentation (up to 5 stops) + unlabeled Seat/Left buttons.** The
   two info `VStack`s + optional notes `Text` sit flat among the two Buttons in one
   outer `HStack` — wrap the info content in a new inner `HStack(alignment: .top,
   spacing: 12)` (matching the outer's own alignment/spacing) with a trailing
   `.combine`, and label "Seat"/"Left" with the party name.
2. **`seatedSection` — fragmentation only, no restructuring needed.** Each row is
   already an isolated `HStack` with no interactive control — pure trailing `.combine`.

- [ ] **Step 1: Fix `waitingRow`**

```swift
    private func waitingRow(_ p: WaitlistPartyRow) -> some View {
        HStack(alignment: .top, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.partyName).font(.headline)
                    if let phone = p.phone, !phone.isEmpty {
                        Text(phone).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(p.partySize) ppl · joined \(fmtClock(p.joinedAt))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("waiting \(waitingMinutes(p)) min")
                        .font(.caption.monospaced())
                }
                if let notes = p.notes, !notes.isEmpty {
                    Text(notes)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: 200, alignment: .leading)
                }
            }
            .accessibilityElement(children: .combine)
            Button("Seat") { vm.requestTransition(id: p.id, to: "seated") }
                .buttonStyle(.borderedProminent)
                .disabled(vm.isBusy)
                .accessibilityLabel("Seat \(p.partyName)")
            Button("Left") { vm.requestTransition(id: p.id, to: "left") }
                .buttonStyle(.bordered)
                .disabled(vm.isBusy)
                .accessibilityLabel("\(p.partyName) left the waitlist")
        }
        .padding(10)
        .background(.background.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
    }
```

The original flat `HStack(alignment: .top, spacing: 12)` had 6 direct children (both
info `VStack`s, `Spacer`, optional notes `Text`, both Buttons) all spaced uniformly at
12pt. Wrapping the first 4 in an inner `HStack` with the identical `alignment: .top,
spacing: 12` is layout-neutral: the 12pt gap is preserved both inside the inner stack
and between the inner-stack-as-one-block and each Button in the outer stack.

- [ ] **Step 2: Fix `seatedSection`**

```swift
    private var seatedSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Seated today (\(vm.seatedToday.count))")
                .font(.headline)
                .foregroundStyle(.secondary)
            ForEach(filterParties(vm.seatedToday)) { p in
                HStack {
                    Text(p.partyName)
                    Spacer()
                    Text("\(p.partySize) ppl · seated \(fmtClock(p.seatedAt)) · wait \(seatedWait(p))")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                .padding(8)
                .background(.background.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding()
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
    }
```

Only the trailing `.accessibilityElement(children: .combine)` is new — pure
trailing-modifier addition, no restructuring (buttons never share this container).

- [ ] **Step 3: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/HostStandView.swift
git commit -m "T2: HostStandView — combine waiting/seated rows + label Seat/Left by party"
```

---

### Task 3: `ReservationsBoardView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/ReservationsBoardView.swift` (`reservationRow`
  ~180-237)

**Interfaces:** Self-contained.

Single zone, no restructuring needed — the info `VStack` is already its own isolated
container (no button lives inside it), so this is a pure trailing-modifier addition plus
4 new button labels. The row's pre-existing delete-button
`.accessibilityLabel("Delete reservation for \(r.partyName)")` must remain untouched.
The left-edge green accent bar for seated status is verified NOT a gap (decorative
reinforcement of already-combined status text) — do not touch it.

- [ ] **Step 1: Fix `reservationRow`**

```swift
    private func reservationRow(_ r: ReservationRow) -> some View {
        let busy = vm.busyId == r.id
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(r.partyName).font(.headline)
                    Text("\(r.partySize) ppl")
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(.quaternary, in: Capsule())
                    let time = ReservationsCompute.formatRowTime(r.reservationAt)
                    if !time.isEmpty {
                        Text(time).font(.caption).foregroundStyle(.secondary)
                    }
                    Text(ReservationsCompute.statusLabel(r.status))
                        .font(.caption.bold())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(statusTone(r.status), in: Capsule())
                        .foregroundStyle(.white)
                }
                Text(rowMeta(r)).font(.caption).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            Spacer()
            HStack(spacing: 8) {
                if r.status == "booked" {
                    Button(vm.cookStore.cookId != nil ? "Seat" : "Pick cook to seat") {
                        Task { await vm.seat(id: r.id) }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(busy)
                    .accessibilityLabel(vm.cookStore.cookId != nil ? "Seat \(r.partyName)" : "Pick a cook, then seat \(r.partyName)")
                    Button("No-show") { Task { await vm.noShow(id: r.id) } }
                        .buttonStyle(.bordered)
                        .disabled(busy)
                        .accessibilityLabel("Mark \(r.partyName) a no-show")
                    Button("Cancel") { Task { await vm.cancel(id: r.id) } }
                        .buttonStyle(.bordered)
                        .disabled(busy)
                        .accessibilityLabel("Cancel reservation for \(r.partyName)")
                }
                if r.status == "seated" {
                    Button("Done") { Task { await vm.complete(id: r.id) } }
                        .buttonStyle(.borderedProminent)
                        .disabled(busy)
                        .accessibilityLabel("Complete reservation for \(r.partyName)")
                }
                Button {
                    confirmDeleteRow = r
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.bordered)
                .disabled(busy)
                .accessibilityLabel("Delete reservation for \(r.partyName)")
            }
        }
        .padding(10)
        .background(.background.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
        .overlay(alignment: .leading) {
            if r.status == "seated" {
                Rectangle().fill(LariatTheme.ok).frame(width: 3)
            }
        }
    }
```

New: `.accessibilityElement(children: .combine)` on the info `VStack`, and 4 new
`.accessibilityLabel(...)` lines on Seat/No-show/Cancel/Done. The pre-existing
`.accessibilityLabel("Delete reservation for \(r.partyName)")` on the delete Button is
unchanged — same wording, same position.

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/ReservationsBoardView.swift
git commit -m "T3: ReservationsBoardView — combine row info + label Seat/No-show/Cancel/Done by party"
```

---

### Task 4: `BookingBoardView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/BookingBoardView.swift` (`pipelineSection`
  ~113-136, `showTable` ~166-196)

**Interfaces:** Self-contained.

Two zones. `showTable` is the tier's only Dynamic-Type fix — the tier's most complex
single site. The pre-existing `.accessibilityLabel("Next show: \(next.bandName). Open
tonight's board.")` on `header`'s Button is untouched by this task (different function).

1. **`pipelineSection`** — each stage tile's 3 `Text`s (STAGE N / count / stage name)
   fragment into 3 stops, no interactive control, no color-only signal (the amber tint
   on late-stage tiles is decorative — the stage name itself already uniquely
   identifies it). Pure trailing `.combine`.
2. **`showTable` — the confirmed Dynamic-Type risk.** 6 fixed-`width` `Text` columns
   (Date/Price/Door × header row + every data row) in a dense table — `width:` →
   `minWidth:` on all 6. Header row stays as 4 separate stops (normal table-header
   behavior); each data row gets `.combine`.

- [ ] **Step 1: Fix `pipelineSection`**

```swift
    private func pipelineSection(_ counts: [String: Int]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Booking pipeline").font(.headline)
            Text("live count by stage").font(.caption).foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8)], spacing: 8) {
                ForEach(Array(ShowPipelineCompute.knownStages.enumerated()), id: \.element) { i, stage in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("STAGE \(i + 1)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text("\(counts[stage] ?? 0)")
                            .font(.system(size: 30, weight: .semibold, design: .serif))
                        Text(stage).font(.subheadline.bold())
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(
                        i >= 4 ? AnyShapeStyle(LariatTheme.amber.opacity(0.18)) : AnyShapeStyle(.quaternary),
                        in: RoundedRectangle(cornerRadius: 10)
                    )
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
```

Only the trailing `.accessibilityElement(children: .combine)` on the stage tile is new.

- [ ] **Step 2: Fix `showTable`'s Dynamic-Type risk**

```swift
    private func showTable(_ rows: [BookingShowRow]) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("Date").frame(minWidth: 110, alignment: .leading)
                Text("Artist").frame(maxWidth: .infinity, alignment: .leading)
                Text("Price").frame(minWidth: 80, alignment: .trailing)
                Text("Door").frame(minWidth: 90, alignment: .leading)
            }
            .font(.caption.bold())
            .foregroundStyle(.secondary)
            .padding(.vertical, 6)
            Divider()
            ForEach(rows) { row in
                HStack {
                    Text(fmtDate(row.showDate))
                        .font(.caption.monospaced())
                        .frame(minWidth: 110, alignment: .leading)
                    Text(row.bandName)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(row.price.map { formatDollars($0, decimals: 2) } ?? "—")
                        .font(.caption.monospaced())
                        .frame(minWidth: 80, alignment: .trailing)
                    Text(row.doorTix ?? "—")
                        .font(.caption)
                        .frame(minWidth: 90, alignment: .leading)
                }
                .accessibilityElement(children: .combine)
                .padding(.vertical, 6)
                Divider()
            }
        }
    }
```

All 6 `width:` → `minWidth:` (3 in the header row, 3 in the per-row `HStack`); the
per-row `HStack` gets a trailing `.accessibilityElement(children: .combine)`. The header
row is NOT combined — reading 4 distinct one-word column labels individually is normal
VoiceOver table-header behavior, not a gap.

**Note for the implementer, not an action item:** because each row is an independent
`HStack` (not a shared-column `Grid`/`Table`), matching `minWidth` values across the
header and every data row preserves the *current* column alignment at the base text
size, but at very large Dynamic Type sizes individual rows can grow their columns
independently and drift out of visual alignment with each other. This is a pre-existing
architectural characteristic of the per-row-HStack design, not introduced by this fix —
the `minWidth` change only prevents text clipping. Do not attempt to redesign this into
a shared-column grid; that is out of scope for this task.

- [ ] **Step 3: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/BookingBoardView.swift
git commit -m "T4: BookingBoardView — combine pipeline tiles + fix show-table Dynamic-Type clipping"
```

---

### Task 5: Final verification

**Files:** None (verification only).

**Interfaces:** Depends on Tasks 1-4 all committed.

- [ ] **Step 1: Full build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 2: Scripted coverage audit (not prose)**

```bash
cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-foh/LariatNative
files=(
  FloorView HostStandView ReservationsBoardView BookingBoardView
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
  echo "COVERAGE OK — all 4 files have at least one accessibility modifier"
else
  echo "COVERAGE VIOLATION — see MISSING lines above"
  exit 1
fi
```

Expected: `COVERAGE OK — all 4 files have at least one accessibility modifier`.

- [ ] **Step 3: Scope check (scripted)**

```bash
git fetch origin
base=$(git merge-base origin/main HEAD)
expected=$(cat <<'EOF'
LariatNative/Sources/LariatApp/FloorView.swift
LariatNative/Sources/LariatApp/HostStandView.swift
LariatNative/Sources/LariatApp/ReservationsBoardView.swift
LariatNative/Sources/LariatApp/BookingBoardView.swift
EOF
)
actual=$(git diff --name-only "$base" -- LariatNative)
if diff <(echo "$expected" | sort) <(echo "$actual" | sort) > /tmp/h7a-phase2-foh-scope-diff.txt; then
  echo "SCOPE OK — exactly the expected 4 files changed under LariatNative/"
else
  echo "SCOPE VIOLATION:"
  cat /tmp/h7a-phase2-foh-scope-diff.txt
  exit 1
fi
```

Expected: `SCOPE OK — exactly the expected 4 files changed under LariatNative/`.

- [ ] **Step 4: Mandatory final whole-branch review**

Compare all 4 files' diffs side by side. Specifically check: does any task nest a
`Button` inside a `.accessibilityElement(children: .combine)` block? Are the 3
pre-existing accessibility labels (`FloorView`, `ReservationsBoardView`,
`BookingBoardView`) byte-for-byte unchanged? Are the two wrapper restructurings
(`FloorView.actionPanel`, `HostStandView.waitingRow`) genuinely layout-neutral — same
spacing values inside the new wrapper as the surrounding container used before?

- [ ] **Step 5: Manual VoiceOver spot-check (documented, non-gating)**

Needs a real desktop session. Turn on VoiceOver (Cmd+F5), open all 4 boards, and
confirm: a selected Floor table tile announces "selected"; the Booking board's show
table rows announce sensibly; Host Stand's Seat/Left buttons announce the party name;
Reservations' Seat/No-show/Cancel/Done buttons each announce the party name.

- [ ] **Step 6: Open PR**

```bash
git push -u origin feat/lariat-native-h7a-phase2-foh
gh pr create --base main --head feat/lariat-native-h7a-phase2-foh \
  --title "feat(native): H7a Phase 2 — VoiceOver labels for .foh tier" \
  --body "See docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-foh-tier-design.md and docs/superpowers/plans/2026-07-05-lariat-native-h7a-phase2-foh-tier.md for full detail. 4 tasks (T1-T4), one commit per file, plus this T5 scripted verification + whole-branch review."
```

**Commit message:** none (verification only).

---

## Self-Review

**1. Spec coverage:** Goal (labels + verbalize the 1 confirmed selection-state signal +
fix the 1 confirmed Dynamic-Type risk across the 4 `.foh` files) ✓ — every file has its
own task. Non-goals (shared cross-tier/app-wide components, other 4 tiers, `LariatModel`
extraction, new dependency) — no task violates any of these. Invariants — every touched
interactive control now has a label naming its target (Seat/Left/No-show/Cancel/Done all
now embed the party name); the one status-bearing element relying on visual state alone
(`FloorView.tableTile`'s selection stroke) now verbalizes via `.isSelected`; no
interactive control is nested inside `.combine` in any task; all 3 pre-existing labels
are explicitly preserved. Testing/acceptance — Task 5's scripted coverage + scope-diff
checks mirror the established precedent; manual VoiceOver spot-check documented as
non-gating.

**2. Placeholder scan:** No "TBD"/"add appropriate handling"/"similar to Task N"
language anywhere — every task shows complete before/after code for its zone.

**3. Type consistency:** `FloorView.tableTile`'s `.isSelected` idiom matches the
pre-existing `DatapackSearchView.swift:86` pattern, not a new invention. `ReservationsBoardView.reservationRow`'s button conditions (`vm.cookStore.cookId`,
`r.status`) and `HostStandView.waitingRow`'s `vm.requestTransition` calls are read
directly from each file during the audit, not invented. No task declares a duplicate
type or helper another task also declares.
