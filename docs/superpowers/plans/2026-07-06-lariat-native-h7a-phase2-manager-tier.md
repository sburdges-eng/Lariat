# LariatNative H7a Phase 2 — Manager tier: VoiceOver labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VoiceOver labels, spell the raw issued temp-PIN as digits, hide the one
color-only alert dot, keep every action Button a sibling of its (new) combined info scope,
and fix the one confirmed Dynamic-Type risk, across the **9 Manager-tier board views** —
the 10th and final tier in the H7a Phase 2 sweep, and its highest-risk (money / PIN /
audit).

**Architecture:** Per-file, inline `.accessibilityElement(children: .combine)` +
`.accessibilityLabel(...)` matching `SanitizerView.swift`'s house pattern — no extraction
to `LariatModel`, no new types, no new dependency. Several rows need a layout-neutral
wrapper to isolate read-only info from a sibling interactive control; everything else is a
trailing modifier or a single `width:`→`minWidth:` swap. **Five of the nine files
(`TempPinsView`, `ManagerPinsView`, `ReceivingMatchesView`, `PerformanceReviewsView`,
`PackChangesView`) front PIN-gated audited write paths** — every fix in those files touches
only the View's accessibility metadata, never the write/validation/audit logic in their
`*ViewModel` / `LariatDB` repository layer.

**Tech Stack:** SwiftUI (macOS), no new packages. Swift Charts is already a dependency
(used by `AnalyticsView.swift`) — not newly introduced, and not extended (charts are left
as a known VoiceOver limitation, see spec).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-06-lariat-native-h7a-phase2-manager-tier-design.md`.
- No new dependency (this codebase has exactly one — GRDB — today).
- No extraction of accessibility-label strings into `LariatModel` — inline in the View
  body, matching `SanitizerView.swift`.
- **No `LariatModel` / `LariatDB` / compute / write / validation / audit changes of any
  kind.** For the five write-fronting views, the write/validation/audit/
  `actor_source=native_mac` logic lives in their `*ViewModel` / repository layer — this
  plan touches only the View struct's accessibility metadata (including the label on the
  Button that triggers the write). Some ViewModels are declared *inside* their View file
  (as `DishComponentsViewModel` was in the Costing tier) — where that is the case, the
  per-task scope guard (commit touches exactly one file, and the changed hunks stay inside
  the `View` struct) is what enforces "write logic untouched"; locate the `// MARK: - …
  view` boundary before editing.
- **No interactive control (`Button`/`Link`/`Picker`/`Menu`/`.onTapGesture`) is ever placed
  inside `.accessibilityElement(children: .combine)`** — it drops the tap (Phase-1 defect
  A, the SdsView regression). Every structural task below exists because of exactly this.
- No XCTest is possible for this work — `LariatApp` has no test target. Acceptance per task
  is `swift build` clean. The final task runs a scripted coverage + scope audit.
- **Shared components are out of scope** — do not touch `TileDegrade.swift`,
  `EmptyState.swift`, `PinEntrySheet.swift`, `CommandPalette.swift`, `DesignTokens.swift`.
  (`StaleDataBanner`, defined inside `CommandView.swift`, IS in scope — it is manager-local,
  used only by the 3 rollup boards.) The `CommandPalette.swift:149` `.onTapGesture`-on-a-
  `.combine`d-row defect is a **shell/H3** issue and is surfaced to the shell owner as a
  recommendation, NOT fixed in this wave.
- **Do NOT re-touch already-correct labels:** `CommandView.swift:460` (`CommandTile` tone
  dot, already `.accessibilityLabel(toneLabel)`), `ManagementRollupView.swift:225` (`Tile`
  severity dot, already labeled), `EmptyState`'s existing `.combine`.
- **Line ranges below are locators from the pre-implementation audit, not guaranteed
  exact** — the audit read all 9 files in full and 2 (`TempPinsView`, `AuditLogView`) were
  re-read by the lead, but if a file has drifted, locate the named struct/function by name.
- **Strictly additive discipline:** a prior task in this sweep (Cook tier's T4) deleted 2
  pre-existing comments as a side effect of "matching the brief." Every task below must
  preserve every pre-existing comment/line not directly touched by its named fix.
- **This plan does NOT reproduce full verbatim view code** (unlike some earlier tiers) —
  deliberately, per the Phase-1 §3-item-3 lesson that embedding un-re-read code into a plan
  a subagent implements verbatim caused a wrong fix. Each task names the struct, the exact
  combine boundary (by line locator + what it wraps vs. excludes), and the exact modifier /
  label wording; the implementer **reads the actual file and applies** the additive change.
- **Commit tooling note:** the MACP file-claim guardrail
  (`scripts/check-session-branch.mjs`) defaults to committer `"gemini"` unless `AGENT_NAME`
  is set. Every commit step MUST run with `AGENT_NAME=claude`, e.g.
  `AGENT_NAME=claude git commit -m "..."`.
- **Task ordering:** simplest/mechanical first (`AnalyticsView`), most-sensitive last
  (`TempPinsView`, the raw-PIN file), then the mandatory whole-branch review — mirroring
  every precedent tier (Costing ended on `CostingView`).
- Worktree path for every `swift build`/git command:
  build → `/Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-manager/LariatNative`;
  git → the worktree root
  `/Users/seanburdges/Dev/hospitality/Lariat-worktrees/claude-lariat-native-h7a-phase2-manager`
  (operating on `LariatNative/...` paths).

### Per-task scope guard (used by every task)

After the build, before the commit, confirm the staged change touches exactly the one
intended View file:

```bash
git add LariatNative/Sources/LariatApp/<ThisView>.swift
test "$(git diff --cached --name-only)" = "LariatNative/Sources/LariatApp/<ThisView>.swift" \
  && echo "SCOPE OK — exactly <ThisView>.swift staged" \
  || { echo "SCOPE VIOLATION — unexpected files staged; investigate before committing"; git diff --cached --name-only; exit 1; }
```

For the five write-fronting views (T4, T6, T7, T8, T9) this same one-file assertion is the
guarantee that no `*ViewModel` / repository write logic changed — the task notes call it
out explicitly for reviewer emphasis.

---

### Task 1: `AnalyticsView.swift`  — RISK: LOW (mechanical)

**paths_touched:** `LariatNative/Sources/LariatApp/AnalyticsView.swift`
**MUST NOT modify:** any other file; the chart bodies (`:219-444`) beyond leaving them as-is;
`AnalyticsViewModel`.

Fixes:
1. **Dynamic-Type (the tier's only one):** `:474` `.frame(width: 20, alignment: .trailing)`
   on the rank-number `Text("\(idx+1)")` → `.frame(minWidth: 20, alignment: .trailing)`.
2. **Combine** the KPI cards (`:127-215`) and each top-items row so each reads as one
   VoiceOver stop; add labels only where a value's meaning isn't already preceded by its
   label text (most are — keep additions minimal).
3. **Leave charts (`:219-444`) untouched** — each already carries a text `.chartLegend`;
   Swift Charts VoiceOver is a known limitation (spec). The YoY delta (`:147-156`) is
   symbol/text-backed — no tone word.

- [ ] Read the file; apply the `minWidth` swap + trailing combines above.
- [ ] Build: `cd <worktree>/LariatNative && swift build` → `Build complete!`
- [ ] Scope guard (above) for `AnalyticsView.swift`.
- [ ] Commit: `AGENT_NAME=claude git commit -m "T1: AnalyticsView — fix rank-column Dynamic-Type, combine KPI/top-items rows"`

---

### Task 2: `ManagementRollupView.swift`  — RISK: LOW-MODERATE (mechanical)

**paths_touched:** `LariatNative/Sources/LariatApp/ManagementRollupView.swift`
**MUST NOT modify:** the already-correct severity-dot label at `:225`; `PackChangesView.swift`
(reached via the `:152-154` NavigationLink — that is Task 7); any ViewModel.

Fixes:
1. **Combine** each `Tile` (`:219-234`) so its dot-label + title + value + sub read as one
   stop. The `Tile` has **no interactive child**, so the combine is safe even where a
   `Tile` sits inside a `NavigationLink` (`:151-162`) — keep the combine **inside the tile
   body**, never wrapping the `NavigationLink`.
2. Money variance figures (`:193-199`) render as text — no color-word needed.
3. **Do NOT re-touch** the `:225` dot label.

- [ ] Read; apply per-`Tile` combine.
- [ ] Build → `Build complete!`
- [ ] Scope guard for `ManagementRollupView.swift`.
- [ ] Commit: `AGENT_NAME=claude git commit -m "T2: ManagementRollupView — combine rollup tiles (dot label unchanged)"`

---

### Task 3: `CommandView.swift`  — RISK: MODERATE (mechanical; the one color-only dot)

**paths_touched:** `LariatNative/Sources/LariatApp/CommandView.swift`
**MUST NOT modify:** the already-correct `CommandTile` tone-dot label at `:460`;
`PerformanceReviewsView.swift` (reached via the `:305-307` NavigationLink — that is Task 4);
`CommandViewModel`.

Fixes:
1. **Color-only fix:** `AlertRow`'s bare severity dot (`:418-420`,
   `Circle().fill(color).frame(width: 8, height: 8)`) → add `.accessibilityHidden(true)`.
   The severity is already spoken by the `"Critical"`/`"Warnings"` section headers
   (`:374`/`:390`); the bare dot is a meaningless focus stop. (Alternatively combine the
   `AlertRow` and label it — but hiding the decorative dot is the minimal correct fix.)
2. **Combine** `StaleDataBanner` (`:150-167`, icon + text) — manager-local, in scope.
3. Signal tiles (`:235-356`) are `Button`/`NavigationLink` whose child labels SwiftUI
   already flattens (money `formatDollars` + `TileLine` text are spoken) — verbose but not
   broken; leave unless a tile has an unlabeled icon-only affordance (check while reading).
4. **Do NOT re-touch** the `:460` label. The `:420`/`:459` 8×8 frames are decorative, NOT
   Dynamic-Type hazards — do not `minWidth` them.

- [ ] Read; hide the alert dot, combine `StaleDataBanner`.
- [ ] Build → `Build complete!`
- [ ] Scope guard for `CommandView.swift`.
- [ ] Commit: `AGENT_NAME=claude git commit -m "T3: CommandView — hide decorative alert dot, combine StaleDataBanner"`

---

### Task 4: `PerformanceReviewsView.swift`  — RISK: MODERATE-HIGH (mechanical; DISCOVERED write board)

**paths_touched:** `LariatNative/Sources/LariatApp/PerformanceReviewsView.swift`
**MUST NOT modify:** `PerformanceReviewsViewModel` / repository (PIN-gated audited labor
write — untouched); any other file.

This board is unregistered (reached only from `CommandView.swift:305-307`) and has zero
accessibility today. It is a **write surface** — accessibility metadata only.

Fixes:
1. **Combine** the info-only list row (`:149-166`) — it has **no interactive control
   inside the row**, so a plain trailing `.combine` (+ a custom label if the default
   concatenation order is awkward) is safe.
2. Classification tag (`:155-157`) is text-backed — no color word. Steppers (`:184-186`)
   are already labeled (`"On time: 3"` etc.) — leave. Sheet `.frame(minWidth:…)` (`:210`)
   already uses `min` — leave.

- [ ] Read; combine the row.
- [ ] Build → `Build complete!`
- [ ] Scope guard for `PerformanceReviewsView.swift` — **this one-file assertion confirms
  `PerformanceReviewsViewModel`/repository are untouched.**
- [ ] Commit: `AGENT_NAME=claude git commit -m "T4: PerformanceReviewsView — combine review row (write logic untouched)"`

---

### Task 5: `AuditLogView.swift`  — RISK: MODERATE (structural — combine-around-a-Button)

**paths_touched:** `LariatNative/Sources/LariatApp/AuditLogView.swift`
**MUST NOT modify:** `AuditLogViewModel` (read-only board by construction — keep it so);
any other file.

Fix (read-confirmed by the lead): in `logList`'s row (`:66-95`), wrap the metadata —
`action` chip (`:69-73`), `slug` (`:75`), optional `user` (`:78-80`), `Spacer`, and
timestamp (`:84-86`) — in a combine scope, and **keep the `Show`/`Hide` `Button` (`:89`) a
sibling outside that scope.** Do not combine the whole `HStack` (that would nest the
button). The expanded changes block (`:97-110`) can get its own plain combine per change
row if useful. The amber action chip is text-backed; there are no red rows — no color word.

- [ ] Read; combine metadata only, keep the Show button a sibling.
- [ ] Build → `Build complete!`
- [ ] Scope guard for `AuditLogView.swift`.
- [ ] Commit: `AGENT_NAME=claude git commit -m "T5: AuditLogView — combine row metadata, keep Show/Hide button a sibling"`

---

### Task 6: `ReceivingMatchesView.swift`  — RISK: MODERATE-HIGH (structural; write board)

**paths_touched:** `LariatNative/Sources/LariatApp/ReceivingMatchesView.swift`
**MUST NOT modify:** `ReceivingMatchesViewModel` / repository (PIN-gated audited resolve —
untouched); any other file.

Fix: in `matchRow`, the top **info `HStack` (`:73-95`)** — vendor/invoice/item/sku, the
qty text (`:85`), reason chip (`:86-91`), created-at — is combine-safe; wrap it in a
combine scope. The **action `HStack` (`:97-119`)** — the `Picker` (`:98`) + `Set master`
`Button` (`:109`) — **stays uncombined** (both are interactive). Verify while reading that
`qtyText` (`:85`) already carries its unit; if not, the label should include it. Reason
chip is text-backed — no color word.

- [ ] Read; combine the info HStack, leave the action HStack uncombined.
- [ ] Build → `Build complete!`
- [ ] Scope guard for `ReceivingMatchesView.swift` — **confirms VM/repository untouched.**
- [ ] Commit: `AGENT_NAME=claude git commit -m "T6: ReceivingMatchesView — combine info row, keep picker+Set-master action controls siblings"`

---

### Task 7: `PackChangesView.swift`  — RISK: HIGH (structural; DISCOVERED write board)

**paths_touched:** `LariatNative/Sources/LariatApp/PackChangesView.swift`
**MUST NOT modify:** `PackChangesViewModel` / repository (PIN-gated audited pack/unit ack —
untouched); any other file.

Unregistered (reached only from `ManagementRollupView.swift:152-154`), zero accessibility
today, a **write surface** — metadata only.

Fix: in the list row (`:147-165`), wrap the **info `VStack` (`:149-157`)** —
`vendor · sku`, the `prevPack → newPack` transition (`:151`), ingredient — in a combine
scope, and **keep the `Give OK` `Button` (`:160`) a sibling.** Optional (low-confidence,
droppable): add `.accessibilityLabel("changed from <prev> to <new>")` on the `:151`
transition `Text` so VoiceOver doesn't read `→` as "right arrow"; keep only the combine if
judged unnecessary. Segmented `Show` Picker (`:133`) is already titled — leave.

- [ ] Read; combine the info VStack, keep `Give OK` a sibling.
- [ ] Build → `Build complete!`
- [ ] Scope guard for `PackChangesView.swift` — **confirms VM/repository untouched.**
- [ ] Commit: `AGENT_NAME=claude git commit -m "T7: PackChangesView — combine change row, keep Give-OK button a sibling (write logic untouched)"`

---

### Task 8: `ManagerPinsView.swift`  — RISK: HIGH (structural; PIN credential CRUD)

**paths_touched:** `LariatNative/Sources/LariatApp/ManagerPinsView.swift`
**MUST NOT modify:** `ManagerPinsViewModel` / repository (PIN create/disable write —
untouched); any other file.

Fix: in `userRow` (`:73-97`), wrap the **name + role + Active/Off badge lead** in a combine
scope, and **keep both `Edit` (`:90`) and `Disable` (`:93`) `Button`s siblings** outside it.
The Active/Off badge (`:81-89`) is `Text("Active"/"Off")` + color — **text-backed, not
color-only; do not add a color word.** SecureFields (`:45`, `:109`), role `Picker`, and
`Active` `Toggle` are already labeled — leave. There is no custom PIN keypad (it's a
`SecureField`), so there are no keypad keys to label.

- [ ] Read; combine the identity lead, keep Edit/Disable siblings.
- [ ] Build → `Build complete!`
- [ ] Scope guard for `ManagerPinsView.swift` — **confirms VM/repository untouched.**
- [ ] Commit: `AGENT_NAME=claude git commit -m "T8: ManagerPinsView — combine user identity lead, keep Edit/Disable buttons siblings"`

---

### Task 9: `TempPinsView.swift`  — RISK: HIGHEST (structural; raw PIN secret + issuance/revocation)

**paths_touched:** `LariatNative/Sources/LariatApp/TempPinsView.swift`
**MUST NOT modify:** `TempPinsViewModel` / repository (PIN issue/revoke write, scoped —
untouched); any other file.

Two fixes (both read-confirmed by the lead):
1. **MARQUEE FIX — spell the PIN as digits.** `issuedBanner`'s `Text(issued.pin)` (`:96-98`,
   34pt monospaced) is read by VoiceOver as a cardinal number ("four thousand…"). Add
   `.accessibilityLabel("PIN " + issued.pin.map(String.init).joined(separator: " "))` so it
   reads "PIN 4 8 2 1". (Equivalent alternative: apply `.speechSpellsOutCharacters()` to
   that `Text` — the space-joined label is the safe default.) Leave `.textSelection(.enabled)`
   and the banner header/`Done` button unchanged.
2. **Combine-around-a-Button.** In the active-PIN row (`:64-79`), wrap the info — `label`
   (`:67`), `scopes` (`:68-70`), `expires` (`:73-75`) — in a combine scope, and **keep the
   `Revoke` destructive `Button` (`:76`) a sibling** outside it. Do not combine the whole
   `HStack`.

The issued banner's `Done` button (`:102`) is already a standalone sibling — leave it.

- [ ] Read; add the digit-spell PIN label; combine active-row info, keep `Revoke` a sibling.
- [ ] Build → `Build complete!`
- [ ] Scope guard for `TempPinsView.swift` — **confirms VM/repository untouched.**
- [ ] Commit: `AGENT_NAME=claude git commit -m "T9: TempPinsView — spell issued PIN as digits for VoiceOver, combine active-row info keeping Revoke a sibling"`

---

### Task 10: Final whole-branch review + coverage/scope audit (MANDATORY GATE)

Not a formality — Phase 1's SdsView regression (12 files right, 1 wrong) was only catchable
by diffing the tier as a set. Steps:

- [ ] **Coverage audit:** confirm all 9 files gained `.accessibility*` modifiers:
  ```bash
  cd <worktree>
  for f in AnalyticsView ManagementRollupView CommandView PerformanceReviewsView \
           AuditLogView ReceivingMatchesView PackChangesView ManagerPinsView TempPinsView; do
    n=$(grep -c 'accessibility' "LariatNative/Sources/LariatApp/$f.swift"); echo "$f: $n"
  done
  ```
  Expected: every file ≥ 1 (most > 1). Investigate any `0`.
- [ ] **Scope-diff:** confirm the branch touched exactly these 9 view files + the 2 planning
  docs, nothing else, and no `LariatModel`/`LariatDB` file:
  ```bash
  git diff --name-only $(git merge-base origin/main HEAD)..HEAD
  ```
  Expected: the 9 `LariatNative/Sources/LariatApp/*.swift` + the SPEC + this PLAN. **Zero**
  `LariatModel`/`LariatDB` paths — this is the "write logic untouched" proof for all five
  write-fronting views at once.
- [ ] **Whole-branch review** (dispatch `reviewer`, Opus tier per the guide — money/PIN/audit):
  compare all 9 files side-by-side and confirm, as a set:
  (a) **no interactive control is nested inside any `.combine`** — every action Button
  (Revoke / Edit / Disable / Give-OK / Set-master / Show-Hide) is a genuine sibling;
  (b) the temp-PIN reads as digits;
  (c) no already-correct label (`CommandView:460`, `ManagementRollupView:225`) was
  disturbed and no pre-existing comment was dropped;
  (d) the one color-only dot is hidden and the one `minWidth` swap landed;
  (e) `swift build` is clean.
- [ ] Address any finding as its own fix commit (do not weaken the audit; re-review if a
  structural row changed).

## Acceptance

`swift build` clean after every task; the T10 coverage audit shows all 9 files covered;
the T10 scope-diff shows exactly the 9 views + 2 docs and zero model/DB changes; the
whole-branch review passes. Manual VoiceOver spot-check (non-gating, no XCTest target for
`LariatApp`) is flagged in the PR body as open — specifically worth confirming the issued
temp-PIN reads digit-by-digit and the `Revoke`/`Show`/`Edit` buttons remain double-tap-
activatable — whenever someone has a real desktop session. On merge, refresh and merge the
open H6/H7 handoff doc (PR #429) to reflect Phase 2 complete.
