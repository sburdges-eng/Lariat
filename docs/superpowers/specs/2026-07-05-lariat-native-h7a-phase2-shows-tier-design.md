# LariatNative H7a Phase 2 — Shows tier: VoiceOver + Dynamic-Type design

## Goal

Extend the VoiceOver accessibility + Dynamic-Type pattern established in H7a Phase 1
(PR #430) and continued in Phase 2's Cook, Purchasing, BEO, Inventory, FOH, House, and
Labor tiers (PR #432-438) to the 7 board views in the `.shows` `FeatureTier`, plus one
shared-within-tier support file.

## Non-goals

- `TileDegrade.swift`, `EmptyState.swift`, `CookIdentityPicker.swift`, `PinEntrySheet.swift`
  are out of scope — shared cross-tier/app-wide components.
- No `LariatModel`/compute or `ShowSettlementViewModel` write-logic changes of any kind.
  `ShowSettlementView.swift` in particular has money-critical settlement math starting at
  line ~279 — this plan touches only the `View` struct (lines ~17-277).
- The remaining 2 tiers (costing, manager) are separate future sub-projects.
- No extraction to `LariatModel`, no new dependency, no XCTest (none exists for
  `LariatApp` — `swift build` clean is the acceptance gate).
- No behavior change for a sighted user beyond the necessary restructurings noted below.

## Scope: 7 board files + 1 shared-within-tier support file

`ShowsTonightView.swift`, `ShowPlaybookView.swift`, `ShowBoxOfficeView.swift`,
`ShowSettlementView.swift`, `ShowSoundView.swift`, `ShowStageView.swift`,
`ShowsArchiveView.swift`, and `ShowsBoardSupport.swift` — all under
`LariatNative/Sources/LariatApp/`. Confirmed via `ShowsFeatures.swift`/
`FeatureRegistry.swift` that the tier has exactly these 7 boards, and via grep that none
is presented from another tier.

**`ShowsBoardSupport.swift` is shared *within* this tier only** (`ShowsGateModel`,
`ShowsGatedBoard`, `ShowPickerModel`, `ShowPickerRow` — used by all 8 files audited, no
cross-tier consumer, confirmed via grep). This is the same situation as BEO tier's
`BeoFireStationSection`: fixing the one genuine gap in it (`ShowsLockedView`'s
icon/title/subtitle fragmentation + Button restructuring) benefits every shows-tier
board's PIN-locked state, not a deferral like `CookIdentityPicker`/`PinEntrySheet`.

**`ShowSoundView.swift` already has one pre-existing modifier**:
`.accessibilityLabel("SPL sparkline")` on the sparkline `ZStack`, covering only the
decorative trend-line drawing — must remain byte-for-byte unchanged.

## Pattern (fixed by precedent)

Same as Phase 1 / Cook / Purchasing / BEO / Inventory / FOH / House / Labor. This tier
introduces no new idiom, but has the widest variety of gap types seen in one tier so far:
reading-order fixes (5 separate `kpi`-style helpers across 3 files), restructurings (3
separate zones across 3 files), a genuine `TextEditor`-specific labeling gap (no title
parameter exists for `TextEditor`, unlike `TextField`), and the tier's first confirmed
color-only signal tied to a *threshold* (SPL near/over a configured limit) rather than a
simple binary state.

## Confirmed real gaps

**Reading-order fixes** (default `.combine` reads "value, label" backwards) — the same
class fixed in Labor tier's `TipPoolView.kpi`, appearing 3 more times in this tier:
`ShowsTonightView.kpi` (used by `boxOfficeSection`'s 4 tiles), `ShowsTonightView`'s
pipeline-stage tiles (a second, separate `VStack` shape, not the same helper),
`ShowBoxOfficeView.kpi` (5 tiles), `ShowSoundView.kpi` (5 tiles).

**Color-only signals**, verified against `LariatModel` compute code (not assumed):
- `ShowPlaybookView.statusPillRow` — verified in `ShowStatusCompute.swift:54`: the
  `.neutral` badge always renders the literal label `"—"`, a genuinely information-free
  em dash. Red/amber/green badges already show the raw spreadsheet token as text
  (verbatim by design, per the compute file's own doc comment on tolerating "novel
  vocabulary") — only `.neutral` needs an added word ("not set"), the other three must
  NOT be reinterpreted.
- `ShowSoundView`'s "latest" SPL tile — verified against
  `SplTelemetryCompute.splThresholdStatus`: green/unset already read unambiguously via
  the bare dB value or "—"; only amber (near limit) and red (over limit) are genuinely
  ambiguous from the number alone and get an added word ("near limit"/"over limit").
- `ShowStageView.completenessSection`'s `flag(_:_:)` tiles — icon shape + color is the
  *only* signal of on/off completeness state; the section's overall %-complete number is
  reinforcement only, but each individual flag tile has no text at all indicating its
  state — genuine gap, needs "{label}: complete"/"{label}: incomplete".

**Verified NOT color-only** (reinforcement only, explicitly checked against compute, not
assumed): `ShowsTonightView.attendanceSection`'s scanned/pct tint (status word already
displayed as text per `ShowsTonightCompute`), `ShowBoxOfficeView`'s completeness-percent
tint (the percentage itself, derived from a 3-milestone score, already discloses
complete-vs-not), `ShowSettlementView.netDoorSection`'s negative-red tint (the dollar
formatter already prepends an explicit "-" sign, which VoiceOver reads aloud).

**Restructurings needed** (interactive control must become a sibling of a new combined
info block, matching the `StaffCertsView.certRow`/`GoldStarsView.recognitionRow`
precedent):
- `ShowsBoardSupport.ShowsLockedView` — icon+title+subtitle wrapped, "Unlock" Button kept
  as sibling. Benefits all 8 shows-tier files.
- `ShowBoxOfficeView.lineRow` — info wrapped, scan-state icon/Button kept as sibling.
- `ShowSoundView.scenesSection`'s row — info wrapped, delete Button kept as sibling.
- `ShowStageView.runOfShowSection`'s row — info wrapped (3 TextFields), delete Button
  kept as sibling.
- **`ShowSettlementView.netDoorSection` is a different, narrower case**: two bare `Text`
  siblings directly inside a `Section` (no wrapping container exists today, no
  interactive control involved) — wrapping them in a `VStack` merges what were 2
  separate List rows into 1. This is flagged explicitly as the one place in this tier
  where a fix changes List row count, not just accessibility metadata; still additive in
  spirit (no information lost, same content) but noted for the whole-branch review.

**Button-naming gaps** (identical label repeated per row): `ShowBoxOfficeView.lineRow`'s
"Scan" button, `ShowSoundView.scenesSection`'s trash button, `ShowStageView.
runOfShowSection`'s trash button, `ShowSettlementView`'s deal-editor cost-row `TextField`
+ trash button (both need per-row disambiguation).

**`TextEditor`-specific gap**: `ShowStageView.ridersSection`'s two `TextEditor`s have no
title parameter at all (unlike `TextField`, which at least gets its placeholder as a
fallback name) — both need an explicit `.accessibilityLabel`.

**Shared-helper leverage**: `ShowPlaybookView.statusPillRow` is one function behind 14
checklist-field call sites across 4 tabs — fixing it once covers all 14.
`ShowSettlementView.moneyRow`/`plainRow` are two functions behind ~14 more call sites
across 4 sections — fixing them once (pure `.combine`, no label override needed since
label already precedes value) covers all of those too.

**Everything else** is the familiar fragmented-row cleanup across the remaining zones in
each file (see the implementation plan for the full per-file breakdown).

## Dynamic-Type risk

**Two confirmed fixed-width `Text` columns**, both in dense multi-column rows:
- `ShowsTonightView.runOfShowSection`'s time column (`width: 90`).
- `ShowsTonightView.pipelineSection`'s upcoming-show date column (`width: 100`).
- `ShowsArchiveView`'s row date column (`width: 100`).

That's three, all in `ShowsTonightView.swift` (2) and `ShowsArchiveView.swift` (1).

**Two borderline, explicitly NOT-confirmed cases**, flagged for awareness only, not
fixed in this plan: `ShowSettlementView`'s deal-editor cost `TextField(width: 100)` and
`ShowStageView`'s run-of-show time `TextField(width: 90)` — both are fixed-width
`TextField`s (input controls that scroll their content), not `Text` display columns, so
neither meets the established risk bar from prior tiers (`InventoryCountsView`'s
`countField` precedent). Left untouched.

## Complexity flags

- **`ShowsTonightView.swift`**: largest and most complex file in the tier — 7 fix zones
  across 6 `@ViewBuilder` functions + 1 shared `kpi` helper, plus both of this file's
  Dynamic-Type fixes. Split into 2 sub-steps within one task (headline/attendance/
  boxOffice+kpi, then runOfShow/stageSound/pipeline), mirroring Cook tier's `PrepView`
  and BEO tier's per-task multi-step shape.
- **`ShowSettlementView.swift`**: 454 lines, money-critical, but the fix surface is 5
  shallow largely-additive zones (2 of them single-helper fixes covering ~14 call sites
  each) — one task, but with a MANDATORY extra verification step confirming zero lines
  in `ShowSettlementViewModel` (the compute/write logic) were touched.
- **`ShowBoxOfficeView.swift`, `ShowSoundView.swift`, `ShowStageView.swift`**: moderate,
  one task each, 2-3 zones including one restructuring apiece.
- **`ShowPlaybookView.swift`**: 3 zones but only 1 shared helper touched for the 14-site
  leverage — one task.
- **`ShowsArchiveView.swift`, `ShowsBoardSupport.swift`**: trivial, one task each.

**`ShowStageView.swift` was bonus-audited** (not originally in either audit dispatch's
required scope) — its findings are read-derived, not speculative, but received one pass
rather than the cross-checked-against-compute rigor given to the other 6 files. The
implementer and reviewer for this file should re-verify each finding against the current
source before implementing, same discipline as any other task, with slightly less
inherited confidence than the other 6 files' audits.

## Invariants

- Every touched interactive control has an unambiguous label naming its target.
- Every genuinely ambiguous color-only signal is verbalized; reinforcement-only color is
  explicitly left untouched in every case identified above.
- No interactive control is ever nested inside a `.combine` block.
- `ShowSoundView`'s pre-existing `.accessibilityLabel("SPL sparkline")` remains
  byte-for-byte unchanged.
- `ShowSettlementViewModel` (and all other `LariatModel`/compute code) is untouched.
- `swift build` stays clean after every task; the final task's scripted audit confirms
  all 8 files gained accessibility modifiers and the branch's diff touches exactly these
  8 files under `LariatNative/`.

## Open questions

None outstanding.

## Testing / acceptance

Per-task: `swift build` clean. Final task: scripted coverage audit (8 files) + scope-diff
check (exactly these 8 files) + mandatory final whole-branch review, mirroring
established precedent. Given this tier's size and the money-critical
`ShowSettlementView`, the whole-branch review should specifically: (1) confirm all 4
restructured zones keep their interactive control a genuine sibling, never nested inside
`.combine`; (2) confirm `ShowSettlementViewModel` shows zero diff; (3) confirm the
`.neutral`-only and amber/red-only wording additions don't leak to other cases; (4)
re-verify `ShowStageView`'s findings against current source given its lighter audit pass.
