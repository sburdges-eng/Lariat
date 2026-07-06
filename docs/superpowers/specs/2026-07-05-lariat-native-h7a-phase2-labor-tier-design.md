# LariatNative H7a Phase 2 — Labor tier: VoiceOver design

## Goal

Extend the VoiceOver accessibility pattern established in H7a Phase 1 (PR #430) and
continued in Phase 2's Cook, Purchasing, BEO, Inventory, FOH, and House tiers
(PR #432-437) to the 4 board views in the `.labor` `FeatureTier`.

## Non-goals

- `TileDegrade.swift` and `PinEntrySheet.swift` are out of scope — shared cross-tier
  components used by all 4 files, not tier-specific.
- No compute/compliance-math changes of any kind. This tier handles labor-law-sensitive
  data (certifications, HFWA sick-leave accrual, tip-pool distribution, wage notices) —
  all money/date math lives in `LariatModel` and is explicitly out of scope; this plan
  touches only View-layer accessibility.
- The remaining 3 tiers (shows, costing, manager) are separate future sub-projects.
- No extraction to `LariatModel`, no new dependency, no XCTest (none exists for
  `LariatApp` — `swift build` clean is the acceptance gate).
- No behavior change for a sighted user beyond the one necessary restructuring in
  `StaffCertsView.certRow` (below).

## Scope: 4 files

`StaffCertsView.swift`, `SickLeaveView.swift`, `TipPoolView.swift`,
`WageNoticeView.swift` — all under `LariatNative/Sources/LariatApp/`. Confirmed via
`LaborFeatures.swift`/`FeatureRegistry.swift` that this tier has exactly these 4 boards,
via grep that none is presented from another tier, and by full read that all 4 have
zero pre-existing accessibility modifiers.

## Pattern (fixed by precedent)

Same as Phase 1 / Cook / Purchasing / BEO / Inventory / FOH / House. This tier
introduces no new idiom.

## Confirmed real gaps

**One confirmed color-only signal**: `StaffCertsView.certRow`'s expiry tone
(muted/red/amber/green, from `LariatModel`'s `StaffCertCompute.tone`) is only partially
verbalized by the existing `metaLine`/`expiryText` helpers — "inactive" and "expired Nd
ago" are unambiguous in text, but the `days > 0` branch reads only "Nd left" whether
that falls inside the 30-day citation-risk window (amber) or is comfortably clear
(green). Fix adds a new `certRowAccessibilityLabel` helper that appends "renewal due
soon" only for the amber case — the one genuinely ambiguous tone, not a blanket
re-verbalization of every tone (the other three are already unambiguous in text).

**One necessary restructuring**: `StaffCertsView.certRow`'s "Retire" button currently
sits as a sibling of the name/badge/meta content inside one flat `VStack` — isolating
the read-only info into its own combined element (so the button stays a sibling, not a
descendant) requires wrapping the header `HStack` + meta `Text` in a new inner `VStack`,
matching the same vertical spacing (6pt) at both levels — layout-neutral, same pattern
as House tier's `GoldStarsView.recognitionRow` split.

**One confirmed button-naming gap**: `StaffCertsView`'s "Retire" button repeats
identically across every row with no per-worker disambiguation.

**One reading-order fix (not a color/label gap)**: `TipPoolView.kpi`'s 4 top tiles each
render as `Text(value)` then `Text(label)` — SwiftUI's default `.combine` concatenation
would read "value, label" (e.g. "$120.00, Total"), which is backwards from natural
phrasing. Fix adds an explicit `.accessibilityLabel("\(label): \(money(cents))")`
override so VoiceOver reads "Total: $120.00" — a readability choice, not a defect
correction.

**Everything else** is the familiar fragmented-row cleanup: `SickLeaveView.balanceRow`,
`TipPoolView`'s "By cook" and "Lines" rows, `WageNoticeView.noticeRow`. None of these
have a color-only signal — `SickLeaveView`'s "cap hit" badge and `WageNoticeView`'s
"needs new" badge both already spell out their condition in text; the color is
reinforcement only, matching the established `BarParView`/`WageNoticeView`-class
precedent from prior tiers.

## Dynamic-Type risk

**None found anywhere in this tier**, including in `TipPoolView` and `WageNoticeView`
despite both being money-heavy boards with dollar-amount columns — confirmed by reading
all 4 files in full; no fixed-width `Text` column exists anywhere. The only
`.frame(minWidth:, minHeight:)` hits are sheet-size floors, excluded per established
precedent.

## Complexity flags

- `StaffCertsView.swift`: single row type but the tier's only zone needing both a
  color-only-signal fix and a restructuring — moderate.
- `SickLeaveView.swift`, `WageNoticeView.swift`: single row type each, trivial trailing
  `.combine`.
- `TipPoolView.swift`: 3 zones (KPI tiles, "By cook" rows, "Lines" rows) — the most
  fix-sites in the tier, but each is small; one task, 2-3 steps, no split needed.

## Invariants

- The "Retire" button has an unambiguous label naming its target and remains a sibling
  of (never nested inside) the combined info element.
- The one genuinely ambiguous tone (`StaffCertsView`'s amber) is verbalized; the other
  three tones (muted/red/green-implicit) are already unambiguous in existing text and
  are not touched.
- No interactive control is ever nested inside a `.combine` block.
- `swift build` stays clean after every task; the final task's scripted audit confirms
  all 4 files gained accessibility modifiers and the branch's diff touches exactly these
  4 files under `LariatNative/`.

## Open questions

None outstanding — the one judgment call the audit flagged (whether `TipPoolView.kpi`
needs an explicit reading-order label or plain `.combine` suffices) is resolved above:
add the explicit label, since "value, label" reads backwards and a natural "label:
value" costs nothing extra.

## Testing / acceptance

Per-task: `swift build` clean. Final task: scripted coverage audit (4 files) + scope-diff
check (exactly these 4 files) + mandatory final whole-branch review, mirroring
established precedent. The whole-branch review for this tier should confirm
`StaffCertsView.certRow`'s restructuring keeps the "Retire" button a genuine sibling of
the combined info block (the same defect class Phase 1's `SdsView` shipped once), and
confirm the amber-only wording addition doesn't silently apply to the other three tones.
