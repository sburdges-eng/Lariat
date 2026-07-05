# LariatNative H6a — local notifications for red signals

Date: 2026-07-04
Status: draft (awaiting review)
Parent: `docs/superpowers/specs/2026-07-02-lariat-native-endgame.md` §4 (H6 Platform integration)

## Goal

Extend the native macOS app so an operator gets a system notification the moment any
`.red`-severity `CommandAlert` first appears (or worsens), even while working a completely
different board (KDS, 86, prep) — the first slice of the H6 "platform integration" holistic-bar
item. This is a native-only capability with no web equivalent; there is no parity oracle to port.
Also closes a named gap: the endgame doc calls out "cooling overdue" as an example signal, but
`CommandCompute.alertsFor` has no such source today — cooling-batch compliance is tracked by
`CoolingCompute` but never rolls up into an alert.

## Non-goals (out of scope this round)

- Native printing, menu-bar extra, multi-window (H6b/H6c) — separate future waves.
- iPad cook tier / H7 accessibility sweep — separate future waves (decided earlier this session).
- Per-signal notification preferences / a settings UI to mute individual sources — ship the
  simple always-on version; a preferences screen is a follow-up if actually wanted.
- Remote/push notifications or any cross-device/cross-process alert-state sync — purely local
  to one running app instance.
- Amber-severity notifications — red only, per the endgame doc's own framing ("red signals").

## User-facing surface

No new screen. New system notification per newly-red (or worsening) source:

- **Title/body:** the `CommandAlert.message` string verbatim (e.g. "3 temp readings out of
  range", "2 items 86'd").
- **Tap action:** brings the app to front and navigates to the Command board (same jump
  mechanism the ⌘K palette already uses via `FeatureRegistry`).

New `CommandAlert` red source: `cooling-overdue`, message `"\(n) cooling batch(es) overdue"` —
mirrors the existing red-source message/pluralization convention in `CommandCompute.alertsFor`.

## Data model deltas

None. No new tables/columns. `AlertMonitor` is a read-only in-memory poller over the same
repositories `CommandView`'s view model already reads, plus one new read: a count of
cooling batches in a breached compliance stage (via `CoolingCompute.scanOpenBatches` /
`classifyCoolingStage` — exact backing repository/query to be confirmed against
`CoolingRepository` at implementation time; see Open Questions).

## Components / architecture

- **`AlertMonitor`** (new, `LariatApp/AlertMonitor.swift`) — `@Observable @MainActor` singleton,
  a peer to `BoardPollerHub`, not a per-board poller. Holds two snapshots keyed by
  `CommandAlert.source`: `lastNotifiedPeak: [String: Int]` and derives presence from it (a key
  present with `peak > 0` means "currently armed/notified"). Exposes `start(db:, writeDb:,
  navigate:)` / `stop()`.
- **Poll loop:** fixed 45s cadence, independent of app foreground/background state (this is a
  passive background safety net, not a live board — it doesn't need `BoardPoller`'s 3s/15s
  dual-cadence dance). Each tick: read the same summary `CommandView`'s VM computes →
  `CommandCompute.alertsFor(summary)` → filter to `.red` → diff each source's `count` against
  `lastNotifiedPeak[source]` (missing key = 0):
  - `count > 0 && count > lastNotifiedPeak[source, default: 0]` → fire a notification, set
    `lastNotifiedPeak[source] = count`.
  - `count == 0` → remove the key entirely (re-arms; the next nonzero reading fires again).
  - `count > 0 && count <= lastNotifiedPeak[source]` → no-op (already notified at this severity).
- **`NotificationPoster` protocol** (new) — the injectable boundary, mirroring the
  `BeoCascadeClient.Runner` precedent: production implementation wraps
  `UNUserNotificationCenter.current()`; the test double just records calls. Keeps
  `AlertMonitorTests` free of any real notification-center interaction. The per-source
  "replace, don't stack" dedup (see Invariants) falls out for free: each request's
  `identifier` is set to the `CommandAlert.source` string, and `UNUserNotificationCenter.add`
  natively replaces any pending request with the same identifier — no manual bookkeeping needed
  beyond the `lastNotifiedPeak` dictionary itself.
- **Permission:** checked via `UNUserNotificationCenter.current().notificationSettings()`
  before the *first* candidate red alert; requests authorization lazily at that point (not at
  app launch). If denied, the monitor keeps computing diffs (so it doesn't silently break once
  granted later) but posts nothing.
- **Tap → navigate:** a small `UNUserNotificationCenterDelegate` adapter class calls the
  `navigate: (String) -> Void` closure passed into `start(...)` with Command's `FeatureDescriptor`
  id (exact id string to be confirmed against `FeatureCatalog.all` — see Open Questions).
- **Wiring:** started via a `.task` modifier on `LariatApp.rootView` (not inside `LariatApp.init()`
  — `selectedId` is `@State` and the closure `{ selectedId = $0 }` needs to run in the view
  context, exactly like `AppContext.navigate` is already built inline in `rootView`). This is a
  small, additive edit to `LariatApp.swift`; it does not touch the A0 feature-registration
  pattern the "never edit LariatApp.swift for board wiring" convention protects.
- **New `cooling-overdue` source:** added inside `CommandCompute.alertsFor`, reading a new
  `coolingOverdueCount` field threaded onto `CommandSummary` — same shape as the existing
  `foodSafety.tempBreaches` etc. fields.

## Invariants

- Never post while notification permission is denied; never request permission until there is
  an actual candidate alert to notify about.
- A source's peak only ratchets upward while nonzero; hitting exactly 0 fully clears it
  (re-arms for a fresh fire on the next nonzero reading — no "silence forever after first fire").
- At most one pending/delivered notification per source per polling tick — a source's repeat
  request replaces (not stacks on top of) any not-yet-delivered one for that same source.
- `AlertMonitor` never writes to the database — read-only, same posture as `CommandView`'s reads.
- A poll failure degrades silently (log only) — never crashes, never itself generates a
  notification about its own failure.

## Testing

- **`AlertMonitorTests`** (new, pure logic) — the diff/peak/re-arm state machine extracted as a
  pure function, e.g. `AlertMonitor.notificationsToFire(previousPeaks:, currentAlerts:) ->
  (fire: [CommandAlert], nextPeaks: [String: Int])`, tested against synthetic `CommandAlert`
  sequences with no Foundation notification API involved:
  - 0 → nonzero fires.
  - unchanged nonzero does not re-fire.
  - count increases past the previous peak fires again.
  - count drops to 0 then rises again fires again (re-arm).
  - amber sources never fire, regardless of count.
- **`CommandComputeTests`** — new cases for the `cooling-overdue` source: present with the
  right message/pluralization when the count is > 0; absent from the list at 0 (matching the
  `push` helper's existing `count > 0` gate).
- No web oracle — native-only feature; explicitly noted as intentional native/web divergence
  (this is where native gets *better* than web, not merely at parity), per the endgame doc's
  own framing of the holistic bar.

## Open questions

1. Exact `FeatureDescriptor.id` for the Command board, to pass as the tap-to-navigate target —
   confirm against `FeatureCatalog.all` before Task 1 starts (this doc assumes it exists as a
   single, unambiguous id).
2. Exact repository/query currently backing `CoolingCompute.scanOpenBatches`'s input rows, to
   wire `CommandSummary.coolingOverdueCount` — likely `CoolingRepository`, to be confirmed by
   reading it directly before Task 1 starts rather than assumed.
