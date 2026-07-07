# LariatNative H7a Phase 2 — Manager tier: VoiceOver + Dynamic-Type design

## Goal

Extend the VoiceOver accessibility + Dynamic-Type pattern established in H7a Phase 1
(PR #430) and continued across Phase 2's Cook, Purchasing, BEO, Inventory, FOH, House,
Labor, Shows, and Costing tiers (PR #432–440) to the **Manager tier — the 10th and final
tier in the H7a Phase 2 sweep**. This tier fronts the app's money/PIN/audit surfaces
(scoped temp-PIN issuance, manager-PIN credential CRUD, pack-change acknowledgement,
performance-review writes, receiving-match resolution, and the audit-log trail), so it is
the highest-risk tier of the sweep even though the accessibility work itself is the same
strictly-additive `.accessibilityElement(children: .combine)` / `.accessibilityLabel(...)`
pattern used everywhere else. No new idiom is introduced.

## Scope: 9 files

The 7 boards registered in `ManagerFeatures.swift`:

- `CommandView.swift` (`manager.command`)
- `AnalyticsView.swift` (`manager.analytics`)
- `ManagementRollupView.swift` (`manager.management`)
- `AuditLogView.swift` (`manager.auditLog`)
- `ManagerPinsView.swift` (`manager.pins`)
- `TempPinsView.swift` (`manager.tempPins`)
- `ReceivingMatchesView.swift` (`manager.receivingMatches`)

Plus **2 unregistered write boards the audit discovered**, reachable *only* through
NavigationLinks inside Manager-tier views and owned by **no** `FeatureTier`:

- `PerformanceReviewsView.swift` — mounted from `CommandView.swift:305-307` (the Command
  labor tile). PIN-gated audited labor write.
- `PackChangesView.swift` — mounted from `ManagementRollupView.swift:152-154` (rollup
  tile 6). PIN-gated audited pack/unit acknowledgement.

Both were confirmed absent from every `*Features.swift` registration and untouched by the
Labor (#438) and Costing (#440) Phase-2 merges, and both carry **zero** `.accessibility*`
modifiers today. Because no tier owns them, they were skipped by the tier-by-registration
sweep and will never be covered unless swept here. **Decision (owner-approved): include
all 9.** All files live under `LariatNative/Sources/LariatApp/`.

## Non-goals

- **No `LariatModel` / `LariatDB` / compute / write / validation / audit changes of any
  kind.** Five of these nine views front regulated PIN-gated audited writes
  (`TempPinsView`, `ManagerPinsView`, `ReceivingMatchesView`, `PerformanceReviewsView`,
  `PackChangesView`); their write/validation/audit/`actor_source=native_mac` logic lives
  entirely in their `*ViewModel` / `LariatDB` repository layer. This tier touches only the
  Views' accessibility metadata — including the accessibility label on the one Button that
  triggers each write — never the write itself.
- **Shared components are out of scope** — `TileDegrade.swift`, `EmptyState.swift`,
  `PinEntrySheet.swift`, `CommandPalette.swift`, `DesignTokens.swift`. See "Shared
  components — deferred" below for the per-component reasoning and one flagged cross-tier
  defect that is explicitly *not* fixed here.
- No extraction to `LariatModel`, no new dependency (this codebase has exactly one — GRDB),
  no XCTest (none exists for `LariatApp`; `swift build` clean is the acceptance gate).
- No behavior change for a sighted user beyond the layout-neutral `HStack`/`VStack`
  wrappers noted per-file below (each preserves existing spacing/alignment).
- No chart audiographs. `AnalyticsView`'s Swift Charts series rely on color, but each
  chart already carries a text `.chartLegend`; Swift Charts' intrinsic VoiceOver
  limitation is beyond the Phase-1 label/combine idiom and is left as a known limitation.
- The `CommandPalette` shell defect (below) is **not** fixed here — it is a shell/H3
  component, out of this tier; it is surfaced as a recommendation only.

## Pattern (fixed by precedent)

Identical to Phase 1 / every Phase-2 tier: inline `.accessibilityElement(children:
.combine)` + `.accessibilityLabel(...)` in `SanitizerView.swift`'s house style. The two
recurring shapes on this tier:

1. **Combine-around-a-Button** (the dominant shape here). Five rows mix a destructive or
   action Button into the same `HStack` as their read-only info. The fix wraps *only the
   read-only info* in a combine scope and keeps the Button a genuine sibling — never nested
   inside `.combine`, because `.combine` merges child labels but drops a child's tap
   action (Phase-1 "defect A", the SdsView regression). Every structural task on this tier
   exists because of exactly this.
2. **Single additive label / hidden decorative element** — the temp-PIN digit-spell label,
   the one color-only alert dot, and the one Dynamic-Type `width:`→`minWidth:` swap.

## Confirmed real gaps (read-verified)

This tier is **cleaner on color-only signals than Phase 1** — the H1/Phase-1 work already
labeled the traffic-light dots on `CommandTile` (`CommandView.swift:460`) and
`ManagementRollupView`'s `Tile` (`ManagementRollupView.swift:225`), and status chips
everywhere carry text ("Active"/"Off", classification tags, reason chips, YoY arrow+text).
**Do not re-label those already-correct elements.**

### The two marquee fixes (both read-confirmed in source, not grep-derived)

- **`TempPinsView.swift:96-98` — the raw issued PIN is read as a cardinal number.** The
  issued PIN is `Text(issued.pin)` at 34pt (`.font(.system(size: 34, …, design:
  .monospaced))`). VoiceOver speaks a string like `"4821"` as *"four thousand eight
  hundred twenty-one"* — useless for the banner's one job ("write it down"). This is the
  single most important fix on the tier. Fix: add an `.accessibilityLabel` that spells the
  digits (space-joined, e.g. `"PIN 4 8 2 1"`), or equivalently apply
  `.speechSpellsOutCharacters()`; the space-joined label is the safe default. The
  surrounding banner header ("PIN issued — shown once, write it down") and the `Done`
  button are untouched.
- **Combine-around-a-Button, five rows** (each read-confirmed):
  - `AuditLogView.swift:66-95` — combine the metadata (`action` chip / `slug` / `user` /
    timestamp, lines 69-86), keep the `Show`/`Hide` Button (line 89) a sibling.
  - `TempPinsView.swift:64-79` — combine the active-PIN info (label/scopes/expires,
    lines 66-75), keep the `Revoke` destructive Button (line 76) a sibling.
  - `ManagerPinsView.swift:73-97` — combine the name+role+badge lead, keep `Edit` (line 90)
    and `Disable` (line 93) siblings.
  - `ReceivingMatchesView.swift:71-119` — combine the info `HStack` (lines 73-95), keep the
    action `HStack` (Picker line 98 + `Set master` Button line 109, lines 97-119)
    uncombined.
  - `PackChangesView.swift:147-165` — combine the info `VStack` (lines 149-157), keep the
    `Give OK` Button (line 160) a sibling.

### The one confirmed color-only signal

- `CommandView.swift:406-426` — `AlertRow`'s bare severity dot
  (`Circle().fill(color).frame(width: 8, height: 8)`, lines 418-420) encodes red/orange
  severity with no label and no text on the element. The information is **not fully lost**
  (the `"Critical"` / `"Warnings"` section headers at `:374`/`:390` already name the
  severity in text), so the correct fix is `.accessibilityHidden(true)` on the decorative
  dot — removing a meaningless VoiceOver focus stop — rather than inventing a per-dot color
  word. This is the only genuine color-only element remaining on the tier.

### Clean combine (no interactive child — mechanical)

- `PerformanceReviewsView.swift:149-166` — the list row is info-only; a plain trailing
  `.combine`. Classification tag (`:155-157`) is text-backed, not color-only.
- `ManagementRollupView.swift:219-234` — per-`Tile` combine (no interactive child inside
  `Tile`; where a `Tile` sits in a `NavigationLink` at `:151-162`, the combine stays
  inside the tile body, so no control is nested).
- `CommandView.swift:150-167` — `StaleDataBanner` (icon + text) trailing combine. This
  banner is defined in `CommandView.swift` but used **only** by the three manager rollup
  boards (Command / Analytics / ManagementRollup), so it is **manager-local and in scope**
  — not a deferred shared component.

### Reinforcement-only / verified non-gaps (explicitly NOT touched)

- `ManagerPinsView.swift:81-89` Active/Off badge — `Text("Active"/"Off")` + color;
  **text-backed**, not color-only.
- `AnalyticsView.swift:147-156` YoY delta — arrow symbol + `"X% vs prior"` text + color;
  symbol/text-backed.
- `AuditLogView.swift:71-76` — amber action chip and slug color both sit on already-spoken
  text; **there are no red audit rows in the native port** (web-style audit-red is absent),
  so the "audit-red color-only" hazard does not exist here — stated explicitly so no one
  invents one.
- `ReceivingMatchesView.swift:86-91` reason chip and `PerformanceReviewsView` classification
  tag — text-backed.

## Dynamic-Type risk

**One confirmed fixed-width `Text` column on the entire tier:** `AnalyticsView.swift:474` —
`.frame(width: 20, alignment: .trailing)` on the `caption2` rank number `Text("\(idx+1)")`
in the top-items table. At AX-max a 2-digit rank can clip. Fix: `width: 20` → `minWidth:
20`. Read-confirmed.

Every other `.frame(width:/height:)` on the tier was read-confirmed **decorative and NOT a
hazard**: 8×8 status dots (`CommandView:420`, `:459`; `ManagementRollupView:224`), chart
canvas heights (`AnalyticsView:269/325/401/441`), a decorative revenue bar
(`AnalyticsView:497`), fixed-height `TileDegrade` empty states, and control-width caps on
`Picker`s (`AuditLogView:45/54` `maxWidth: 260`) / a search field `minWidth` — control
width-caps scroll their content, they do not clip like `Text`. `TempPinsView`,
`ManagerPinsView`, `PackChangesView`, `PerformanceReviewsView`, `ReceivingMatchesView`,
and `AuditLogView` have **zero** fixed-width `Text` columns.

## Shared components — deferred

| Component | Blast radius | Verdict |
|---|---|---|
| `TileDegrade` | ~79 files, all tiers | Defer. Already accessible (`ContentUnavailableView` = Label+Text). |
| `EmptyState` | ~38 files, all tiers | Defer. Already has `.accessibilityElement(children: .combine)`. |
| `PinEntrySheet` | Manager + labor/beo/vendor tiers | Defer/flag. SecureField + buttons already labeled; any change is cross-tier. |
| `CommandPalette` | App shell (`LariatApp.swift`), not a manager board | Defer/flag — **see cross-tier defect below.** |
| `DesignTokens` | color tokens only, no views | N/A. |

**Cross-tier defect flagged, NOT fixed here:** `CommandPalette.swift:149` applies
`.onTapGesture` to a `.combine`d row (`:178-179`). `.onTapGesture` is not exposed as a
VoiceOver action, so palette rows may be unactivatable under VoiceOver — the same shape as
Phase-1 "defect A". This is a **shell/H3 component, out of the Manager tier**. Per subagent
scope discipline it is surfaced to the shell owner as a recommendation; this wave does not
touch `CommandPalette.swift`.

## Effort classification

- **Mechanical** (haiku-suitable — single additive label / hidden dot / plain combine /
  `minWidth` swap): `AnalyticsView`, `ManagementRollupView`, `CommandView`,
  `PerformanceReviewsView`.
- **Structural** (sonnet — a combine scope that must exclude an interactive Button, or the
  temp-PIN digit-spell label): `AuditLogView`, `ReceivingMatchesView`, `PackChangesView`,
  `ManagerPinsView`, `TempPinsView`.

## Risk ranking (most sensitive first)

1. `TempPinsView` — raw PIN secret exposure + issuance/revocation.
2. `ManagerPinsView` — PIN credential create/disable.
3. `PackChangesView` — PIN-gated audited pack/unit ack (discovered/unswept).
4. `PerformanceReviewsView` — PIN-gated audited labor write (discovered/unswept).
5. `ReceivingMatchesView` — PIN-gated audited resolve; inventory-credit backfill + qty/unit.
6. `AuditLogView` — audit-trail review + combine/button hazard.
7. `CommandView` — money tiles + the one real color-only dot.
8. `ManagementRollupView` — money variance; dots already labeled.
9. `AnalyticsView` — charts + KPI text; lowest.

The implementation plan orders tasks **simplest-first, most-sensitive-last** (matching
every precedent tier — Costing ended on `CostingView`), so the mechanical pattern is
validated before the PIN-credential files, and the two PIN files get the freshest
attention immediately before the whole-branch review.

## Invariants

- **No interactive control is ever nested inside a `.combine` block** — every structural
  task keeps its Button/Picker a genuine sibling of the combined info scope.
- The raw issued temp-PIN is announced by VoiceOver as individual digits, not a cardinal
  number.
- Every genuinely ambiguous color-only signal is verbalized or the decorative element is
  `.accessibilityHidden`; reinforcement-only color (text-backed badges, signed YoY delta,
  amber chips on spoken text) is left untouched in every case identified above.
- Already-correct labels are not re-touched: `CommandView.swift:460`,
  `ManagementRollupView.swift:225`, `EmptyState`'s existing `.combine`.
- The `*ViewModel` / `LariatDB` repository layer behind the five write-fronting views is
  untouched — confirmed per-task by a scope-diff check, and again in the whole-branch
  review.
- `swift build` stays clean after every task; the final review confirms all 9 files gained
  accessibility modifiers and the branch diff touches exactly these 9 files under
  `LariatNative/`.

## Open questions

None outstanding. The temp-PIN idiom carries an explicit default (space-joined
`.accessibilityLabel`) with a documented alternative (`.speechSpellsOutCharacters()`); the
2 discovered files are owner-approved into scope.

## Testing / acceptance

Per-task: `swift build` clean (there is no XCTest target for `LariatApp`; this is stated
explicitly rather than claiming "TDD throughout"). For the five write-fronting views, an
extra mandatory step confirms zero diff in their `*ViewModel` / repository files (mirroring
the `IngredientMastersViewModel` zero-diff check from the Costing tier). Final: a scripted
coverage audit (all 9 files gained `.accessibility*` modifiers) + scope-diff check (exactly
these 9 files under `LariatNative/`) + a **mandatory whole-branch review** comparing all 9
files side-by-side. That whole-branch pass is a real gate, not a formality: Phase 1's
SdsView regression (12 files right, 1 wrong) was only catchable by diffing the tier as a
set — here it would catch, e.g., one row combining a Button while the other four correctly
exclude it.
