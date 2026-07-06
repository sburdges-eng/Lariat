# LariatNative H7a Phase 2 — Labor tier: VoiceOver labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VoiceOver labels, verbalize the 1 confirmed color-only signal, and fix the
reading order of `TipPoolView`'s KPI tiles across the 4 `.labor`-tier board views.

**Architecture:** Per-file, inline `.accessibilityElement(children: .combine)` +
`.accessibilityLabel(...)` additions matching `SanitizerView.swift`'s house pattern — no
extraction to `LariatModel`, no new types, no new dependency. One zone
(`StaffCertsView.certRow`) needs a layout-neutral wrapper to isolate read-only info from
a sibling button; everything else is a trailing modifier.

**Tech Stack:** SwiftUI (macOS), no new packages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-labor-tier-design.md`.
- No new dependency (this codebase has exactly one — GRDB — today).
- No extraction of accessibility-label strings into `LariatModel` — inline in the View
  body, matching `SanitizerView.swift:73`.
- **No compute/compliance-math changes of any kind.** This plan touches only View-layer
  accessibility modifiers — never `LariatModel`'s cert/sick-leave/tip-pool/wage-notice
  compute or repository code.
- No XCTest is possible for this work — `LariatApp` has no test target. Acceptance per
  task is `swift build` clean. The final task runs a scripted coverage + scope audit.
- **`TileDegrade.swift`, `PinEntrySheet.swift` are out of scope** — shared cross-tier
  components. Do not touch them in this plan.
- The other 3 remaining `FeatureTier`s are out of scope — do not touch any file outside
  the 4 named below.
- Every task's changes are strictly additive except the one necessary restructuring in
  `StaffCertsView.certRow` (wrapping the header `HStack` + meta `Text` in a new inner
  `VStack(alignment: .leading, spacing: 6)` matching the outer's own spacing —
  layout-neutral) — no other zone in this tier needs restructuring.
- **Line ranges are locators from the pre-implementation audit, not guaranteed exact** —
  if a file has drifted, locate the named function/struct by name.
- **Zero Dynamic-Type fixes are needed anywhere in this tier** — confirmed no fixed-width
  `Text` columns exist in any file, including the two money-heavy boards
  (`TipPoolView`, `WageNoticeView`). No task below includes a `width` → `minWidth`
  change.
- **Strictly additive discipline:** a prior task in this sweep (Cook tier's T4) deleted
  2 pre-existing comments as an unintended side effect of "matching the brief exactly."
  Every task below must preserve every pre-existing comment/line not directly touched by
  its named fix.
- **Commit tooling note:** the MACP file-claim guardrail (`scripts/check-session-branch.mjs`)
  defaults to treating the committer as agent `"gemini"` unless `AGENT_NAME` is set in
  the shell. Every commit step below MUST be run with `AGENT_NAME=claude` set, e.g.
  `AGENT_NAME=claude git commit -m "..."` — omitting this causes a false-positive
  "file claim conflict" block (not a real multi-agent collision; do not use
  `--no-verify` or any other bypass instead).

---

### Task 1: `StaffCertsView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/StaffCertsView.swift` (`certRow` ~69-92)

**Interfaces:** Self-contained — no other task depends on this file. Reuses the
pre-existing `color(_:)`, `expiryText(_:)`, `metaLine(_:)` helpers unchanged; a new
`vm.tone(for:)` accessor (already exists on the view model) is referenced, not invented.

The tier's only zone needing both a color-only-signal fix and a restructuring:

1. **Color-only gap**: the `days > 0` branch of `metaLine` reads only "Nd left" for
   both amber (≤30 days, citation-risk window) and green (comfortably clear) tones —
   only amber is genuinely ambiguous; "inactive" (muted) and "expired Nd ago" (red) are
   already unambiguous in text and must NOT get an added word.
2. **Restructuring**: the "Retire" button must become a sibling of a new combined info
   `VStack`, not a flat sibling inside the same container that gets combined.
3. **Button-naming gap**: "Retire" repeats identically per row.

- [ ] **Step 1: Fix `certRow`**

```swift
@ViewBuilder
private func certRow(_ row: StaffCertRow) -> some View {
    VStack(alignment: .leading, spacing: 6) {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(vm.workerName(row.cookId)).font(.headline)
                Spacer()
                Text(expiryText(row))
                    .font(.caption2).padding(4)
                    .background(color(vm.tone(for: row)).opacity(0.18)).clipShape(Capsule())
                    .foregroundStyle(color(vm.tone(for: row)))
            }
            Text(metaLine(row)).font(.caption).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(certRowAccessibilityLabel(row))

        if row.active == 1 {
            Button(role: .destructive) {
                vm.requestRetire(id: row.id)
            } label: {
                Label("Retire", systemImage: "archivebox")
                    .font(.caption)
            }
            .accessibilityLabel("Retire the certification for \(vm.workerName(row.cookId))")
        }
    }
    .padding(.vertical, 2)
}

/// Verbalizes the row's header/meta text as one VoiceOver stop, plus the one
/// tone `metaLine`'s day-count doesn't already disambiguate: an active cert
/// with `days > 0` reads only "Nd left" whether that's inside the 30-day
/// citation-risk window (amber) or comfortably clear (green) — `metaLine`
/// already spells out "inactive" (muted) and "expired Nd ago" (red)
/// unambiguously, so only amber needs an extra word.
private func certRowAccessibilityLabel(_ row: StaffCertRow) -> String {
    var parts = [vm.workerName(row.cookId), expiryText(row), metaLine(row)]
    if vm.tone(for: row) == .amber {
        parts.append("renewal due soon")
    }
    return parts.joined(separator: ", ")
}
```

The header `HStack` + meta `Text` (formerly flat siblings of the outer `VStack`) are now
wrapped in a new inner `VStack(alignment: .leading, spacing: 6)` — the same spacing
value as the outer `VStack`, so the visual gap before/after this block and around the
conditional "Retire" button is unchanged. The "Retire" `Button` stays a sibling of the
new inner `VStack`, outside its `.combine` scope.

- [ ] **Step 2: Build**

Run: `cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-labor/LariatNative && swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/StaffCertsView.swift
AGENT_NAME=claude git commit -m "T1: StaffCertsView — verbalize amber expiry tone + label Retire by worker"
```

---

### Task 2: `SickLeaveView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/SickLeaveView.swift` (`balanceRow` ~69-84)

**Interfaces:** Self-contained.

Single fragmentation gap, no color-only signal — the orange/green badge and the
`" · cap hit"` meta suffix are both driven by the identical `b.atCap` condition, so color
is reinforcement only (same class as `BarParView`'s "low" badge from a prior tier). No
interactive control in the row.

- [ ] **Step 1: Fix `balanceRow`**

```swift
@ViewBuilder
private func balanceRow(_ b: BalanceSummary) -> some View {
    VStack(alignment: .leading, spacing: 6) {
        HStack {
            Text(vm.workerName(b.cookId)).font(.headline)
            Spacer()
            Text("\(hrs(b.hoursAvailable)) available")
                .font(.caption2).padding(4)
                .background((b.atCap ? Color.orange : .green).opacity(0.18)).clipShape(Capsule())
                .foregroundStyle(b.atCap ? .orange : .green)
        }
        Text("earned \(hrs(b.hoursAccrued)) · used \(hrs(b.hoursUsed)) · carry \(hrs(b.carryoverHours))\(b.atCap ? " · cap hit" : "")")
            .font(.caption).foregroundStyle(.secondary)
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
}
```

Only the trailing `.accessibilityElement(children: .combine)` is new.

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/SickLeaveView.swift
AGENT_NAME=claude git commit -m "T2: SickLeaveView — combine balance rows into one VoiceOver element"
```

---

### Task 3: `TipPoolView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/TipPoolView.swift` (`kpi` ~92-99, `content`'s
  "By cook" rows ~59-66, `content`'s "Lines" rows ~70-81)

**Interfaces:** Self-contained.

The tier's most fix-sites (3 zones), none with a color-only signal (verified: no
`.foregroundStyle` tint on any `Text` in this file). No interactive control in any of
the 3 zones.

1. **`kpi`** — reading-order fix, not a color/label gap. Default `.combine` would read
   "value, label" backwards; add an explicit `.accessibilityLabel("\(label):
   \(money(cents))")` so it reads "Total: $120.00".
2. **"By cook" rows** — name + money fragments into 2 stops.
3. **"Lines" rows** — name + kind/poolRef meta + money fragments into 3 stops.

- [ ] **Step 1: Fix `kpi`'s reading order**

```swift
@ViewBuilder
private func kpi(_ label: String, _ cents: Int) -> some View {
    VStack(spacing: 2) {
        Text(money(cents)).font(.headline).monospacedDigit()
        Text(label).font(.caption2).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(label): \(money(cents))")
}
```

- [ ] **Step 2: Fix the "By cook" and "Lines" rows**

```swift
@ViewBuilder
private var content: some View {
    VStack(alignment: .leading, spacing: 0) {
        List {
            Section {
                HStack {
                    kpi("Total", vm.summary.totalCents)
                    kpi("Pool", vm.summary.byKind[.tip_pool] ?? 0)
                    kpi("Svc chg", vm.summary.byKind[.service_charge] ?? 0)
                    kpi("Direct", vm.summary.byKind[.direct_tip] ?? 0)
                }
            }

            if let submitError = vm.submitError {
                Section { Text(submitError).font(.callout).foregroundStyle(.red) }
            }

            Section("By cook") {
                let sorted = vm.summary.byCook.sorted { $0.value > $1.value }
                if sorted.isEmpty {
                    Text("No tips recorded today.").foregroundStyle(.secondary)
                } else {
                    ForEach(sorted, id: \.key) { cook, cents in
                        HStack {
                            Text(vm.workerName(cook))
                            Spacer()
                            Text(money(cents)).monospacedDigit()
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }

            Section("Lines (\(vm.rows.count))") {
                ForEach(vm.rows) { row in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(vm.workerName(row.cookId)).font(.callout)
                            Text("\(row.kind.rawValue.replacingOccurrences(of: "_", with: " ")) · \(row.poolRef)")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(money(row.amountCents)).monospacedDigit()
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }

        HStack {
            Spacer()
            Button("Add line") { vm.showForm = true }
                .padding()
        }
    }
}
```

Only the two trailing `.accessibilityElement(children: .combine)` lines (one per
`ForEach` row) are new; nothing else in `content` changes.

- [ ] **Step 3: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/TipPoolView.swift
AGENT_NAME=claude git commit -m "T3: TipPoolView — fix KPI reading order + combine by-cook/lines rows"
```

---

### Task 4: `WageNoticeView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/WageNoticeView.swift` (`noticeRow` ~65-81)

**Interfaces:** Self-contained.

Single fragmentation gap, no color-only signal — the "needs new" badge's red tint is
reinforcement of already-self-describing text (same class as `SickLeaveView`'s "cap
hit" badge above). No interactive control in the row.

- [ ] **Step 1: Fix `noticeRow`**

```swift
@ViewBuilder
private func noticeRow(_ row: WageNoticeRow) -> some View {
    VStack(alignment: .leading, spacing: 6) {
        HStack {
            Text(vm.workerName(row.cookId)).font(.headline)
            Spacer()
            if vm.needsNew(row.cookId) {
                Text("needs new")
                    .font(.caption2).padding(4)
                    .background(Color.red.opacity(0.18)).clipShape(Capsule())
                    .foregroundStyle(.red)
            }
        }
        Text(metaLine(row)).font(.caption).foregroundStyle(.secondary)
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
}
```

Only the trailing `.accessibilityElement(children: .combine)` is new.

- [ ] **Step 2: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/WageNoticeView.swift
AGENT_NAME=claude git commit -m "T4: WageNoticeView — combine notice rows into one VoiceOver element"
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
cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-labor/LariatNative
files=(
  StaffCertsView SickLeaveView TipPoolView WageNoticeView
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
LariatNative/Sources/LariatApp/StaffCertsView.swift
LariatNative/Sources/LariatApp/SickLeaveView.swift
LariatNative/Sources/LariatApp/TipPoolView.swift
LariatNative/Sources/LariatApp/WageNoticeView.swift
EOF
)
actual=$(git diff --name-only "$base" -- LariatNative)
if diff <(echo "$expected" | sort) <(echo "$actual" | sort) > /tmp/h7a-phase2-labor-scope-diff.txt; then
  echo "SCOPE OK — exactly the expected 4 files changed under LariatNative/"
else
  echo "SCOPE VIOLATION:"
  cat /tmp/h7a-phase2-labor-scope-diff.txt
  exit 1
fi
```

Expected: `SCOPE OK — exactly the expected 4 files changed under LariatNative/`.

- [ ] **Step 4: Mandatory final whole-branch review**

Compare all 4 files' diffs side by side. Specifically check: does `StaffCertsView`'s
restructured `certRow` genuinely keep the "Retire" button a sibling of (never nested
inside) the combined info `VStack`? Does `certRowAccessibilityLabel` append "renewal due
soon" ONLY for the amber tone, not for muted/red/green? Confirm no task touched any
`LariatModel` compute/compliance file.

- [ ] **Step 5: Manual VoiceOver spot-check (documented, non-gating)**

Needs a real desktop session. Turn on VoiceOver (Cmd+F5), open all 4 boards, and
confirm: a StaffCerts row with an amber badge announces "renewal due soon"; the Retire
button announces the worker's name; TipPool's KPI tiles announce "label: value" not
"value, label".

- [ ] **Step 6: Open PR**

```bash
git push -u origin feat/lariat-native-h7a-phase2-labor
gh pr create --base main --head feat/lariat-native-h7a-phase2-labor \
  --title "feat(native): H7a Phase 2 — VoiceOver labels for .labor tier" \
  --body "See docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-labor-tier-design.md and docs/superpowers/plans/2026-07-05-lariat-native-h7a-phase2-labor-tier.md for full detail. 4 tasks (T1-T4), one commit per file, plus this T5 scripted verification + whole-branch review. No LariatModel/compute changes -- View-layer accessibility only."
```

**Commit message:** none (verification only).

---

## Self-Review

**1. Spec coverage:** Goal (labels + verbalize the 1 confirmed color-only signal + fix
`TipPoolView`'s KPI reading order across the 4 `.labor` files) ✓ — every file has its
own task. Non-goals (`TileDegrade`/`PinEntrySheet`, other 3 tiers, `LariatModel`
extraction/compute changes, new dependency) — no task violates any of these. Invariants
— the "Retire" button now names its target and stays a sibling of the combined info
block; the one genuinely ambiguous tone (amber) is verbalized, the other three are
correctly left untouched; no interactive control is nested inside `.combine` in any
task. Testing/acceptance — Task 5's scripted coverage + scope-diff checks mirror the
established precedent; manual VoiceOver spot-check documented as non-gating;
Dynamic-Type — spec states none found, no task claims one.

**2. Placeholder scan:** No "TBD"/"add appropriate handling"/"similar to Task N"
language anywhere — every task shows complete before/after code for its zone.

**3. Type consistency:** `certRowAccessibilityLabel` (Task 1) reads `vm.tone(for: row)`
and compares against `.amber`, the same accessor/case already used by the file's
existing `color(_:)` helper — read directly from the file during the audit, not
invented. `TipPoolView`'s `kpi` (Task 3) keeps its existing `money(cents)` helper
signature unchanged. No task declares a duplicate type or helper another task also
declares.
