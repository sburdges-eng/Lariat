# LariatNative H7a Phase 2 — Purchasing tier: VoiceOver labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VoiceOver labels + verbalize the 2 confirmed color-only signals and 1
field-label gap across the 3 `.purchasing`-tier board views.

**Architecture:** Per-file, inline `.accessibilityElement(children: .combine)` +
`.accessibilityLabel(...)` additions matching `SanitizerView.swift`'s house pattern —
no extraction to `LariatModel`, no new types, no new dependency. Where a row mixes
read-only info with an interactive control, the info combines into its own accessibility
element and the control stays a sibling outside it.

**Tech Stack:** SwiftUI (macOS), no new packages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-purchasing-tier-design.md`.
- No new dependency (this codebase has exactly one — GRDB — today).
- No extraction of accessibility-label strings into `LariatModel` — inline in the View
  body, matching `SanitizerView.swift:73`.
- No XCTest is possible for this work — `LariatApp` has no test target. Acceptance per
  task is `swift build` clean. The final task runs a scripted coverage + scope audit.
- **`PinEntrySheet.swift` is out of scope.** It is presented from 19 files across nearly
  every tier. Do not touch it in this plan — it gets its own standalone task later.
- The other 8 remaining `FeatureTier`s are out of scope — do not touch any file outside
  the 3 named below.
- Every task's changes are strictly additive (accessibility modifiers only) — no
  behavior change for a sighted user, except `VendorCompareView.singlesSection`'s
  necessary restructuring to keep the "Attach" button a sibling of the combined info
  block.
- **Line ranges are locators from the pre-implementation audit, not guaranteed exact** —
  if a file has drifted, locate the named function/struct by name.
- Zero Dynamic-Type fixes are needed in this tier — every fixed-frame hit found during
  the audit was either decorative or a `maxWidth`/`maxHeight` ceiling, not a fixed-width
  `Text` column. No task below includes a `width` → `minWidth` change.
- **Strictly additive discipline:** a prior task in this sweep (Cook tier's T4) deleted
  2 pre-existing comments as an unintended side effect of "matching the brief exactly."
  Every task below must preserve every pre-existing comment/line not directly touched by
  its named fix.

---

### Task 1: `PurchasingOrderGuideView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/PurchasingOrderGuideView.swift` (`notesBadges`
  ~104-125)

**Interfaces:** Self-contained — no other task depends on this file.

Single fragmentation gap, no color-only signal (every badge already carries visible
text): up to 3 sibling badges (`"Pref {vendor}"`, `"Locked"` with a lock icon,
`"Mismatch"`) render as separate VoiceOver stops instead of one. This file uses a native
SwiftUI `Table` for its main grid, which already provides baseline row/column
accessibility semantics for free — only this one composite-cell helper needs a fix.

- [ ] **Step 1: Combine `notesBadges`**

```swift
    /// Pref / Locked / Mismatch badges (page.jsx L58-70).
    @ViewBuilder
    private func notesBadges(_ enrichment: OrderGuideEnrichment?) -> some View {
        HStack(spacing: 6) {
            if let preferred = enrichment?.preferredVendor {
                Text("Pref \(preferred)")
                    .font(.caption)
                    .help("Preferred vendor")
            }
            if enrichment?.qualityLocked == true {
                Label("Locked", systemImage: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(LariatTheme.warn)
                    .help(enrichment?.qualityLockReason ?? "quality")
            }
            if enrichment?.vendorMismatch == true {
                Text("Mismatch")
                    .font(.caption)
                    .foregroundStyle(LariatTheme.warn)
                    .help("Guide vendor differs from preferred")
            }
        }
        .accessibilityElement(children: .combine)
    }
```

Only the trailing `.accessibilityElement(children: .combine)` line is new — every other
line in this function must be preserved exactly as it currently reads in the file (do
not reformat the `if`/`help` structure). No custom `.accessibilityLabel` is needed since
every badge already carries visible text; `.combine` alone concatenates them correctly.

- [ ] **Step 2: Build**

Run: `cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-purchasing/LariatNative && swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/PurchasingOrderGuideView.swift
git commit -m "T1: PurchasingOrderGuideView — combine notes badges into one VoiceOver element"
```

---

### Task 2: `VendorCompareView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/VendorCompareView.swift` (`offerText`
  ~121-133, `rowActions` ~145-159, `singlesSection` ~163-188, `attachSheet`'s `List` rows
  ~204-218 — optional)

**Interfaces:** Self-contained.

Largest file in this tier: 3 required fixes + 1 optional insurance fix.

1. **`offerText` — confirmed color-only gap.** The cheaper vendor's price gets bold +
   green styling with no spoken equivalent.
2. **`rowActions` — unlabeled buttons.** "Unlock"/"Use Sysco"/"Use Shamrock"/"Lock for
   quality" don't name which ingredient they act on. Since these render inside `Table`
   rows, VoiceOver traverses cell-by-cell — hearing the same bare button label
   repeatedly across many rows with no item context is a real ambiguity gap.
3. **`singlesSection` — fragmented rows + unlabeled button.** Each row's
   `Text(canonicalName)` + `Text("has {vendor}")` are bare siblings (2 stops); "Attach
   {vendor}" doesn't name which item.
4. **`attachSheet`'s `List` rows — optional, zero-risk insurance only**, matching the
   Cook-tier precedent for Button-auto-flattening cases (not a confirmed defect).

- [ ] **Step 1: Fix `offerText`**

```swift
    /// `fmtPrice` + `reasonLabel` from the web page.
    @ViewBuilder
    private func offerText(_ offer: VendorOfferSnapshot?, highlighted: Bool) -> some View {
        if let offer, offer.status == .ok, let price = offer.normalizedPrice {
            let unit = offer.normalizedUnit.map { "/\($0)" } ?? ""
            Text("\(formatDollars(price, decimals: 2))\(unit)")
                .fontWeight(highlighted ? .semibold : .regular)
                .foregroundStyle(highlighted ? LariatTheme.ok : Color.primary)
                .accessibilityLabel("\(formatDollars(price, decimals: 2))\(unit)\(highlighted ? ", cheaper" : "")")
        } else {
            Text(Self.reasonLabel(offer?.reason))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
```

- [ ] **Step 2: Fix `rowActions`**

```swift
    @ViewBuilder
    private func rowActions(_ row: VendorCompareRow) -> some View {
        HStack(spacing: 6) {
            if row.qualityLocked {
                Button("Unlock") { vm.requestUnlock(masterId: row.masterId) }
                    .accessibilityLabel("Unlock \(row.canonicalName)")
            } else {
                Button("Use Sysco") { vm.requestSetPreferred(masterId: row.masterId, vendor: .sysco) }
                    .accessibilityLabel("Use Sysco for \(row.canonicalName)")
                Button("Use Shamrock") { vm.requestSetPreferred(masterId: row.masterId, vendor: .shamrock) }
                    .accessibilityLabel("Use Shamrock for \(row.canonicalName)")
                Button("Lock for quality") { vm.requestLock(masterId: row.masterId, currentPreferred: row.preferredVendor) }
                    .accessibilityLabel("Lock \(row.canonicalName) for quality")
            }
        }
        .buttonStyle(.borderless)
        .font(.caption)
        .disabled(vm.isSaving)
    }
```

- [ ] **Step 3: Fix `singlesSection`**

```swift
    // ── "One vendor only" (compare/page.jsx L103-133) ────────────────────

    @ViewBuilder
    private var singlesSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("One vendor only")
                .font(.headline)
                .padding(.horizontal)
            ForEach(vm.singles) { single in
                HStack {
                    HStack(spacing: 4) {
                        Text(single.canonicalName)
                        Text("has \(single.linkedVendor.rawValue)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                    Spacer()
                    Button("Attach \(single.missingVendor.rawValue)") {
                        vm.attachTarget = single
                        vm.attachQuery = ""
                        Task { await vm.loadAttachCandidates() }
                    }
                    .disabled(vm.isSaving)
                    .accessibilityLabel("Attach \(single.missingVendor.rawValue) for \(single.canonicalName)")
                }
                .padding(.horizontal)
                .padding(.vertical, 2)
            }
        }
        .padding(.vertical, 8)
    }
```

- [ ] **Step 4: Fix `attachSheet`'s List rows (optional insurance)**

```swift
                List(vm.attachRows) { row in
                    Button {
                        vm.requestAttach(row: row)
                    } label: {
                        HStack {
                            Text(row.ingredient)
                            if let label = row.packLabel {
                                Text("· \(label)").foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .combine)
                }
```

The `Button` is the interactive control the modifiers apply directly to (not some other
control nested inside a `.combine` wrapper) — this does not violate the
never-nest-a-control-inside-combine rule.

- [ ] **Step 5: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 6: Commit**

```bash
git add LariatNative/Sources/LariatApp/VendorCompareView.swift
git commit -m "T2: VendorCompareView — verbalize cheaper price, label row actions, combine singles rows"
```

---

### Task 3: `VendorLinkView.swift`

**Files:**
- Modify: `LariatNative/Sources/LariatApp/VendorLinkView.swift` (the "Staple name" field
  ~line 68-71, `catalogPicker` row `Button` ~141-161)

**Interfaces:** Self-contained. Reuses the `.isSelected` idiom already established at
`DatapackSearchView.swift:86` and reused by Cook tier's `StationChecklistView.statusButton`
— do not invent a new pattern.

Two fix sites, no new helper function needed:

1. **"Staple name" field — confirmed field-label gap.** The visible caption above the
   TextField isn't wired to it; VoiceOver falls back to the placeholder ("Chicken
   Breast", an example value) as the field's spoken name.
2. **`catalogPicker` row — confirmed selection-signal gap.** "Currently selected" is
   conveyed by a checkmark icon + background tint only, no `.isSelected` trait.

The `catalogPicker`'s own search `TextField("Search catalog", …)` has no gap — its
placeholder already IS the purpose description (matches the `StationChecklistView.
countField` precedent). Do not touch it.

- [ ] **Step 1: Fix the "Staple name" field**

```swift
                VStack(alignment: .leading, spacing: 4) {
                    Text("Staple name").font(.headline)
                    TextField("Chicken Breast", text: $vm.canonicalName)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 420)
                        .accessibilityLabel("Staple name")
                }
```

- [ ] **Step 2: Fix `catalogPicker`'s row Button**

```swift
    /// `CatalogPicker` from LinkPairForm.jsx: search field + unlinked rows,
    /// picked row highlighted.
    @ViewBuilder
    private func catalogPicker(
        label: String,
        vendor: CompareVendor,
        query: Binding<String>,
        rows: [CatalogRow],
        selection: CatalogRow?,
        onPick: @escaping (CatalogRow) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.headline)
            TextField("Search catalog", text: query)
                .textFieldStyle(.roundedBorder)
                .onSubmit { Task { await vm.loadCatalog(vendor) } }
                .onChange(of: query.wrappedValue) { _, _ in
                    Task { await vm.loadCatalog(vendor) }
                }
            if rows.isEmpty {
                EmptyState(message: "No unlinked \(vendor.rawValue) items match.", systemImage: "magnifyingglass")
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(rows) { row in
                            let isSelected = selection?.id == row.id
                            Button {
                                onPick(row)
                            } label: {
                                HStack {
                                    Text(row.ingredient)
                                    if let packLabel = row.packLabel {
                                        Text("· \(packLabel)").foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if isSelected {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(LariatTheme.ok)
                                    }
                                }
                                .contentShape(Rectangle())
                                .padding(.vertical, 3)
                                .padding(.horizontal, 6)
                                .background(isSelected ? Color.accentColor.opacity(0.12) : Color.clear)
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                            }
                            .buttonStyle(.plain)
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel(row.ingredient + (row.packLabel.map { " · \($0)" } ?? ""))
                            .accessibilityAddTraits(isSelected ? [.isSelected] : [])
                        }
                    }
                }
                .frame(maxHeight: 220)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
```

Only the trailing `.accessibilityElement`/`.accessibilityLabel`/`.accessibilityAddTraits`
lines on the row `Button` are new, plus the `.accessibilityLabel("Staple name")` on the
staple-name field — every other line must be preserved exactly.

- [ ] **Step 3: Build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/VendorLinkView.swift
git commit -m "T3: VendorLinkView — label staple-name field + verbalize catalog-picker selection"
```

---

### Task 4: Final verification

**Files:** None (verification only).

**Interfaces:** Depends on Tasks 1-3 all committed.

- [ ] **Step 1: Full build**

Run: `swift build`
Expected: `Build complete!`

- [ ] **Step 2: Scripted coverage audit (not prose)**

```bash
cd /Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-purchasing/LariatNative
files=(
  PurchasingOrderGuideView VendorCompareView VendorLinkView
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
  echo "COVERAGE OK — all 3 files have at least one accessibility modifier"
else
  echo "COVERAGE VIOLATION — see MISSING lines above"
  exit 1
fi
```

Expected: `COVERAGE OK — all 3 files have at least one accessibility modifier`.

- [ ] **Step 3: Scope check (scripted)**

```bash
git fetch origin
base=$(git merge-base origin/main HEAD)
expected=$(cat <<'EOF'
LariatNative/Sources/LariatApp/PurchasingOrderGuideView.swift
LariatNative/Sources/LariatApp/VendorCompareView.swift
LariatNative/Sources/LariatApp/VendorLinkView.swift
EOF
)
actual=$(git diff --name-only "$base" -- LariatNative)
if diff <(echo "$expected" | sort) <(echo "$actual" | sort) > /tmp/h7a-phase2-purchasing-scope-diff.txt; then
  echo "SCOPE OK — exactly the expected 3 files changed under LariatNative/"
else
  echo "SCOPE VIOLATION:"
  cat /tmp/h7a-phase2-purchasing-scope-diff.txt
  exit 1
fi
```

Expected: `SCOPE OK — exactly the expected 3 files changed under LariatNative/`.

- [ ] **Step 4: Mandatory final whole-branch review**

Compare all 3 files' diffs side by side, not a re-review of each task individually.
Specifically check: does any task above nest a `Button` inside a `.accessibilityElement
(children: .combine)` block? Is `VendorLinkView`'s `.isSelected` idiom genuinely
consistent with `DatapackSearchView.swift:86`'s established pattern when both are read
together?

- [ ] **Step 5: Manual VoiceOver spot-check (documented, non-gating)**

Needs a real desktop session. Turn on VoiceOver (Cmd+F5), open all 3 boards from the
sidebar, and confirm the price-comparison table announces "cheaper" correctly, row
actions name their ingredient, and the catalog-picker announces "selected" for the
currently-picked row.

- [ ] **Step 6: Open PR**

```bash
git push -u origin feat/lariat-native-h7a-phase2-purchasing
gh pr create --base main --head feat/lariat-native-h7a-phase2-purchasing \
  --title "feat(native): H7a Phase 2 — VoiceOver labels for .purchasing tier" \
  --body "See docs/superpowers/specs/2026-07-05-lariat-native-h7a-phase2-purchasing-tier-design.md and docs/superpowers/plans/2026-07-05-lariat-native-h7a-phase2-purchasing-tier.md for full detail. 3 tasks (T1-T3), one commit per file, plus this T4 scripted verification + whole-branch review. PinEntrySheet.swift intentionally out of scope (shared across 19 files, nearly every tier) — deferred to its own follow-up task."
```

**Commit message:** none (verification only).

---

## Self-Review

**1. Spec coverage:** Goal (labels + verbalize the 2 confirmed color-only signals + 1
field-label gap across the 3 `.purchasing` files) ✓ — every file has its own task.
Non-goals (`PinEntrySheet`, other 8 tiers, `LariatModel` extraction, new dependency) —
no task violates any of these. Invariants — every touched interactive control now has a
label naming its target; both status-bearing elements relying on color/icon alone now
verbalize state (`offerText`'s "cheaper", `catalogPicker`'s `.isSelected`); no
interactive control is nested inside `.combine` in any task. Testing/acceptance — Task
4's scripted coverage + scope-diff checks mirror the established precedent exactly;
manual VoiceOver spot-check documented as non-gating; Dynamic-Type — spec states none
found in this tier, no task claims one.

**2. Placeholder scan:** No "TBD"/"add appropriate handling"/"similar to Task N"
language anywhere — every task shows complete before/after code for its file.

**3. Type consistency:** `VendorLinkView`'s `.isSelected` idiom matches the pre-existing
`DatapackSearchView.swift:86` pattern referenced in Task 3's header, not a new
invention — same ternary-to-empty-array shape. `VendorCompareView`'s `offerText`,
`rowActions`, and `singlesSection` each reference existing types/helpers
(`VendorOfferSnapshot`, `Self.reasonLabel`, `VendorCompareRow`, `formatDollars`) read
directly from the file during the audit, not invented. No task declares a duplicate
type or helper.
