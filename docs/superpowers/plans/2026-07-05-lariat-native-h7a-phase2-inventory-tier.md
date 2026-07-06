# LariatNative H7a Phase 2 — Inventory tier: VoiceOver labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VoiceOver labels across the 4 `.inventory`-tier board views, including
naming the 2 "Remove" buttons in `InventoryParView.swift` by item.

**Architecture:** Per-file, inline `.accessibilityElement(children: .combine)` +
`.accessibilityLabel(...)` additions matching `SanitizerView.swift`'s house pattern — no
extraction to `LariatModel`, no new types, no new dependency. Every fix in this tier is a
trailing modifier addition — no restructuring needed anywhere.

**Tech Stack:** SwiftUI (macOS), no new packages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-inventory-tier-design.md`.
- No new dependency (this codebase has exactly one — GRDB — today).
- No extraction of accessibility-label strings into `LariatModel` — inline in the View
  body, matching `SanitizerView.swift:73`.
- No XCTest is possible for this work — `LariatApp` has no test target. Acceptance per
  task is `swift build` clean. The final task runs a scripted coverage + scope audit.
- The other 5 remaining `FeatureTier`s are out of scope — do not touch any file outside
  the 4 named below.
- Every task's changes are strictly additive (trailing modifiers only) — no behavior
  change for a sighted user.
- **`InventoryParView.swift` is the first file in this sweep to use `.swipeActions` and
  `.contextMenu`.** These are modifiers, not visually-nested child views — VoiceOver
  exposes their content as custom actions/a menu, independent of whatever
  `.accessibilityElement(children: .combine)` scope is applied to the row's own
  informational content. Applying `.combine` to the row while leaving
  `.swipeActions`/`.contextMenu` as sibling modifiers on the same container does NOT
  nest an interactive control inside the combined element in the sense this sweep
  otherwise prohibits. Flag this reasoning explicitly at whole-branch review.
- **Line ranges are locators from the pre-implementation audit, not guaranteed exact** —
  if a file has drifted, locate the named function/struct by name.
- Zero Dynamic-Type fixes are needed in this tier — confirmed no fixed-width `Text`
  columns anywhere across all 4 files. No task below includes a `width` → `minWidth`
  change.
- **Strictly additive discipline:** a prior task in this sweep (Cook tier's T4) deleted
  2 pre-existing comments as an unintended side effect of "matching the brief exactly."
  Every task below must preserve every pre-existing comment/line not directly touched by
  its named fix (`InventoryParView.swift` in particular has a "Mouse-reachable delete"
  comment above its `.contextMenu` that must survive untouched).

---

### Task 1: `InventoryParView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/InventoryParView.swift` (`parRow` ~57-80)

**Interfaces:** Self-contained — no other task depends on this file.

One fragmentation gap (name + meta + "below par" badge, up to 3 stops, no color-only
signal since the badge already carries visible text) plus the tier's one real
button-labeling gap: the swipe-action and context-menu "Remove" buttons on the same row
both say only "Remove" with no item context.

- [ ] **Step 1: Fix `parRow`**

```swift
    @ViewBuilder
    private func parRow(_ row: InventoryParWithOnHand) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.par.ingredient).font(.callout)
                Text(metaLine(row)).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            if row.isLow {
                Text("below par")
                    .font(.caption2).padding(4)
                    .background(Color.red.opacity(0.18)).clipShape(Capsule())
                    .foregroundStyle(.red)
            }
        }
        .accessibilityElement(children: .combine)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { vm.remove(row.par.id) } label: { Label("Remove", systemImage: "trash") }
                .accessibilityLabel("Remove \(row.par.ingredient)")
        }
        // Mouse-reachable delete: on macOS swipe actions need a trackpad swipe,
        // so right-click must offer the same Remove.
        .contextMenu {
            Button(role: .destructive) { vm.remove(row.par.id) } label: { Label("Remove", systemImage: "trash") }
                .accessibilityLabel("Remove \(row.par.ingredient)")
        }
    }
```

New: the trailing `.accessibilityElement(children: .combine)` on the row `HStack`, and
`.accessibilityLabel("Remove \(row.par.ingredient)")` on each of the two "Remove"
buttons. The pre-existing "Mouse-reachable delete" comment must survive exactly as-is.

- [ ] **Step 2: Build**

Run: `cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-inventory/LariatNative && swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/InventoryParView.swift
git commit -m "T1: InventoryParView — combine par rows + label Remove by ingredient"
```

---

### Task 2: `InventoryCountsView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/InventoryCountsView.swift` (the `ForEach`
  wrapping `countRow`'s `Button` ~45, `countRow` chevron ~58-70, the detail sheet's
  status `HStack` ~137-141, `lineRow` ~175-181)

**Interfaces:** Self-contained.

Three fix sites, none with a color-only signal (both status badges already carry
visible text — "open"/"closed"):

1. **`countRow`'s enclosing `Button`** — "whole-row-is-a-button" idiom (matches
   Purchasing tier's `attachSheet` precedent): optional insurance `.combine` on the
   Button itself, plus hiding the purely decorative disclosure chevron from VoiceOver
   (it duplicates the Button's inherent "opens something" semantics).
2. **Detail sheet's status line** — date + status-badge fragments into 2 stops.
3. **`lineRow`** — ingredient + meta fragments into 2 stops.

- [ ] **Step 1: Fix the `ForEach` wrapping `countRow`**

```swift
                    ForEach(vm.counts) { c in
                        Button { vm.openDetail(c.id) } label: { countRow(c) }
                            .buttonStyle(.plain)
                            .accessibilityElement(children: .combine)
                    }
```

- [ ] **Step 2: Fix `countRow`'s decorative chevron**

```swift
    @ViewBuilder
    private func countRow(_ c: InventoryCountSummary) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(c.label?.isEmpty == false ? c.label! : "Count \(c.id)").font(.callout)
                Text(countMeta(c)).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            statusBadge(open: c.isOpen)
            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
    }
```

Only the trailing `.accessibilityHidden(true)` on the chevron `Image` is new.

- [ ] **Step 3: Fix the detail sheet's status line**

```swift
            Section {
                HStack {
                    Text(d.head.countDate).font(.callout)
                    Spacer()
                    statusBadge(open: d.head.isOpen)
                }
                .accessibilityElement(children: .combine)
                if d.head.isOpen {
                    Button(role: .destructive) { vm.closeSelected() } label: { Label("Close count", systemImage: "lock") }
                } else {
                    Button { vm.reopenSelected() } label: { Label("Reopen count", systemImage: "lock.open") }
                }
                if let e = vm.actionError { Text(e).font(.callout).foregroundStyle(.red) }
            }
```

Only the trailing `.accessibilityElement(children: .combine)` on the status `HStack` is
new. "Close count"/"Reopen count" already have unambiguous, self-describing labels and
the sheet is scoped to exactly one count — no per-button naming gap here, do not touch
these two buttons further.

- [ ] **Step 4: Fix `lineRow`**

```swift
    @ViewBuilder
    private func lineRow(_ line: InventoryCountLine) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(line.ingredient).font(.callout)
            Text(lineMeta(line)).font(.caption2).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
```

Only the trailing `.accessibilityElement(children: .combine)` is new.

- [ ] **Step 5: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 6: Commit**

```bash
git add LariatNative/Sources/LariatApp/InventoryCountsView.swift
git commit -m "T2: InventoryCountsView — combine count row/status/line, hide decorative chevron"
```

---

### Task 3: `InventoryLogView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/InventoryLogView.swift` (`movementRow` ~49-68)

**Interfaces:** Self-contained.

One fragmentation gap: item / note-or-station / delta / direction fragments into up to
4 stops, no color-only signal, no interactive control in the row.

- [ ] **Step 1: Fix `movementRow`**

```swift
    @ViewBuilder
    private func movementRow(_ row: InventoryUpdateRow) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.item).font(.callout)
                if let note = row.note, !note.isEmpty {
                    Text(note).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                } else if let station = row.stationId, !station.isEmpty {
                    Text(station).font(.caption2).foregroundStyle(.secondary)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(row.delta ?? "—").font(.callout.monospacedDigit())
                if let dir = row.direction, !dir.isEmpty {
                    Text(dir).font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
```

Only the trailing `.accessibilityElement(children: .combine)` is new.

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/InventoryLogView.swift
git commit -m "T3: InventoryLogView — combine movement rows into one VoiceOver element"
```

---

### Task 4: `InventoryWasteView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/InventoryWasteView.swift` (inline "most wasted"
  row inside the `ForEach` ~47-53, `recentRow` ~72-82)

**Interfaces:** Self-contained.

Two fragmentation gaps, neither with a color-only signal or an interactive control:

1. The inline "most wasted" row (item + hit count) fragments into 2 stops.
2. `recentRow` (item + meta + delta) fragments into 3 stops.

- [ ] **Step 1: Fix the "most wasted" row**

```swift
                Section("Most wasted") {
                    if vm.byItem.isEmpty {
                        Text("No waste logged in this range.").foregroundStyle(.secondary)
                    } else {
                        ForEach(vm.byItem) { b in
                            HStack {
                                Text(b.item).font(.callout)
                                Spacer()
                                Text("\(b.hits)×").font(.callout.monospacedDigit()).foregroundStyle(.secondary)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
```

- [ ] **Step 2: Fix `recentRow`**

```swift
    @ViewBuilder
    private func recentRow(_ row: InventoryUpdateRow) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.item).font(.callout)
                Text(recentMeta(row)).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer()
            Text(row.delta ?? "—").font(.callout.monospacedDigit())
        }
        .accessibilityElement(children: .combine)
    }
```

Only the two trailing `.accessibilityElement(children: .combine)` lines are new.

- [ ] **Step 3: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/InventoryWasteView.swift
git commit -m "T4: InventoryWasteView — combine most-wasted row + recent row into single VoiceOver stops"
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
cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-inventory/LariatNative
files=(
  InventoryParView InventoryCountsView InventoryLogView InventoryWasteView
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
LariatNative/Sources/LariatApp/InventoryParView.swift
LariatNative/Sources/LariatApp/InventoryCountsView.swift
LariatNative/Sources/LariatApp/InventoryLogView.swift
LariatNative/Sources/LariatApp/InventoryWasteView.swift
EOF
)
actual=$(git diff --name-only "$base" -- LariatNative)
if diff <(echo "$expected" | sort) <(echo "$actual" | sort) > /tmp/h7a-phase2-inventory-scope-diff.txt; then
  echo "SCOPE OK — exactly the expected 4 files changed under LariatNative/"
else
  echo "SCOPE VIOLATION:"
  cat /tmp/h7a-phase2-inventory-scope-diff.txt
  exit 1
fi
```

Expected: `SCOPE OK — exactly the expected 4 files changed under LariatNative/`.

- [ ] **Step 4: Mandatory final whole-branch review**

Compare all 4 files' diffs side by side. Specifically check: does any task nest a
`Button`/`Link`/`Menu` inside a `.accessibilityElement(children: .combine)` block where
the control renders as a visual child? Confirm `InventoryParView.swift`'s
`.swipeActions`/`.contextMenu` reasoning holds — that these modifiers coexisting with
`.combine` on the same container is not the same defect class as a rendered child
control trapped inside `.combine` (see Global Constraints above). Confirm the two
Remove-button labels correctly interpolate the ingredient name.

- [ ] **Step 5: Manual VoiceOver spot-check (documented, non-gating)**

Needs a real desktop session. Turn on VoiceOver (Cmd+F5), open all 4 boards, and
confirm: Par board rows announce name+meta+status, and swiping/right-clicking a row
announces "Remove {ingredient}" rather than a bare "Remove"; Counts board rows announce
sensibly and the detail sheet's status line reads as one stop; Log and Waste rows each
read as one combined stop.

- [ ] **Step 6: Open PR**

```bash
git push -u origin feat/lariat-native-h7a-phase2-inventory
gh pr create --base main --head feat/lariat-native-h7a-phase2-inventory \
  --title "feat(native): H7a Phase 2 — VoiceOver labels for .inventory tier" \
  --body "See docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-inventory-tier-design.md and docs/superpowers/plans/2026-07-05-lariat-native-h7a-phase2-inventory-tier.md for full detail. 4 tasks (T1-T4), one commit per file, plus this T5 scripted verification + whole-branch review. First use of .swipeActions/.contextMenu in this sweep (InventoryParView) -- verified these modifiers coexisting with .combine on the same container is not the interactive-control-nested-inside-combine defect class this sweep otherwise guards against."
```

**Commit message:** none (verification only).

---

## Self-Review

**1. Spec coverage:** Goal (labels across 4 files, including the 2 Remove-button
naming fixes) ✓ — every file has its own task. Non-goals (other 5 tiers, `LariatModel`
extraction, new dependency) — no task violates any of these. Invariants — every touched
interactive control (the 2 Remove buttons) now names its target; no interactive control
rendered as a visual child is nested inside `.combine` in any task; the
`.swipeActions`/`.contextMenu` situation is explicitly reasoned through, not silently
assumed safe. Testing/acceptance — Task 5's scripted coverage + scope-diff checks mirror
the established precedent; manual VoiceOver spot-check documented as non-gating;
Dynamic-Type — spec states none found, no task claims one.

**2. Placeholder scan:** No "TBD"/"add appropriate handling"/"similar to Task N"
language anywhere — every task shows complete before/after code for its file/zone.

**3. Type consistency:** `InventoryUpdateRow` (Tasks 3 and 4) is the same pre-existing
type shared with `ReceivingView.swift`, read directly from the file during the audit,
not invented — Task 3's `movementRow` and Task 4's `recentRow` both consume it with the
same field names (`item`, `note`, `stationId`, `delta`, `direction`). No task declares a
duplicate type or helper another task also declares.
