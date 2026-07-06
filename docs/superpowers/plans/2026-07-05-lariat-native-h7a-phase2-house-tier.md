# LariatNative H7a Phase 2 — House tier: VoiceOver labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VoiceOver labels, verbalize the 1 confirmed color-only signal, expose the 2
confirmed selection/expansion states, and fix the 1 confirmed Dynamic-Type risk across
the 4 `.house`-tier board views.

**Architecture:** Per-file, inline `.accessibilityElement(children: .combine)` +
`.accessibilityLabel(...)` / `.accessibilityAddTraits(...)` / `.accessibilityHidden(...)`
additions matching `SanitizerView.swift`'s house pattern — no extraction to
`LariatModel`, no new types, no new dependency. Unlike the FOH tier, no zone in this
tier needs a wrapper restructuring — every fix is a trailing modifier or a direct
addition to an existing Button.

**Tech Stack:** SwiftUI (macOS), no new packages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-house-tier-design.md`.
- No new dependency (this codebase has exactly one — GRDB — today).
- No extraction of accessibility-label strings into `LariatModel` — inline in the View
  body, matching `SanitizerView.swift:73`.
- No XCTest is possible for this work — `LariatApp` has no test target. Acceptance per
  task is `swift build` clean. The final task runs a scripted coverage + scope audit.
- The other 4 remaining `FeatureTier`s are out of scope — do not touch any file outside
  the 4 named below.
- **`EquipmentView.swift`'s pre-existing `.accessibilityLabel("Open the manual for this
  equipment")` on `manualRow`'s local-file Button must remain byte-for-byte unchanged.**
  No task touches `manualRow` or `detailsTab` at all.
- Every task's changes are strictly additive (trailing modifiers, or a direct addition
  to an existing Button/Image) — no behavior change for a sighted user, no restructuring
  needed anywhere in this tier.
- **Line ranges are locators from the pre-implementation audit, not guaranteed exact** —
  if a file has drifted, locate the named function/struct by name.
- The ONE Dynamic-Type fix in this tier: `GoldStarsView.leaderboardSection`'s rank
  `Text` `width: 34` → `minWidth: 34`. No other file needs a Dynamic-Type fix.
- **Strictly additive discipline:** a prior task in this sweep (Cook tier's T4) deleted
  2 pre-existing comments as an unintended side effect of "matching the brief exactly."
  Every task below must preserve every pre-existing comment/line not directly touched by
  its named fix.

---

### Task 1: `BarView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/BarView.swift` (`countBadge` ~80-89,
  `pourRow` ~91-122)

**Interfaces:** Self-contained — no other task depends on this file.

Two zones:

1. **`countBadge`** — fragmentation only, no color-only signal (each badge already has
   descriptive text). Pure trailing `.combine`.
2. **`pourRow` — the tier's one confirmed color-only signal.** The trailing percentage
   `Text` is tone-colored (red/yellow/green) with no spoken tone word. Fix adds a new
   `pourRowAccessibilityLabel` helper and a `toneWord(_:)` function (no pre-existing
   word-mapping helper to reuse — only `color(for:)`, which maps to `Color` and stays
   unchanged).

- [ ] **Step 1: Fix `countBadge`**

```swift
    private func countBadge(_ n: Int, _ label: String, _ meta: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("\(n) \(label)")
                .font(.callout.bold())
                .foregroundStyle(color)
            Text(meta)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
```

Only the trailing `.accessibilityElement(children: .combine)` is new.

- [ ] **Step 2: Fix `pourRow`**

```swift
    @ViewBuilder
    private func pourRow(_ row: BarPourCostRow) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(row.name).font(.callout.weight(.semibold))
                    if let category = row.category {
                        Text(category.uppercased())
                            .font(.caption2)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.secondary.opacity(0.4)))
                            .foregroundStyle(.secondary)
                    }
                }
                Text("Cost \(money(row.costPerPour)) / pour · Menu \(money(row.menuPrice))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let pct = row.pourCostPct {
                Text(String(format: "%.1f%%", pct))
                    .font(.title3.bold())
                    .foregroundStyle(color(for: row.tone))
            } else {
                Text(row.grayReason ?? "unpriced")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(pourRowAccessibilityLabel(row))
    }

    /// Verbalizes the pour-cost tone otherwise conveyed only by the trailing
    /// percentage's color — same wording `distribution`'s badges already use.
    private func pourRowAccessibilityLabel(_ row: BarPourCostRow) -> String {
        var parts = [row.name]
        if let category = row.category { parts.append(category) }
        parts.append("Cost \(money(row.costPerPour)) per pour, Menu \(money(row.menuPrice))")
        if let pct = row.pourCostPct {
            parts.append(String(format: "%.1f%% pour cost, %@", pct, toneWord(row.tone)))
        } else {
            parts.append(row.grayReason ?? "unpriced")
        }
        return parts.joined(separator: ", ")
    }

    /// No pre-existing `Tone`/word helper to reuse — `color(for:)` (elsewhere in
    /// this file) only maps to `Color`, not words. New helper, same case order.
    private func toneWord(_ tone: BarTone) -> String {
        switch tone {
        case .red: return "over"
        case .yellow: return "watch"
        case .green: return "on target"
        case .gray: return "unpriced"
        }
    }
```

New: the trailing `.accessibilityElement(children: .combine)` + `.accessibilityLabel(...)`
on the row, plus the two new private helper functions (`pourRowAccessibilityLabel`,
`toneWord`). The pre-existing `color(for:)` and `money(...)` helpers are unchanged.

- [ ] **Step 3: Build**

Run: `cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-house/LariatNative && swift build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/BarView.swift
git commit -m "T1: BarView — combine count badges + verbalize pour-cost tone"
```

---

### Task 2: `BarParView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/BarParView.swift` (`parRow` ~95-115)

**Interfaces:** Self-contained.

Single fragmentation gap, no color-only signal (the "low" badge already spells out
"low" in text; the amber tint is reinforcement only). No interactive control in the row.

- [ ] **Step 1: Fix `parRow`**

```swift
    @ViewBuilder
    private func parRow(_ row: BarParRow) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.ingredient).font(.callout)
                Text(metaLine(row))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if row.isLow {
                Text("low")
                    .font(.caption2.bold())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(LariatTheme.warn.opacity(0.2), in: Capsule())
                    .foregroundStyle(LariatTheme.warn)
            }
        }
        .padding(.vertical, 1)
        .accessibilityElement(children: .combine)
    }
```

Only the trailing `.accessibilityElement(children: .combine)` is new. No override label
needed — the default concatenated reading (ingredient, meta line, "low") is already
fully informative.

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/BarParView.swift
git commit -m "T2: BarParView — combine par rows into one VoiceOver element"
```

---

### Task 3: `EquipmentView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/EquipmentView.swift` (`equipmentCard` ~65-88,
  `partsTab` ~206-225, `scheduleTab` ~246-267)

**Interfaces:** Self-contained.

Three zones, none requiring restructuring. The pre-existing
`.accessibilityLabel("Open the manual for this equipment")` in `manualRow` (a different
function, not touched by this task) must remain byte-for-byte unchanged.

1. **`equipmentCard`'s expand/collapse `Button` — confirmed expansion-state gap.**
   Structurally identical to `DatapackSearchView.hitRow`'s toggle-disclosure pattern
   (`.accessibilityAddTraits(vm.isOpen(hit) ? [.isSelected] : [])` at
   `DatapackSearchView.swift:86`) — reuse the same idiom.
2. **`partsTab`** — each part's number/description/meta/optional-notes fragments into up
   to 3 stops. Pure trailing `.combine`.
3. **`scheduleTab`** — each scheduled task's name/meta/optional-notes fragments into up
   to 3 stops. The red "overdue" tint is reinforcement only (`scheduleMeta` already
   appends "(overdue)" in text). Pure trailing `.combine`.

- [ ] **Step 1: Fix `equipmentCard`'s expansion state**

```swift
    @ViewBuilder
    private func equipmentCard(_ item: EquipmentRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                vm.toggleExpand(item.id)
            } label: {
                cardHeader(item)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(vm.expandedId == item.id ? [.isSelected] : [])

            if vm.expandedId == item.id {
                Divider()
                Picker("Tab", selection: $vm.activeTab) {
                    ForEach(EquipmentViewModel.DetailTab.allCases, id: \.self) { tab in
                        Text(tabLabel(tab, item: item)).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()

                switch vm.activeTab {
                case .details: detailsTab(item)
                case .parts: partsTab(item)
                case .schedule: scheduleTab(item)
                case .log: logTab(item)
                }
            }
        }
        .padding(.vertical, 4)
    }
```

Only the trailing `.accessibilityAddTraits(...)` is new, matching
`DatapackSearchView.swift:86` exactly.

- [ ] **Step 2: Fix `partsTab`**

```swift
    @ViewBuilder
    private func partsTab(_ item: EquipmentRow) -> some View {
        let itemParts = vm.partsFor(item.id)
        VStack(alignment: .leading, spacing: 8) {
            if itemParts.isEmpty {
                Text("No parts on file.").font(.caption).italic().foregroundStyle(.secondary)
            }
            ForEach(itemParts) { part in
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(part.partNumber)\(part.description.map { " — \($0)" } ?? "")")
                        .font(.caption.weight(.semibold))
                    Text(partMeta(part))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if let notes = part.notes, !notes.isEmpty {
                        Text(notes).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
            if vm.addPartFor == item.id {
                addPartForm(item)
            } else {
                Button("+ Add a part") { vm.addPartFor = item.id }
                    .font(.caption)
            }
        }
    }
```

Only the trailing `.accessibilityElement(children: .combine)` on the per-part `VStack`
is new.

- [ ] **Step 3: Fix `scheduleTab`**

```swift
    @ViewBuilder
    private func scheduleTab(_ item: EquipmentRow) -> some View {
        let rows = vm.scheduleFor(item.id)
        VStack(alignment: .leading, spacing: 8) {
            if rows.isEmpty {
                Text("No scheduled maintenance.").font(.caption).italic().foregroundStyle(.secondary)
            }
            ForEach(rows) { row in
                let overdue = EquipmentCompute.isPastDate(row.nextDue)
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.task).font(.caption.weight(.semibold))
                    Text(scheduleMeta(row, overdue: overdue))
                        .font(.caption2)
                        .foregroundStyle(overdue ? LariatTheme.bad : Color.secondary)
                    if let notes = row.notes, !notes.isEmpty {
                        Text(notes).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
            if vm.addSchedFor == item.id {
                addScheduleForm(item)
            } else {
                Button("+ Add scheduled task") { vm.addSchedFor = item.id }
                    .font(.caption)
            }
        }
    }
```

Only the trailing `.accessibilityElement(children: .combine)` on the per-schedule-row
`VStack` is new.

- [ ] **Step 4: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatApp/EquipmentView.swift
git commit -m "T3: EquipmentView — verbalize expand/collapse state + combine parts/schedule rows"
```

---

### Task 4: `GoldStarsView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/GoldStarsView.swift` (`recognitionRow`
  ~94-114, `leaderboardSection` ~116-137, award-sheet tier selector ~170-183)

**Interfaces:** Self-contained.

Three zones:

1. **`recognitionRow`** — info block fragments into 3 stops; the "Remove" button repeats
   identically across every row with no per-record disambiguation. The trailing
   star/Button `VStack` is deliberately NOT combined — the Button must stay a sibling.
2. **`leaderboardSection` — the tier's one confirmed Dynamic-Type risk.** Rank `Text`
   uses fixed `width: 34` in a dense 3-column row → `minWidth: 34`. No interactive
   control in the row — pure trailing `.combine`.
3. **Award-sheet tier selector — confirmed selection-state gap.** Currently-selected
   tier conveyed by a checkmark image alone. Reuse the `.isSelected` idiom
   (`DatapackSearchView.swift:86`); hide the now-redundant checkmark from VoiceOver.

- [ ] **Step 1: Fix `recognitionRow`**

```swift
    @ViewBuilder
    private func recognitionRow(_ record: GoldStarRow) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(record.cookName).font(.callout.weight(.semibold))
                Text(record.reason).font(.caption)
                Text("Awarded: \(awardedDate(record.awardedDate))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(String(repeating: "★", count: max(record.stars, 1)))
                    .foregroundStyle(LariatTheme.amber)
                Button("Remove", role: .destructive) { removeTarget = record }
                    .buttonStyle(.borderless)
                    .font(.caption)
                    .disabled(vm.isSaving)
                    .accessibilityLabel("Remove the gold star for \(record.cookName)")
            }
        }
        .padding(.vertical, 2)
    }
```

New: `.accessibilityElement(children: .combine)` on the leading info `VStack`, and
`.accessibilityLabel(...)` on the "Remove" `Button`. The trailing star/Button `VStack`
is intentionally left uncombined so the Button remains a plain sibling, never nested
inside a `.combine` scope.

- [ ] **Step 2: Fix `leaderboardSection`'s Dynamic-Type risk**

```swift
    @ViewBuilder
    private var leaderboardSection: some View {
        Section {
            if vm.leaderboard.isEmpty {
                EmptyState(message: "No stars awarded yet.", systemImage: "star")
            } else {
                ForEach(Array(vm.visibleLeaderboard.enumerated()), id: \.element.id) { index, cook in
                    HStack {
                        Text("#\(index + 1)")
                            .font(.caption.bold())
                            .foregroundStyle(index < 3 ? LariatTheme.amber : Color.secondary)
                            .frame(minWidth: 34, alignment: .leading)
                        Text(cook.cookName).font(.callout)
                        Spacer()
                        Text("\(cook.totalStars) ★")
                            .font(.callout.bold())
                            .foregroundStyle(LariatTheme.amber)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
```

`width: 34` → `minWidth: 34` on the rank `Text`; trailing `.accessibilityElement(children:
.combine)` added to the row `HStack` (no interactive control present in this row).

- [ ] **Step 3: Fix the award-sheet tier selector**

```swift
                Section("How big a deal") {
                    ForEach(GoldStarTier.allCases, id: \.rawValue) { tier in
                        Button {
                            vm.starCount = tier.rawValue
                        } label: {
                            HStack {
                                Text(tier.label)
                                Spacer()
                                if vm.starCount == tier.rawValue {
                                    Image(systemName: "checkmark")
                                        .accessibilityHidden(true)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(vm.starCount == tier.rawValue ? [.isSelected] : [])
                    }
                }
```

New: `.accessibilityAddTraits(...)` on the `Button` (matching
`DatapackSearchView.swift:86`), and `.accessibilityHidden(true)` on the checkmark
`Image` — its meaning is now redundant with the trait, same rationale as the
Inventory-tier's decorative-chevron-hide fix.

- [ ] **Step 4: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatApp/GoldStarsView.swift
git commit -m "T4: GoldStarsView — label Remove by cook, fix rank-column Dynamic-Type, verbalize tier selection"
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
cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-house/LariatNative
files=(
  BarView BarParView EquipmentView GoldStarsView
)
fail=0
for f in "${files[@]}"; do
  count=$(grep -cE '\.accessibilityLabel|\.accessibilityElement|\.accessibilityHint|\.accessibilityValue|\.dynamicTypeSize|accessibilityAddTraits|accessibilityHidden' "Sources/LariatApp/${f}.swift")
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
LariatNative/Sources/LariatApp/BarView.swift
LariatNative/Sources/LariatApp/BarParView.swift
LariatNative/Sources/LariatApp/EquipmentView.swift
LariatNative/Sources/LariatApp/GoldStarsView.swift
EOF
)
actual=$(git diff --name-only "$base" -- LariatNative)
if diff <(echo "$expected" | sort) <(echo "$actual" | sort) > /tmp/h7a-phase2-house-scope-diff.txt; then
  echo "SCOPE OK — exactly the expected 4 files changed under LariatNative/"
else
  echo "SCOPE VIOLATION:"
  cat /tmp/h7a-phase2-house-scope-diff.txt
  exit 1
fi
```

Expected: `SCOPE OK — exactly the expected 4 files changed under LariatNative/`.

- [ ] **Step 4: Mandatory final whole-branch review**

Compare all 4 files' diffs side by side. Specifically check: does any task nest a
`Button` inside a `.accessibilityElement(children: .combine)` block? Is
`EquipmentView`'s pre-existing `.accessibilityLabel("Open the manual for this
equipment")` byte-for-byte unchanged, and is `manualRow`/`detailsTab` untouched by any
task? Do both new `.isSelected` sites (`EquipmentView.equipmentCard`,
`GoldStarsView`'s tier selector) apply the trait directly to the Button itself, not to
a wrapping container that also holds other content?

- [ ] **Step 5: Manual VoiceOver spot-check (documented, non-gating)**

Needs a real desktop session. Turn on VoiceOver (Cmd+F5), open all 4 boards, and
confirm: Bar board pour rows announce the tone word; expanding/collapsing an Equipment
card announces "selected"/not; Gold Stars' Remove button announces the cook's name; the
award-sheet tier selector announces "selected" for the current tier.

- [ ] **Step 6: Open PR**

```bash
git push -u origin feat/lariat-native-h7a-phase2-house
gh pr create --base main --head feat/lariat-native-h7a-phase2-house \
  --title "feat(native): H7a Phase 2 — VoiceOver labels for .house tier" \
  --body "See docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-house-tier-design.md and docs/superpowers/plans/2026-07-05-lariat-native-h7a-phase2-house-tier.md for full detail. 4 tasks (T1-T4), one commit per file, plus this T5 scripted verification + whole-branch review."
```

**Commit message:** none (verification only).

---

## Self-Review

**1. Spec coverage:** Goal (labels + verbalize the 1 color-only signal + expose the 2
selection/expansion states + fix the 1 Dynamic-Type risk across the 4 `.house` files) ✓
— every file has its own task. Non-goals (shared cross-tier/app-wide components, other
4 tiers, `LariatModel` extraction, new dependency) — no task violates any of these.
Invariants — the "Remove" button now names its target; both selection-state elements
now expose `.isSelected`; the one color-only signal now verbalizes via `toneWord(_:)`;
no interactive control is nested inside `.combine` in any task;
`EquipmentView`'s pre-existing label is explicitly untouched. Testing/acceptance —
Task 5's scripted coverage + scope-diff checks mirror the established precedent; manual
VoiceOver spot-check documented as non-gating.

**2. Placeholder scan:** No "TBD"/"add appropriate handling"/"similar to Task N"
language anywhere — every task shows complete before/after code for its zone.

**3. Type consistency:** Both `.isSelected` sites (`EquipmentView.equipmentCard`,
`GoldStarsView`'s tier selector) match the pre-existing `DatapackSearchView.swift:86`
pattern, not a new invention. `BarView`'s new `toneWord(_:)` switches on the same
`BarTone` type as the pre-existing `color(for:)`, read directly from the file during the
audit, not invented — it does not duplicate `color(for:)`'s body (different return
types). No task declares a duplicate type or helper another task also declares.
