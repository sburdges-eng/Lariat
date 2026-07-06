# LariatNative H7a Phase 2 — Purchasing tier: VoiceOver + Dynamic-Type design

## Goal

Extend the VoiceOver accessibility + Dynamic-Type pattern established in H7a Phase 1
(PR #430, merged) and continued in H7a Phase 2's Cook tier (PR #432, open) to the 3
board views in the `.purchasing` `FeatureTier`. Same mechanism, same acceptance bar,
same review discipline — a scope extension, not a redesign.

## Non-goals

- **`PinEntrySheet.swift`** is explicitly out of scope. A read-verified audit found it
  presented from 19 files spanning nearly every tier (Purchasing, Safety, Labor, Manager,
  BEO, FOH, Cook, and more) via the shared PIN-gate flow — an even wider sharing
  situation than Cook tier's `CookIdentityPicker.swift` (which was deferred for the same
  reason). It has one accessibility gap of its own (none currently — audited, found
  clean: single-purpose modal, self-explanatory Cancel/OK, `SecureField("PIN", …)`
  already carries its purpose) but touching it here would break the tier-scoped-diff
  verification this plan uses. Deferred to its own future cross-cutting task, same as
  `CookIdentityPicker`.
- The remaining 8 tiers (beo, inventory, foh, house, labor, shows, costing, manager) are
  separate future sub-projects, one PR each.
- No extraction of accessibility strings into `LariatModel` — inline in the View body,
  matching `SanitizerView.swift`'s house style.
- No new dependency (this codebase has exactly one, GRDB).
- No XCTest — `LariatApp` has no test target. Acceptance is `swift build` clean plus a
  scripted grep-based coverage + scope audit, exactly like Phase 1 and Cook tier.
- No behavior change for a sighted user — every change is additive, except the one
  necessary restructuring in `VendorCompareView.singlesSection` to keep the "Attach"
  button a sibling of the combined info block.

## Scope: 3 files

`PurchasingOrderGuideView.swift`, `VendorCompareView.swift`, `VendorLinkView.swift` —
all under `LariatNative/Sources/LariatApp/`. Confirmed via `PurchasingFeatures.swift` and
`FeatureRegistry.swift` that this tier has exactly these 3 registered boards, and via
grep that none of the 3 is presented from another tier's view.

Every file was read in full (not grep-sampled) before this design was written.

## Pattern (fixed by precedent, not re-derived here)

Same as Phase 1 / Cook tier:
1. Wrap a composite row/tile's **read-only** info in
   `.accessibilityElement(children: .combine)` + a hand-written `.accessibilityLabel(...)`
   verbalizing anything conveyed by color alone.
2. **Interactive controls stay siblings, never nested inside a `.combine` block.**
3. Give every action button a label that names its target.
4. Fixed-`width` `Text` columns are the only genuine Dynamic-Type risk category —
   `maxWidth` ceilings on `TextField`/`ScrollView` are not.
5. Where a "currently selected" state is conveyed by color/icon alone, reuse the
   established `.accessibilityAddTraits(condition ? [.isSelected] : [])` idiom already
   present at `DatapackSearchView.swift:86` and reused by Cook tier's
   `StationChecklistView.statusButton` — do not invent a new pattern.

## Confirmed real gaps

Two genuine **color/signal-only** gaps:

1. **`VendorCompareView.offerText`** — the cheaper-vendor price gets bold+green styling
   with no spoken equivalent; a VoiceOver user can't tell which side is the better deal.
2. **`VendorLinkView.catalogPicker`** — the "currently selected" catalog row is signaled
   by a checkmark icon + background tint only, no `.isSelected` trait.

One genuine **field-label** gap:

3. **`VendorLinkView`'s "Staple name" field** — the visible caption above the TextField
   is not wired to it; VoiceOver falls back to the placeholder ("Chicken Breast", an
   example value) as the field's spoken name instead of "Staple name".

Everything else is the familiar fragmented-multi-Text-stop pattern (info blocks not
combined, action buttons not naming their target) — no new gap category. One item
(`VendorCompareView`'s `attachSheet` `List` rows) is flagged as optional/soft insurance
only, matching Cook tier's precedent for Button-auto-flattening cases — not a confirmed
defect, included as cheap zero-risk insurance.

## Dynamic-Type risk

**None found in this tier**, including in `VendorCompareView`'s 6-column price-comparison
`Table` — specifically checked per this tier's stated risk area, and confirmed the
`Table`'s columns are all auto-sized, not fixed-pixel-width `Text`. The two `.frame`
ceiling hits in `VendorLinkView` (`maxWidth: 420` on a TextField, `maxHeight: 220` on a
ScrollView) are excluded per the same reasoning as Cook tier's `countField` precedent.

## Complexity flags

- **Moderate/multi-zone:** `VendorCompareView` — largest file, 3 required fixes
  (`offerText`, `rowActions`, `singlesSection`) + 1 optional insurance fix
  (`attachSheet`'s List rows).
- **Small:** `PurchasingOrderGuideView` (1 fix, `notesBadges` fragmentation only — the
  native `Table` already provides baseline row/column accessibility semantics for free)
  and `VendorLinkView` (2 fix sites, no new helper function needed).

## Invariants

- Every touched interactive control has an unambiguous label naming its target.
- Every status-bearing element relying on color alone now also verbalizes its state.
- No interactive control is ever nested inside a `.accessibilityElement(children:
  .combine)` block.
- `swift build` stays clean after every task; the final task's scripted audit confirms
  all 3 files gained at least one accessibility modifier and the branch's diff touches
  exactly this file list under `LariatNative/`.

## Open questions

None outstanding — the one recurring design decision (defer the shared cross-tier PIN
component) follows the `CookIdentityPicker` precedent directly and needs no fresh
deliberation.

## Testing / acceptance

Per-task: `swift build` clean (no test target exists for `LariatApp`). Final task: a
scripted grep-based coverage audit (all 3 files have ≥1 accessibility modifier) + a
scope-diff check (`git diff --name-only $(git merge-base origin/main HEAD)` matches
exactly these 3 files under `LariatNative/`) — mirroring Phase 1 and Cook tier verbatim.
A mandatory final whole-branch review happens after all 3 per-file tasks land, before
the PR is opened — the gate that has twice now caught the class of defect a per-task
review cannot see (Phase 1's `SdsView` nested-Link bug; this tier's own
`singlesSection`/`attachSheet` fixes get the same sibling-vs-nested scrutiny).
