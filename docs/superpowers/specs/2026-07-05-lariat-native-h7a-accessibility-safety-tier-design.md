# LariatNative H7a Phase 1 — VoiceOver labels: `.safety` tier

Date: 2026-07-05
Status: draft (awaiting review)
Parent: `docs/superpowers/specs/2026-07-02-lariat-native-endgame.md` §4 (H7 Accessibility + iPad)

## Goal

Phase 1 of the H7 accessibility sweep: add VoiceOver labels to the 13 `.safety`-tier
board views that currently have zero accessibility modifiers, and fix the one
Dynamic-Type-hostile pattern found in `HaccpPlanView`. Establishes the house pattern
(inline `.accessibilityLabel`, matching the existing `SanitizerView` precedent) that
later phases (the other 13 tiers, ~61 remaining view files) will follow. Safety tier
chosen first — of the endgame scoreboard's ~74 boards / 75 view files, only 17 have
any accessibility modifier today; inaccessible HACCP/compliance data is the
highest-consequence gap among the untouched 58.

## Non-goals

- iPad cook tier — separate future wave (decided earlier this session).
- H6b (native printing), H6c (menu-bar extra + multi-window) — queued separately.
- The other 13 tiers' accessibility sweep (~61 remaining zero-coverage view files) —
  future phases of H7a, not this PR.
- Any new test/UI-inspection dependency (ViewInspector, SnapshotTesting, etc.) — this
  codebase has exactly one dependency (GRDB) today; pulling in a UI-testing library for
  accessibility-label coverage is disproportionate to the value and against established
  house style (confirmed: zero View-layer test infrastructure exists anywhere in the
  2,300+ existing tests).
- Extracting accessibility-label strings into `LariatModel` pure functions — the
  established house pattern (`SanitizerView.swift:73`:
  `.accessibilityLabel("Prefill form for \(point.label) using \(point.chemistry.rawValue)")`)
  inlines them directly in the View body. This wave follows that precedent rather than
  inventing a new extraction convention this codebase doesn't already use.
- `SanitizerView.swift`, `AllergenLookupView.swift` — already have accessibility
  coverage; read-only reference, not touched.

## User-facing surface

No new screens. The 13 views below gain accessibility labels on their
meaningfully-informative visual elements (status tiles, buttons, badges) so VoiceOver
announces the same information a sighted operator already sees. `HaccpPlanView`'s one
fixed-pixel-size font is swapped to a semantic style so it scales with the system
Dynamic Type setting like every other touched file already does.

## Files in scope (Phase 1) — 13 views, all currently zero accessibility coverage

| View file | Board id |
|---|---|
| `FoodSafetyHubView.swift` | `safety.hub` |
| `TempLogView.swift` | `safety.tempLog` |
| `CoolingView.swift` | `safety.cooling` |
| `DateMarkView.swift` | `safety.dateMarks` |
| `CalibrationsView.swift` | `safety.calibrations` |
| `CleaningView.swift` | `safety.cleaning` |
| `BreakBoardView.swift` | `safety.breaks` |
| `TphcView.swift` | `safety.tphc` |
| `PestView.swift` | `safety.pest` |
| `SdsView.swift` | `safety.sds` |
| `SickWorkerView.swift` | `safety.sickWorker` |
| `ReceivingView.swift` | `safety.receiving` |
| `HaccpPlanView.swift` | `safety.haccpPlan` (+ the one Dynamic-Type fix) |

Confirmed via `grep -c '\.font(\.system(size:\|\.frame(height: [0-9]+)'`: 12 of these 13
already use semantic font styles throughout — `HaccpPlanView.swift` is the only one with
a hostile fixed-size pattern.

## Data model deltas

None — pure View-layer changes.

## Invariants

- Every interactive control (`Button`, `Toggle`, `TextField`) in a touched file has an
  accessibility label describing its action, not just its glyph/icon.
- Every status-bearing tile/badge (counts, red/amber/green tone, overdue/expired states)
  has an accessibility label that verbalizes the same state a sighted user sees — not
  just the raw number (e.g. "3 temp readings out of range, action needed" rather than
  bare "3").
- No existing behavior changes — accessibility modifiers are strictly additive; nothing
  here changes what a sighted user experiences or how any board's data/writes work.
- Dynamic Type: no `.font(.system(size:))` fixed-pixel sizes remain in the touched files
  where they wrap user-facing text — replaced with semantic styles (`.body`, `.headline`,
  `.caption`, etc.), matching the other 12 files' existing convention.

## Testing / acceptance

- **No XCTest coverage is possible for this** — matches the established
  `BoardPoller`/`CommandViewModel` precedent: `LariatApp` view-layer glue has no test
  target (`Package.swift` declares exactly `LariatModelTests`/`LariatDBTests`), and zero
  existing tests touch any `View` type anywhere in this codebase.
- Acceptance per file: `swift build` clean.
- **Scripted (not prose) coverage audit**: a bash script asserting each of the 13 named
  files contains at least one accessibility-modifier occurrence
  (`\.accessibilityLabel|\.accessibilityElement|\.accessibilityHint|\.accessibilityValue|\.dynamicTypeSize|accessibilityAddTraits`)
  after the change — a concrete, checkable proxy that catches "forgot this file
  entirely," not full semantic correctness (it cannot verify a label's wording is
  actually good). Mirrors H6a's T8 scripted-diff-check precedent over a manual eyeball
  pass.
- **Manual VoiceOver spot-check**: documented, non-gating — turn on VoiceOver, navigate
  each of the 13 boards, confirm tiles/buttons announce sensibly. Needs a real desktop
  session; same limitation as H6a's foreground-banner/tap-to-navigate checks (not
  verifiable headless).

## Open questions

- Exact wording for each label is a per-file judgment call during implementation,
  following `SanitizerView`'s precedent (verbalize the live data a sighted user would
  read, not just repeat the visible glyph/number). Not resolved here; the plan will list
  each file as its own task so wording gets reviewed per-board rather than batched.
