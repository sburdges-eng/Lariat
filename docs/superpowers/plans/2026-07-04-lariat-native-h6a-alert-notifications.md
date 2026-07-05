# LariatNative H6a — local notifications for red signals — Implementation Plan

Spec: `docs/superpowers/specs/2026-07-04-lariat-native-h6a-alert-notifications-design.md`
(status: draft, awaiting review — read in full before starting T1).

Branch: `feat/lariat-native-h6a-notifications` (already checked out in this worktree).
Worktree: `worktrees/native-h6a-notifications`. Scope: `LariatNative/**` only, plus this
plan doc. One commit per task, message prefixed `T<n>:`.

**TDD scope (corrected from an earlier draft's overreach):** T1–T4 are TDD throughout —
each task's test is written and run RED before the implementation makes it GREEN. T5–T7
are thin `LariatApp`-layer glue (SwiftUI wiring, `UNUserNotificationCenter` adapter code)
with no independently branchable logic left once T1–T4 are extracted — see Resolved
Decision 3. There is no `LariatAppTests` target in this codebase (`Package.swift` declares
exactly `LariatModelTests` and `LariatDBTests`), and no existing `LariatApp/*.swift` file
(`BoardPoller.swift`, `CommandView.swift`, etc.) has a unit test today. T5–T7's gate is a
clean `swift build`, not a RED/GREEN cycle — this is stated explicitly per task below, not
silently assumed under a blanket "TDD throughout" claim.

**Scope discipline (applies to every task, T1–T7):** create and modify ONLY the files
listed in that task's "New/modified files" row / "Paths touched". Do not invent an
additional file (a settings view, a menu-bar controller, a preferences store, etc.) even if
it feels like a natural companion to the file you're already authoring. If an additional
file seems necessary to do the task well, stop and flag it for plan revision instead of
adding it. T8's file-list check (a scripted diff, not a manual eyeball pass — see T8) is
the final backstop, but the primary control is this rule applied at each task.

All acceptance commands assume `cd` into `LariatNative/` first (where `Package.swift`
lives), i.e. every command below is shorthand for
`cd /Users/seanburdges/Dev/hospitality/Lariat/worktrees/native-h6a-notifications/LariatNative && <command>`.

---

## Resolved decisions (read before starting — supersede the spec's Open Questions)

### Open Question 1 — Command board's `FeatureDescriptor.id`

**RESOLVED: `"manager.command"`.** Confirmed identically in three places, no ambiguity:
- `LariatNative/Sources/LariatModel/FeatureCatalog.swift:86` —
  `FeatureDescriptor(id: "manager.command", tier: .manager, title: "Command")`
- `LariatNative/Sources/LariatApp/FeatureRegistry.swift:49` — `.managerCommand,` in
  `FeatureRegistry.all`
- `LariatNative/Sources/LariatApp/ManagerFeatures.swift:5-11` —
  `static let managerCommand = FeatureModule(id: "manager.command") { ctx in ... }`

No task needs to re-derive this; it is hardcoded as a constant in T3 (see below) and
consumed by T7's tap-adapter.

### Open Question 2 — repository backing the cooling-overdue count

**RESOLVED: `CoolingRepository.load(...)`** (`LariatNative/Sources/LariatDB/CoolingRepository.swift:24-56`)
is the sole caller of `CoolingCompute.scanOpenBatches` (confirmed: it is the only file in
`Sources/LariatDB/` that references `CoolingCompute`). It returns a `CoolingBoardSnapshot`
(`LariatNative/Sources/LariatModel/CoolingRecords.swift:144-158`) whose
`.scan: [CoolingScanEntry]` field carries a `.breached: Bool` per open batch
(`CoolingRecords.swift:125-141`). **The cooling-overdue count is
`snapshot.scan.filter(\.breached).count`.** `classifyCoolingStage` (mentioned as a maybe
in the spec) is NOT involved — it classifies a single stage-close event, not a dashboard
rollup, and no task below touches it.

`CommandRepository`/`CommandBundle` have zero existing cooling-related fields or reads
(grep confirmed). This is a genuinely new integration, exactly as the spec assumed.

### Deviations / additions beyond the spec's literal wording, made explicit

1. **`CommandSummary.coolingOverdueCount` placement.** The spec says "same shape as the
   existing `foodSafety.tempBreaches` etc. fields" but also calls it a field "threaded
   onto `CommandSummary`" (i.e., ambiguous between top-level and nested-in-`FoodSafety`).
   **Decision: nest it inside `CommandSummary.FoodSafety` as `coolingOverdue: Int`**,
   matching the sibling naming convention already used there (`cleaningOverdue`,
   `probesOverdue`) — cooling-batch compliance is a HACCP food-safety concept exactly like
   those two. `CommandCompute.summarize(...)` gains a new **defaulted** parameter
   `coolingOverdueCount: Int = 0` (mirroring the existing `priceMoves: MoveSummary = .zero`
   / `marginMoves: MoveSummary = .zero` pattern at `CommandCompute.swift:239-244`), which it
   assigns into `foodSafety.coolingOverdue`. Because it is additive-and-defaulted, **no
   existing call site or existing test needs to change** — every existing
   `CommandCompute.summarize(bundle:locationId:today:)` call keeps compiling and keeps
   producing `coolingOverdue == 0`, which `alertsFor`'s `push` helper gates out exactly like
   every other zero-count red source. Confirmed by direct inspection of
   `CommandCompute.swift`: `FoodSafety` (lines 117-127) and `alertsFor` (lines 406+) —
   `push` gates on `count > 0` (line 408), and the red block's existing order is
   `temp-breaches, date-marks-expired, cleaning-overdue, probes-failed, probes-overdue,
   cert-expired, eighty-six`, then the `reservation-no-shows` threshold check (lines
   412-437) — so `testAlertsFor_exactSet` / `testAlertsFor_severityOrdering` keep passing
   unmodified.

2. **`NotificationPoster` shape: protocol, not a closure typealias.** The spec cites
   `BeoCascadeClient.Runner` (`LariatModel/BeoCascadeClient.swift:121`) as "the precedent,"
   but `Runner` is a closure typealias wrapping ONE function, while the notification
   boundary needs two independent operations (check-and-lazily-request authorization; post
   by identifier). **Decision: a genuine `protocol NotificationPoster`** with two async
   methods (see T3). The *pattern* (injectable seam, real default implementation, stub
   test double) still mirrors `BeoCascadeClient`'s precedent; only the Swift construct
   differs, and this is now a conscious choice, not an accident.

3. **Where the pure/testable logic lives — a structural finding not in the spec.**
   `LariatNative/Package.swift` declares exactly two test targets, `LariatModelTests` and
   `LariatDBTests` — **there is no test target that depends on the `LariatApp` executable
   target** (confirmed directly), and no existing `LariatApp/*.swift` file
   (`BoardPoller.swift`, `CommandView.swift`, `ManagerFeatures.swift`, etc.) has any unit
   test today (confirmed: `find LariatNative/Tests -iname "*Poller*"` and equivalents
   return nothing). The spec's prose ("`AlertMonitor.notificationsToFire`... tested... with
   no Foundation notification API involved") implies a test target that, as of this branch
   point, does not exist. **Decision: do not add a `LariatAppTests` target.** Instead,
   split the feature so ALL independently-testable logic lives in `LariatModel` (this
   codebase's existing testability boundary — `CommandCompute`, `CoolingCompute`,
   `BeoCascadeClient` all live there and are tested via `LariatModelTests`), and only the
   thin SwiftUI/AppKit/`UNUserNotificationCenter` glue — which has no independently-testable
   branches once the logic below is extracted — lives untested in `LariatApp`, exactly
   matching `BoardPoller`/`CommandView`'s own precedent. Concretely:
   - `AlertMonitorCompute` (pure diff/peak/re-arm math) → `LariatModel`, tested (T2).
   - `NotificationPoster` (protocol + production impl) → `LariatModel`, tested (T3).
   - `AlertMonitorEngine` (permission-gated fire/post orchestration, using T2+T3) →
     `LariatModel`, tested (T4). This is a new decomposition beyond the spec's literal
     three components, added specifically so the "denied → suppress; keeps computing;
     granted-later → catch-up fire" behavior is unit-tested without touching
     `UNUserNotificationCenter` for real.
   - `AlertMonitor` (the actual `@Observable @MainActor` singleton: real DB repositories,
     the bespoke 45 s loop, owns one `AlertMonitorEngine`) → `LariatApp`, **not** unit
     tested (T5), same posture as `BoardPoller`.
   - `.task` wiring in `LariatApp.swift` (T6) and the `UNUserNotificationCenterDelegate`
     tap/presentation adapter (T7) are also `LariatApp`-layer glue, not unit tested, for the
     same reason.
   This is flagged prominently for reviewer sign-off, since it changes where 3 of the
   spec's components physically live relative to its prose.

4. **Peak-freeze-while-denied semantics (spec underspecifies this).** The dict is named
   `lastNotifiedPeak` — read literally, it should only ratchet for counts that were
   *actually* posted. **Decision:** `AlertMonitorEngine` only commits a fired source's new
   peak when `poster.post(...)` was actually called (i.e., authorized). While
   unauthorized, a source's tracked peak stays frozen at whatever it was before (0 if
   never notified) — so the moment permission is later granted, the still-elevated count is
   `> 0` (the frozen peak), which correctly fires exactly one catch-up notification at the
   current count. Re-arm (a source dropping out of the current red-alert list) always
   clears its tracked key regardless of authorization state — there is nothing to preserve
   for an alert that no longer exists. T4's tests cover this explicitly (including a
   dedicated test for the re-arm-while-unauthorized combination — see T4, added during
   review).

5. **Notification content.** Spec: "Title/body: the `CommandAlert.message` string
   verbatim." Read literally as *one* string used for both fields — `NotificationPoster.post`
   takes a single `message: String` (not separate `title`/`body` params); the production
   implementation sets both `UNMutableNotificationContent.title` and `.body` to it. Simpler
   surface, no meaningless duplication in the call site.

6. **Foreground presentation (`willPresent`) — critical gap closed during review.** The
   spec's Goal is explicitly "even while working a completely different board (KDS, 86,
   prep)" — i.e. the app is frontmost, just on a different board. On macOS/iOS, once any
   `UNUserNotificationCenterDelegate` is set (which T7 does, to handle the tap), the system
   will NOT visually present a notification (no banner, no sound) while the app is
   foreground/active *unless* the delegate implements
   `userNotificationCenter(_:willPresent:withCompletionHandler:)` and calls the completion
   handler with presentation options. Without this, the plan's primary use case would
   silently produce zero visible notification — the opposite of the feature's purpose.
   **Decision:** `AlertNotificationDelegate` (T7) implements both delegate methods —
   `willPresent` (returns `[.banner, .sound, .list]` unconditionally; there is no per-source
   muting per the spec's own non-goals) and `didReceive response:` (navigates). See T7.

7. **`AlertMonitorEngine`'s authorization-check caching is asymmetric — a bug found and
   fixed during review.** An earlier draft cached `ensureAuthorized()`'s result the first
   time it was checked and never rechecked it again, for either outcome. That directly
   contradicts the spec's own invariant ("the monitor keeps computing diffs... so it
   doesn't silently break once granted later") and its own required test
   (`test_deniedThenGrantedLater_firesCatchUpExactlyOnce`): once cached `false` on tick 1,
   a literal "checked-once" gate would never re-check on tick 2, so authorization being
   granted later would never be observed. **Decision: the cache is sticky only in the
   `true` direction.** `isAuthorized` starts `false`; on every tick where `fire` is
   non-empty, if `isAuthorized` is not yet `true`, `ensureAuthorized()` is called again and
   the result overwrites `isAuthorized` (so a `false` result keeps getting re-verified on
   every future candidate tick — this is what makes granted-later detection work); the
   moment a tick observes `true`, that state is permanent and no further calls to
   `ensureAuthorized()` happen. See T4's corrected `tick` pseudocode.

---

## Task list

| Task | New/modified files | Depends on |
|---|---|---|
| T1 | `CommandCompute.swift`, `CommandComputeTests.swift` | — |
| T2 | `AlertMonitorCompute.swift` (new), `AlertMonitorComputeTests.swift` (new) | — |
| T3 | `NotificationPoster.swift` (new), `NotificationPosterTests.swift` (new) | — |
| T4 | `AlertMonitorEngine.swift` (new), `AlertMonitorEngineTests.swift` (new) | T2, T3 |
| T5 | `LariatApp/AlertMonitor.swift` (new) | T1, T3, T4 |
| T6 | `LariatApp/LariatApp.swift` | T5 |
| T7 | `LariatApp/AlertMonitor.swift` (extend), `LariatApp/AlertNotificationDelegate.swift` (new) | T3, T5 |
| T8 | (none — verification only) | T1–T7 |

T1, T2, T3 touch disjoint files and have no dependency on each other — they may be done
in any order (or in parallel across workers) before T4.

---

### T1 — `cooling-overdue` red source in `CommandCompute`

**Description.** Add `CommandSummary.FoodSafety.coolingOverdue: Int`; add a defaulted
`coolingOverdueCount: Int = 0` parameter to `CommandCompute.summarize(...)` that populates
it; add a red `push(CommandAlert(severity: .red, source: "cooling-overdue", message:
"\(n) cooling batch\(plural(n)) overdue", count: n))` case inside `alertsFor`, placed in
the red block (after `eighty-six`, before the `reservation-no-shows` threshold check, to
match the existing "one `push` per line, threshold-based reds last" layout).

**Paths touched:**
- `LariatNative/Sources/LariatModel/Compute/CommandCompute.swift`
- `LariatNative/Tests/LariatModelTests/CommandComputeTests.swift`

**MUST NOT modify:**
- `LariatNative/Sources/LariatModel/CoolingRecords.swift`
- `LariatNative/Sources/LariatModel/Compute/CoolingCompute.swift`
- `LariatNative/Sources/LariatDB/CoolingRepository.swift`
- `LariatNative/Sources/LariatDB/CommandRepository.swift`
- `LariatNative/Sources/LariatApp/CommandView.swift`
- `LariatNative/Sources/LariatApp/LariatApp.swift`
- `LariatNative/Package.swift`
- any other `Compute/*.swift` file
- the existing literal values inside `fixtureBundle()` (only add new test functions;
  do not touch the fixture's existing field values, since `testAlertsFor_exactSet` /
  `testAlertsFor_severityOrdering` must keep passing unmodified — see Resolved Decision 1)
- **do not create any file not listed in "Paths touched" above** (scope discipline, see
  preamble)

**Dependencies:** none.

**TDD steps:**
1. RED — add to `CommandComputeTests.swift`:
   - `testAlertsFor_coolingOverdueAbsentAtZero` — `CommandCompute.alertsFor(s)` (default
     `s`) does not contain source `"cooling-overdue"`.
   - `testAlertsFor_coolingOverduePresentAndPlural` — mutate `s.foodSafety.coolingOverdue = 2`
     (mirrors the `testAlertsFor_noShowRedThreshold` mutate-a-copy idiom), assert a red
     alert with `source == "cooling-overdue"`, `count == 2`,
     `message == "2 cooling batches overdue"`.
   - `testAlertsFor_coolingOverdueSingular` — `coolingOverdue = 1` → message
     `"1 cooling batch overdue"`.
   Run `swift test --filter CommandComputeTests` → FAIL (compile error: no member
   `coolingOverdue` on `FoodSafety`).
2. GREEN — add the `coolingOverdue: Int` field to `FoodSafety`, the
   `coolingOverdueCount: Int = 0` parameter to `summarize`, and the new `push(...)` line in
   `alertsFor`. Run `swift test --filter CommandComputeTests` → PASS, including
   `testAlertsFor_exactSet` and `testAlertsFor_severityOrdering` unchanged.
3. Commit.

**Acceptance test command:**
```
swift test --filter CommandComputeTests
```

**Commit message:** `T1: add cooling-overdue red source to CommandCompute`

---

### T2 — `AlertMonitorCompute`: pure diff/peak/re-arm state machine

**Description.** New pure enum in `LariatModel`, mirroring the `XCompute` naming
convention (`CommandCompute`, `CoolingCompute`, `TempLogCompute`):

```swift
public enum AlertMonitorCompute {
    /// `currentRedAlerts` need not be pre-filtered — non-`.red` entries are ignored
    /// entirely (never fire, never tracked). A source present in `previousPeaks` but
    /// absent from `currentRedAlerts` is treated as having dropped to 0 and is removed
    /// from `nextPeaks` (re-arms it for a fresh fire next time it appears nonzero).
    public static func notificationsToFire(
        previousPeaks: [String: Int],
        currentRedAlerts: [CommandAlert]
    ) -> (fire: [CommandAlert], nextPeaks: [String: Int])
}
```

Algorithm: for each `.red` alert in `currentRedAlerts`, if `count >
previousPeaks[source, default: 0]`, append to `fire` and set `nextPeaks[source] = count`;
else copy the existing peak forward unchanged. Any key in `previousPeaks` whose source is
not present among `currentRedAlerts`'s red sources is dropped from `nextPeaks` (re-arm).
`CommandAlert.count` is always `> 0` by construction for anything in `alertsFor`'s output
(the `push` helper's gate, plus the `reservation-no-shows` threshold check), so "count == 0"
is represented by *absence*, not by an explicit zero-count `CommandAlert` — this function's
re-arm-on-absence design accounts for that directly (do not require callers to synthesize
zero-count `CommandAlert`s).

**Paths touched:**
- `LariatNative/Sources/LariatModel/Compute/AlertMonitorCompute.swift` (new)
- `LariatNative/Tests/LariatModelTests/AlertMonitorComputeTests.swift` (new)

**MUST NOT modify:**
- `LariatNative/Sources/LariatModel/Compute/CommandCompute.swift` (T1's file)
- `LariatNative/Sources/LariatModel/NotificationPoster.swift` (does not exist yet — T3)
- `LariatNative/Sources/LariatModel/AlertMonitorEngine.swift` (does not exist yet — T4)
- anything under `LariatNative/Sources/LariatApp/`
- `LariatNative/Package.swift`
- **do not create any file not listed in "Paths touched" above** (scope discipline, see
  preamble)

**Dependencies:** none (only needs the pre-existing `CommandAlert` type).

**TDD steps (per spec's Testing section, verbatim test list):**
1. RED — write `AlertMonitorComputeTests.swift` against a not-yet-existing
   `AlertMonitorCompute`:
   - `test_zeroToNonzero_fires` — `previousPeaks: [:]`, one red alert count 3 → fires,
     `nextPeaks == ["x": 3]`.
   - `test_unchangedNonzero_doesNotRefire` — `previousPeaks: ["x": 3]`, same alert count 3
     → `fire` empty, `nextPeaks` unchanged.
   - `test_increasePastPeak_firesAgain` — `previousPeaks: ["x": 3]`, count 5 → fires,
     `nextPeaks == ["x": 5]`.
   - `test_dropToZeroThenRise_refires` — two sequential calls: call 1 with the alert
     absent (source gone) and `previousPeaks: ["x": 3]` → `nextPeaks == [:]`; call 2 feeds
     that `nextPeaks` back in as `previousPeaks` with the alert present again at count 1 →
     fires, `nextPeaks == ["x": 1]`.
   - `test_amberNeverFires` — an `.amber`-severity `CommandAlert` with a large count, any
     `previousPeaks` → `fire` empty and the source never appears in `nextPeaks`, regardless
     of count.
   Run `swift test --filter AlertMonitorComputeTests` → FAIL (symbol undefined).
2. GREEN — implement `notificationsToFire` per the algorithm above. Run → PASS.
3. Commit.

**Acceptance test command:**
```
swift test --filter AlertMonitorComputeTests
```

**Commit message:** `T2: pure AlertMonitorCompute diff/peak/re-arm state machine`

---

### T3 — `NotificationPoster` protocol + production impl + routing constant

**Description.** New file in `LariatModel` (not `LariatApp` — see Resolved Decision 3;
this keeps it unit-testable and mirrors `BeoCascadeClient`'s placement precedent of
"OS-boundary wrapper lives in `LariatModel`, tested via a stub, real impl untested
directly"):

```swift
public protocol NotificationPoster: Sendable {
    /// Checks current `UNAuthorizationStatus`; if `.notDetermined`, requests it. Returns
    /// whether posting is currently allowed. Must be safe to call repeatedly (only the
    /// FIRST call after a `.notDetermined` state actually prompts). Must reflect the
    /// CURRENT status on every call — do not cache inside the poster itself; caching
    /// across calls is `AlertMonitorEngine`'s job (see Resolved Decision 7 / T4), not this
    /// protocol's.
    func ensureAuthorized() async -> Bool

    /// Posts (or replaces, by `identifier`) a notification. `identifier` is always
    /// `CommandAlert.source` — `UNUserNotificationCenter.add` natively replaces any
    /// pending request with the same identifier, which is the entire "replace, don't
    /// stack" dedup mechanism; no manual bookkeeping beyond `lastNotifiedPeak` itself.
    func post(identifier: String, message: String) async
}

public struct SystemNotificationPoster: NotificationPoster {
    public init() {}
    public func ensureAuthorized() async -> Bool { /* wraps UNUserNotificationCenter.current() */ }
    public func post(identifier: String, message: String) async { /* wraps .add(...) */ }
}

/// v1: every alert tap navigates to the same board (Command) — see spec's
/// "User-facing surface" §Tap action. Open Question 1, resolved: `"manager.command"`
/// (`FeatureCatalog.swift:86`, `FeatureRegistry.swift:49`, `ManagerFeatures.swift:5-11`).
public enum AlertNotificationRouting {
    public static let commandFeatureId = "manager.command"
}
```

**Paths touched:**
- `LariatNative/Sources/LariatModel/NotificationPoster.swift` (new)
- `LariatNative/Tests/LariatModelTests/NotificationPosterTests.swift` (new)

**MUST NOT modify:**
- anything under `LariatNative/Sources/LariatApp/`
- `LariatNative/Sources/LariatModel/Compute/AlertMonitorCompute.swift` (T2)
- `LariatNative/Sources/LariatModel/Compute/CommandCompute.swift`
- `LariatNative/Package.swift`
- `LariatNative/Sources/LariatModel/FeatureCatalog.swift` (only read from, the id is
  hardcoded as a string constant here, not re-derived from the catalog at runtime)
- **MUST NOT register any `UNNotificationCategory` / `UNNotificationAction`** (e.g. a
  "Mute this alert" or "Snooze source" action) on any notification content, and **MUST NOT
  persist any per-source preference** (`UserDefaults` or otherwise) anywhere in this file.
  Content is title/body only, exactly per spec. This guards the explicit non-goal "per-signal
  notification preferences / a settings UI to mute individual sources" — that non-goal is
  easy to reintroduce in miniature inside this file specifically (it's idiomatic
  `UNUserNotificationCenter` usage to add a category/action here), so it is named
  explicitly rather than left to a generic "don't touch other files" list.
- **do not create any file not listed in "Paths touched" above** (scope discipline, see
  preamble)

**Dependencies:** none.

**Note on testability:** `SystemNotificationPoster` wraps real `UNUserNotificationCenter`
calls and — like `BeoCascadeClient.processRunner`'s real subprocess spawn — is not
exercised directly by an automated test (no headless CI environment reliably grants/denies
notification permission or observes real posts). What IS tested here is (a) the routing
constant, and (b) a minimal in-file `RecordingNotificationPoster` test double (configurable
`authorizedToReturn: Bool`, and arrays capturing every `ensureAuthorized`/`post` call) that
T4's `AlertMonitorEngineTests` will reuse — this task defines and unit-tests that double so
T4 can consume it as a fixture rather than each test hand-rolling its own recorder.
**Follow-up flagged for human reviewer (not fixed in this plan, judged not worth the extra
scope):** `RecordingNotificationPoster` is `public` inside the release `LariatModel`
library surface because no dedicated test-support module/target exists in this codebase
today. A later cleanup pass could gate it behind `#if DEBUG` or move it to a dedicated
test-support target; not doing so now is a conscious, documented tradeoff, not an oversight.

**TDD steps:**
1. RED — write `NotificationPosterTests.swift`:
   - `testCommandFeatureId` — `AlertNotificationRouting.commandFeatureId == "manager.command"`.
   - `testRecordingPosterRecordsCalls` — construct `RecordingNotificationPoster(authorizedToReturn: true)`,
     call `post(identifier: "x", message: "hi")` twice, assert `postedIdentifiers == ["x", "x"]`
     and `postedMessages == ["hi", "hi"]` (asserting the double itself behaves as a faithful
     recorder — this is what makes it trustworthy as a fixture for T4).
   - `testRecordingPosterEnsureAuthorizedReturnsConfiguredValue` — both `true` and `false`
     configurations round-trip correctly (including changing the configured value between
     calls, since T4's engine tests rely on reconfiguring the double mid-sequence), and
     `ensureAuthorizedCallCount` increments per call.
   Run `swift test --filter NotificationPosterTests` → FAIL (types undefined).
2. GREEN — implement `NotificationPoster`, `SystemNotificationPoster` (real
   `import UserNotifications` wrapper), `AlertNotificationRouting`, and
   `RecordingNotificationPoster` (test-only type — place it in the same
   `NotificationPoster.swift` file, `public` so `AlertMonitorEngineTests` in the same
   target can use it; no dedicated "TestSupport" module exists in this codebase). Run →
   PASS.
3. Commit.

**Acceptance test command:**
```
swift test --filter NotificationPosterTests
```

**Commit message:** `T3: NotificationPoster protocol + production impl + routing constant`

---

### T4 — `AlertMonitorEngine`: permission-gated fire/post orchestration

**Description.** New type in `LariatModel` (see Resolved Decision 3 for why this is a new
component beyond the spec's literal three, and Resolved Decisions 4 & 7 for its peak-freeze
and authorization-caching semantics — **Decision 7's asymmetric caching corrects a bug an
earlier draft of this plan had**, so implement exactly the pseudocode below, not a
"check once and cache forever" version):

```swift
public final class AlertMonitorEngine {
    private let poster: NotificationPoster
    private var lastNotifiedPeak: [String: Int] = [:]
    private var isAuthorized = false   // sticky ONLY in the `true` direction — see below

    public init(poster: NotificationPoster) { self.poster = poster }

    /// Called once per poll tick with the FULL current alert list (any severities).
    /// Filters to `.red` internally. Never throws; `NotificationPoster`'s methods are not
    /// throwing, so there is no I/O failure for `tick` to catch at this layer — genuine
    /// repository-read failures are caught one layer up, in `AlertMonitor` (T5), per the
    /// spec's "a poll failure degrades silently" invariant (see T5, untested by design).
    public func tick(alerts: [CommandAlert]) async {
        let reds = alerts.filter { $0.severity == .red }
        let (fire, candidatePeaks) = AlertMonitorCompute.notificationsToFire(
            previousPeaks: lastNotifiedPeak, currentRedAlerts: reds)

        guard !fire.isEmpty else {
            // Nothing to fire this tick — re-arm drops (if any) still apply, but there is
            // no candidate alert, so no permission check happens (Invariant: "never
            // request permission until there is an actual candidate alert").
            lastNotifiedPeak = candidatePeaks
            return
        }

        // Asymmetric cache (Resolved Decision 7): while `false`, re-verify on every
        // fire-triggering tick, so permission granted later (outside the app) is picked
        // up on the next candidate tick. Once `true` is observed, never check again.
        if !isAuthorized {
            isAuthorized = await poster.ensureAuthorized()
        }

        if isAuthorized {
            for alert in fire {
                await poster.post(identifier: alert.source, message: alert.message)
            }
            lastNotifiedPeak = candidatePeaks   // safe: every fired source was just posted
        } else {
            // Re-arm drops still commit even while unauthorized (Resolved Decision 4,
            // second sentence) — only the FIRED sources' peaks stay frozen at their prior
            // value (0 / absent if never notified before).
            var next = candidatePeaks
            for alert in fire {
                if let old = lastNotifiedPeak[alert.source] {
                    next[alert.source] = old
                } else {
                    next.removeValue(forKey: alert.source)
                }
            }
            lastNotifiedPeak = next
        }
    }
}
```

**Paths touched:**
- `LariatNative/Sources/LariatModel/AlertMonitorEngine.swift` (new)
- `LariatNative/Tests/LariatModelTests/AlertMonitorEngineTests.swift` (new)

**MUST NOT modify:**
- `LariatNative/Sources/LariatModel/Compute/AlertMonitorCompute.swift` (T2 — consume only)
- `LariatNative/Sources/LariatModel/NotificationPoster.swift` (T3 — consume only)
- `LariatNative/Sources/LariatModel/Compute/CommandCompute.swift`
- anything under `LariatNative/Sources/LariatApp/`
- `LariatNative/Package.swift`
- **do not create any file not listed in "Paths touched" above** (scope discipline, see
  preamble)

**Dependencies:** T2 (`AlertMonitorCompute`), T3 (`NotificationPoster`,
`RecordingNotificationPoster`).

**TDD steps:**
1. RED — write `AlertMonitorEngineTests.swift` using `RecordingNotificationPoster` from T3
   (7 tests total — one more than an earlier draft, added during review to close a gap in
   Resolved Decision 4's coverage):
   - `test_firstCandidate_requestsAuthorizationLazily` — authorized double
     (`authorizedToReturn: true`); no `ensureAuthorized` call before the first tick that has
     a nonzero red alert; exactly one call on that first candidate tick; a second tick with
     an unchanged count makes no new candidate (so no call, trivially); a second tick with a
     *higher* count is a new fire candidate but makes NO new `ensureAuthorized` call either,
     because `isAuthorized` was already latched `true` on tick 1 (asserts the "sticky only
     in the `true` direction" behavior, not just "no call when there's nothing to fire").
   - `test_authorized_posts` — authorized double; a red alert count 2 → `post` called once
     with `identifier == "cooling-overdue"`, `message == alert.message`.
   - `test_denied_neverPosts` — unauthorized double; several ticks with increasing counts →
     `post` is never called, and `ensureAuthorized` IS called again on each such tick
     (asserts the re-verify-while-false half of the asymmetric cache, not just "no post").
   - `test_deniedThenGrantedLater_firesCatchUpExactlyOnce` — tick 1 denied at count 3 (no
     post; peak stays frozen at 0 per Resolved Decision 4; `ensureAuthorized` called once,
     returns `false`); tick 2 (still at count 3, unchanged) with the double reconfigured to
     `authorizedToReturn = true` → fires exactly once at count 3 (not suppressed as
     "unchanged", because the frozen peak was never actually ratcheted, so `count 3 >
     previousPeaks[source, default: 0] == 0` still holds), `ensureAuthorized` is called again
     on tick 2 (it was still `false` going in) and now returns `true`, so `post` is called
     exactly once total across both ticks.
   - `test_amberNeverPosts` — an amber alert with a large count never triggers `post` or
     `ensureAuthorized`, even across multiple ticks.
   - `test_rearmClearsEvenWhileUnauthorized` — unauthorized double; source `"x"` fires on
     tick 1 (frozen at 0, per Decision 4, no post); tick 2 omits `"x"` entirely (re-arm
     candidate); tick 3 (still unauthorized) reintroduces `"x"` at count 1 → asserts it
     fires again as a fresh 0→nonzero transition (not suppressed), proving the re-arm drop
     from tick 2 committed even though the engine was never authorized at any point.
   - `test_tickCompletesWithNoOpPoster` — a trivial no-op `RecordingNotificationPoster`
     (any authorization value) → `await engine.tick(alerts:)` returns normally without
     throwing/crashing for a red alert count 5. **Scope note, stated honestly rather than
     overclaimed:** because `NotificationPoster.post`/`ensureAuthorized` are not `throws`
     (T3), `tick` has no actual failure path to catch here — this test documents that `tick`
     is not itself a throwing function by construction, nothing more. The spec's "a poll
     failure degrades silently" invariant, for the genuine failure path (a repository read
     throwing), is verified only by code inspection and a manual smoke test at T5 (T5 has no
     unit test target — see Resolved Decision 3); it is not re-verified automatically here,
     and this task does not claim otherwise.
   Run `swift test --filter AlertMonitorEngineTests` → FAIL (type undefined).
2. GREEN — implement `AlertMonitorEngine` per the pseudocode above. Run → PASS.
3. Commit.

**Acceptance test command:**
```
swift test --filter AlertMonitorEngineTests
```

**Commit message:** `T4: AlertMonitorEngine permission-gated fire/post orchestration`

---

### T5 — `LariatApp/AlertMonitor.swift`: the app-facing singleton + 45 s loop

**Description.** New `@Observable @MainActor final class AlertMonitor` (singleton,
`static let shared`), a peer to `BoardPollerHub` in the sense of "its own independent
static instance holding its own state" — but it does **not** reuse `BoardPoller`'s loop
(that loop hard-codes 3 s/15 s foreground/background cadence via platform-specific
activation notifications, which directly contradicts this feature's "independent of app
foreground/background state" requirement — confirmed by reading `BoardPoller.swift` in
full, including its `#if canImport(AppKit) ... #elseif canImport(UIKit)` branching).
`AlertMonitor` owns a bespoke `Task`-based loop on a fixed 45 s cadence, plus one
`AlertMonitorEngine` (T4) constructed with `SystemNotificationPoster()` (T3) by default.

```swift
@Observable @MainActor
final class AlertMonitor {
    static let shared = AlertMonitor()
    func start(db: LariatDatabase, writeDb: LariatWriteDatabase?, navigate: @escaping (String) -> Void)
    func stop()
}
```

Each tick:
1. `let locationId = LocationScope.resolve()`
2. `async let bundleResult = CommandRepository(database: db, locationId: locationId).fetch(today: today)`
3. Cooling read, guarded: if `writeDb` is `nil`, skip entirely and use `coolingOverdueCount
   = 0` (mirrors this codebase's existing graceful-degrade posture, e.g. `marginMoves`
   degrading to `.zero` on query error in `CommandView.swift`); else
   `async let coolingResult = CoolingRepository(readDB: db, writeDB: writeDb!).load()`,
   and on `throw`, degrade to `0` (never let a cooling-read failure crash the tick —
   Invariant: "a poll failure degrades silently").
4. `let summary = CommandCompute.summarize(bundle:, locationId:, today:, coolingOverdueCount:)`
   (T1's new parameter), `let alerts = CommandCompute.alertsFor(summary)`.
5. `await engine.tick(alerts: alerts)` (T4 does all the interesting work).
6. Any thrown error from steps 2-4 is caught and logged only — never re-thrown, never
   itself posts a notification (Invariant).

`start()` guards against double-start (a second call while a loop `Task` is already
running is a no-op) — matches `BoardPoller`'s "starts/restarts" framing being unnecessary
here since this loop never needs a different interval or to be restarted mid-flight (no
board-switch concept applies to an app-wide singleton). `navigate` is stored for T7's
delegate to use later; T5 itself does not call it (T5 has no tap-handling code — the
adapter class is a delegate, not part of the loop).

**Paths touched:**
- `LariatNative/Sources/LariatApp/AlertMonitor.swift` (new)

**MUST NOT modify:**
- `LariatNative/Sources/LariatApp/LariatApp.swift` (wiring is T6)
- `LariatNative/Sources/LariatApp/CommandView.swift` (AlertMonitor is an independent
  poller — it must NOT be folded into `CommandViewModel`/`CommandView`)
- `LariatNative/Sources/LariatApp/BoardPoller.swift` (read for reference only; not reused,
  not edited)
- `LariatNative/Sources/LariatApp/FeatureRegistry.swift`,
  `LariatNative/Sources/LariatApp/ManagerFeatures.swift`,
  `LariatNative/Sources/LariatModel/FeatureCatalog.swift` (not needed — the id is already
  a hardcoded constant from T3)
- anything under `LariatNative/Sources/LariatModel/` or `LariatNative/Sources/LariatDB/`
- `LariatNative/Package.swift`
- **this round is macOS-only.** Do not add `#if canImport(UIKit)` or any iOS/iPadOS-specific
  branches to `AlertMonitor.swift`, even though `BoardPoller.swift` itself is cross-platform
  for its own (unrelated) polling cadence and `Package.swift` does declare `.iOS(.v17)` as a
  real target platform. iPad is an explicit non-goal this round (H7 accessibility sweep,
  separate future wave) — do not reintroduce it here "for consistency with BoardPoller."
- **do not create any file not listed in "Paths touched" above** (scope discipline, see
  preamble)

**Dependencies:** T1 (`summarize`'s `coolingOverdueCount` parameter), T3
(`SystemNotificationPoster` — constructed directly here as the engine's default poster),
T4 (`AlertMonitorEngine`).

**Test posture (explicit, not glossed over):** there is no `LariatAppTests` target
(Resolved Decision 3), and after extracting T2/T3/T4, this file has no independently
branchable logic left to unit-test beyond "construct two repositories, `async let` them,
and call an already-tested engine" — the exact same posture as the existing, untested
`BoardPoller.swift` and `CommandViewModel` in this codebase. Its acceptance gate is a clean
build, consistent with that precedent.

**Steps:**
1. Write `AlertMonitor.swift` per the design above.
2. `swift build` → clean compile.
3. Commit.

**Acceptance test command:**
```
swift build
```

**Commit message:** `T5: AlertMonitor singleton — 45s loop, CoolingRepository read, engine wiring`

---

### T6 — wire `AlertMonitor` into `LariatApp.swift`'s `rootView`

**Description.** Small, additive `.task` modifier inside the existing `if let db =
sharedDatabase { ... }` branch of `rootView` (`LariatApp.swift:158-202`), sharing the same
`{ selectedId = $0 }` closure pattern already built inline for `AppContext.navigate` at
line 165 (this MUST live inside `rootView`, not `LariatApp.init()`, because `selectedId`
is `@State` and is only capturable/mutable from within the view-body context — confirmed
by reading `init()`, which does no such wiring today):

```swift
NavigationSplitView { ... } detail: { ... }
  .task {
    AlertMonitor.shared.start(db: db, writeDb: sharedWriteDatabase, navigate: { selectedId = $0 })
  }
```

attached alongside the existing `.safeAreaInset` modifiers on the `detail:` content (or on
the `NavigationSplitView` itself — either attachment point is inside the healthy `if let
db` branch and is equivalent for `.task`'s lifetime semantics; pick whichever reads more
naturally next to the existing modifier chain). Does **not** touch the `else { TileDegrade
(...) }` branch — there is no database to poll if `sharedDatabase` failed to open.

**Paths touched:**
- `LariatNative/Sources/LariatApp/LariatApp.swift`

**MUST NOT modify:**
- `LariatNative/Sources/LariatApp/AlertMonitor.swift` (T5 — consume only, do not add logic
  here)
- `LariatNative/Sources/LariatApp/CommandView.swift`
- `LariatNative/Sources/LariatApp/FeatureRegistry.swift`,
  `LariatNative/Sources/LariatApp/ManagerFeatures.swift`
- `LariatNative/Sources/LariatApp/BoardPoller.swift`
- anything under `LariatNative/Sources/LariatModel/` or `LariatNative/Sources/LariatDB/`
- `LariatNative/Package.swift`
- **MUST NOT add any new `Scene` to `LariatApp.body`** — no `Settings { }`, no
  `MenuBarExtra { }`, no additional `WindowGroup { }`. `LariatApp.body` currently declares a
  single `WindowGroup` (confirmed); this is exactly where a settings/mute-toggle screen or a
  menu-bar extra would naturally get added "while already in the file," and both are
  explicit spec non-goals for this round (H6b/H6c). **The only permitted change to this
  file is the single `.task` modifier described above.**
- **do not create any file** — T6 modifies an existing file only (scope discipline, see
  preamble)

**Dependencies:** T5.

**Test posture:** same as T5 — one line of glue with no branching logic; acceptance is a
clean build. Manual smoke check (not a gate, documented for the human reviewer): launch
`swift run LariatApp`, confirm no crash/hang on startup and that other boards still behave
normally (the `.task` addition must be provably inert to every other feature).

**Steps:**
1. Add the `.task` modifier.
2. `swift build` → clean compile.
3. Commit.

**Acceptance test command:**
```
swift build
```

**Commit message:** `T6: start AlertMonitor from LariatApp.rootView`

---

### T7 — `UNUserNotificationCenterDelegate` tap-to-navigate + foreground-presentation adapter

**Description.** Small new delegate class. **Implements both required delegate methods**
— an earlier draft of this plan implemented only the tap handler, which (per Resolved
Decision 6) would have silently suppressed every visible banner while the app is
foreground/active on a different board — exactly the spec's primary scenario:

```swift
final class AlertNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    private let navigate: (String) -> Void
    init(navigate: @escaping (String) -> Void) { self.navigate = navigate }

    /// Without this, the system suppresses the banner/sound entirely while the app is
    /// foreground/active (Resolved Decision 6) — this feature's whole point is alerting an
    /// operator who is looking at a *different* board, i.e. the app IS frontmost.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .list])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        navigate(AlertNotificationRouting.commandFeatureId)   // T3's constant — "manager.command"
        completionHandler()
    }
}
```

`AlertMonitor.start(...)` (T5's file, extended here) constructs one
`AlertNotificationDelegate(navigate: navigate)` and sets
`UNUserNotificationCenter.current().delegate = adapter` (retaining it on `self` so it
outlives the call — `UNUserNotificationCenter.delegate` is `weak`).

**Paths touched:**
- `LariatNative/Sources/LariatApp/AlertNotificationDelegate.swift` (new)
- `LariatNative/Sources/LariatApp/AlertMonitor.swift` (extend `start()` with the one-line
  delegate assignment + retained property; this is the only permitted edit to a file
  T5 already created)

**MUST NOT modify:**
- `LariatNative/Sources/LariatApp/LariatApp.swift` (T6's wiring stays as-is)
- `LariatNative/Sources/LariatApp/CommandView.swift`
- `LariatNative/Sources/LariatModel/NotificationPoster.swift` (T3 — consume the routing
  constant, do not add new routing logic, and do not add any `UNNotificationCategory`/
  `UNNotificationAction` here either — same guardrail as T3)
- `LariatNative/Sources/LariatModel/FeatureCatalog.swift`,
  `LariatNative/Sources/LariatApp/FeatureRegistry.swift`,
  `LariatNative/Sources/LariatApp/ManagerFeatures.swift`
- `LariatNative/Package.swift`
- **do not create any file not listed in "Paths touched" above** (scope discipline, see
  preamble)

**Dependencies:** T3 (`AlertNotificationRouting.commandFeatureId`), T5 (`AlertMonitor` to
extend).

**Test posture:** same reasoning as T5/T6 — a `UNUserNotificationCenterDelegate` callback
cannot be triggered by a real `UNNotificationResponse`/`UNNotification` in a unit test (no
public initializer; requires the live notification-center round trip), and the one piece
of actual logic (which feature id to navigate to) is already unit-tested as
`AlertNotificationRouting.commandFeatureId` in T3. Acceptance is a clean build. **Manual
smoke check (documented, not a gate) — now explicitly two scenarios, not one:**
1. *Foreground scenario (the primary one, per Resolved Decision 6):* trigger a real red
   alert while the app is frontmost on a board other than Command (e.g. temporarily lower
   `redNoShowThreshold` or seed a breach while viewing KDS/86/prep); confirm a banner
   actually appears (this is the scenario the earlier draft would have silently failed).
2. *Background scenario:* background the app, wait for the notification, click it, confirm
   the app activates and navigates to Command.

**Steps:**
1. Write `AlertNotificationDelegate.swift` with both delegate methods.
2. Extend `AlertMonitor.start()` with the delegate assignment.
3. `swift build` → clean compile.
4. Commit.

**Acceptance test command:**
```
swift build
```

**Commit message:** `T7: UNUserNotificationCenterDelegate tap-to-navigate + foreground-presentation adapter`

---

### T8 — final verification

**Description.** Full-suite build + test, plus a **scripted** scope check (not a manual
eyeball pass) that only the paths named across T1-T7 (and this plan/spec doc) changed.

**Paths touched:** none (verification only; fix-forward commits if this task finds a
problem should go back to the offending task's own commit lineage, not be tacked onto T8).

**Dependencies:** T1-T7 all committed.

**Steps:**
1. `swift build` → clean.
2. `swift test` (full suite, no filter) → all green; record the total test count before
   and after this branch (compare against `main` to confirm only additive test counts:
   T1 adds 3, T2 adds 5, T3 adds 3, T4 adds **7** — **18 new tests**, zero removed/changed
   existing tests). (T4's count is 7, not 6, per the `test_rearmClearsEvenWhileUnauthorized`
   test added during review — see T4.)
3. Run the scope check as an actual pass/fail script, not prose:
   ```bash
   git fetch
   base=$(git merge-base origin/main HEAD)

   expected=$(cat <<'EOF'
   LariatNative/Sources/LariatModel/Compute/CommandCompute.swift
   LariatNative/Tests/LariatModelTests/CommandComputeTests.swift
   LariatNative/Sources/LariatModel/Compute/AlertMonitorCompute.swift
   LariatNative/Tests/LariatModelTests/AlertMonitorComputeTests.swift
   LariatNative/Sources/LariatModel/NotificationPoster.swift
   LariatNative/Tests/LariatModelTests/NotificationPosterTests.swift
   LariatNative/Sources/LariatModel/AlertMonitorEngine.swift
   LariatNative/Tests/LariatModelTests/AlertMonitorEngineTests.swift
   LariatNative/Sources/LariatApp/AlertMonitor.swift
   LariatNative/Sources/LariatApp/LariatApp.swift
   LariatNative/Sources/LariatApp/AlertNotificationDelegate.swift
   EOF
   )

   actual=$(git diff --name-only "$base" -- LariatNative)

   if diff <(echo "$expected" | sort) <(echo "$actual" | sort) > /tmp/scope-diff.txt; then
     echo "SCOPE OK — exactly the expected 11 files changed under LariatNative/"
   else
     echo "SCOPE VIOLATION — unexpected file set under LariatNative/:"
     cat /tmp/scope-diff.txt
     exit 1
   fi
   ```
   If this exits non-zero (in particular if `Package.swift`, any web `app/**`/`lib/**`
   path, or `data/lariat.db` shows up), **stop and investigate before proceeding** — that
   is an out-of-scope edit per this plan's worktree/scope contract.
4. Also confirm
   `git diff --name-status "$base" -- docs/superpowers/` shows only this plan file (and the
   already-approved spec, unmodified).
5. Open a PR (spec + plan links, test-count evidence, scope-check evidence — paste the
   `SCOPE OK` output). Do **not** auto-merge — per repo convention (`CLAUDE.md`: never push
   directly to `main`).

**Acceptance test commands:**
```
swift build && swift test
git fetch
git diff --name-status $(git merge-base origin/main HEAD) -- LariatNative
git diff --name-status $(git merge-base origin/main HEAD) -- docs/superpowers/
```
(plus the scripted scope-check block in step 3 above)

**Commit message:** none (T8 is verification-only; if it uncovers a defect, fix it under
the originating task's id as a new commit, e.g. `T4: fix ...`, not under `T8`).

---

## Self-review

**Spec coverage:** cooling-overdue red source (T1) ✓; pure diff/peak/re-arm state machine
with all 5 spec-listed test cases (T2) ✓; injectable `NotificationPoster` boundary +
production impl + tap-routing constant (T3) ✓; permission-gating / lazy-request /
denied-silently-continues / catch-up-on-later-grant (T4, an explicit decomposition beyond
the spec's literal three components, justified by the "no LariatApp test target" finding;
its authorization-caching algorithm was corrected during review — see Resolved Decision 7
— to actually satisfy the catch-up-on-later-grant invariant it claims to test) ✓; 45 s
bespoke loop independent of foreground/background, real repository wiring, graceful
cooling-read degradation (T5) ✓; `.task` wiring inside `rootView`'s healthy branch (T6) ✓;
tap-to-navigate **and foreground-presentation** delegate (T7, the latter added during
review per Resolved Decision 6 — without it the spec's primary "different board,
foreground app" scenario would have silently produced no visible notification) ✓; both
Open Questions resolved with direct file citations, no re-investigation task needed
(preamble) ✓; final build+test+**scripted** scope verification (T8) ✓.

**Deviations/additions beyond the spec's literal prose, all called out above with
reasoning:** `CommandSummary.coolingOverdueCount`'s home (nested vs. top-level — nested,
chosen); `NotificationPoster` as a protocol not a closure typealias (chosen, with
reasoning); `AlertMonitorEngine` as a fourth, `LariatModel`-resident component not in the
spec's literal three (added, because no `LariatAppTests` target exists); peak-freeze-while-
denied semantics (pinned down, spec left it implicit); **foreground-presentation handling
via `willPresent` (added — closes a critical gap the spec's prose didn't call out
explicitly but its Goal section requires)**; **asymmetric authorization-check caching
(corrected — an earlier draft's "check once, cache forever" design contradicted the spec's
own catch-up-on-later-grant invariant and its own required test)**.

**Adversarial-review fixes applied in this revision (for traceability):**
- Critical: T7 now implements `willPresent` (Resolved Decision 6) — was previously missing
  entirely, which would have silently broken the feature's primary use case.
- Major: T4's authorization-caching algorithm rewritten as asymmetric (sticky-true-only)
  caching (Resolved Decision 7), with corrected pseudocode and a re-walked trace of both
  `test_firstCandidate_requestsAuthorizationLazily` and
  `test_deniedThenGrantedLater_firesCatchUpExactlyOnce` confirming both now pass under the
  same algorithm.
- Major: plan header's "TDD throughout" claim rescoped to T1-T4 explicitly, with T5-T7's
  build-only gate stated as a deliberate, precedent-matched choice rather than a silent
  exception to an overclaimed rule.
- Major: T6 gained an explicit guardrail against adding any new `Scene` (`Settings{}`,
  `MenuBarExtra{}`, extra `WindowGroup{}`) — the file it's allowed to edit is exactly where
  three of the five spec non-goals would most naturally get reintroduced.
- Major: T3 gained an explicit guardrail against `UNNotificationCategory`/`UNNotificationAction`
  registration and per-source preference persistence — the file it's allowed to author is
  exactly where the "settings UI to mute individual sources" non-goal could get reintroduced
  in miniature.
- Minor (fixed): T5's dependency list now includes T3 (it constructs
  `SystemNotificationPoster()` directly).
- Minor (fixed): T4 gained a 7th test, `test_rearmClearsEvenWhileUnauthorized`, closing a
  gap where Resolved Decision 4's "re-arm always clears regardless of authorization" clause
  had no corresponding test.
- Minor (fixed): the former `test_pollFailureDegradesSilently` was renamed
  `test_tickCompletesWithNoOpPoster` and its description no longer overclaims — it now
  states plainly that `tick` has nothing to catch (poster methods aren't `throws`) and that
  real I/O-failure coverage lives only at T5 (inspection + manual smoke test, not automated).
- Minor (fixed): T5 gained an explicit "macOS-only, no `#if canImport(UIKit)`" guardrail,
  since `BoardPoller.swift` (its stated reference point) is genuinely cross-platform and
  `Package.swift` genuinely declares an iOS target.
- Minor (fixed): added a blanket "do not create files outside this task's listed paths"
  rule in the preamble, repeated in every task's MUST NOT list, and T8's scope check is now
  a scripted pass/fail block instead of prose ("stop and investigate").
- Minor (flagged, not fixed — judged not worth the added scope): `RecordingNotificationPoster`
  ships as a `public` type in the release `LariatModel` library surface; T3 now explicitly
  notes this as a deliberate, flagged tradeoff for a possible future cleanup pass.

---

*This document is the reconciled final plan after three independent adversarial reviews
(coverage-vs-spec, TDD/dependency-ordering, and scope-contract-vs-non-goals). Every
critical and major finding was fixed directly in the plan above; minor findings were either
fixed (where cheap) or explicitly flagged with a note for the implementer/reviewer.*
