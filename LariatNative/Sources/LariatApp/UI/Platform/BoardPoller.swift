import Foundation
import Observation
#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

/// Thrown by a board's poll action when its `refresh()` captured a load failure
/// into a published error field instead of throwing (the established view-model
/// pattern). Feeds `BoardPoller`'s backoff without changing refresh semantics.
enum BoardPollError: Error {
    case refreshFailed(String)
}

/// Endgame H5: the one shared poll loop behind every board.
///
/// Boards poll because GRDB `ValueObservation` cannot see the web app's
/// cross-process writes (endgame spec §6.5); 3 s is the established cadence and
/// keeps the required ≤5 s data freshness on active boards. On top of the plain
/// loop this adds:
///   - exponential backoff on thrown errors (3 s → 6 s → 12 s → … capped at
///     30 s, reset on the next success),
///   - a slower background cadence while the app is inactive
///     (`NSApplication.didResignActiveNotification` on macOS,
///     `UIApplication.willResignActiveNotification` on iOS) — a board left
///     visible on a second display or wall-mounted Mac (KDS / 86 board) must
///     keep updating while the operator works in another app, so polling never
///     fully pauses; it degrades to 15 s and snaps back (with an immediate
///     re-poll) on re-activation,
///   - published freshness state (`lastSuccess`, `isStale`, `isBackgrounded`)
///     that the shell's `PollFreshnessIndicator` renders for the active board.
@Observable @MainActor
final class BoardPoller {
    /// Established cross-process cadence (endgame §6.5).
    nonisolated static let defaultInterval: Duration = .seconds(3)
    /// Backoff ceiling: a broken read path retries every 30 s, not every 3 s.
    nonisolated static let backoffCap: Duration = .seconds(30)
    /// Cadence while the app is inactive: slow enough to stay cheap in the
    /// background, fast enough that a visible-but-unfocused board (second
    /// display / wall-mounted deployment) never looks frozen.
    nonisolated static let backgroundInterval: Duration = .seconds(15)

    /// Wall-clock time of the last successful poll action. `nil` until the
    /// first success after `start()`.
    private(set) var lastSuccess: Date?
    /// True while the app is inactive and the loop is on the slower
    /// `backgroundInterval` cadence (data still flows).
    private(set) var isBackgrounded = false
    /// The interval passed to `start` (drives the staleness threshold).
    private(set) var interval: Duration = BoardPoller.defaultInterval

    /// Stale = the last successful refresh is older than 3× the effective poll
    /// interval (i.e. at least two consecutive cycles have failed or been
    /// delayed). While backgrounded the threshold scales with the slower
    /// cadence so the deliberate 15 s gap does not read as a failure.
    var isStale: Bool {
        guard let lastSuccess else { return false }
        return Date().timeIntervalSince(lastSuccess) > staleAfterSeconds
    }

    /// Staleness threshold in seconds (3× effective interval), exposed for the
    /// indicator.
    var staleAfterSeconds: TimeInterval { 3 * Self.seconds(of: effectiveInterval) }

    /// The cadence the loop is currently honoring: the board's own interval in
    /// the foreground, and never faster than `backgroundInterval` while inactive.
    private var effectiveInterval: Duration {
        appIsActive ? interval : max(interval, Self.backgroundInterval)
    }

    @ObservationIgnored private var action: (@MainActor () async throws -> Void)?
    @ObservationIgnored private var loopTask: Task<Void, Never>?
    @ObservationIgnored private var appIsActive = true
    @ObservationIgnored private var activationObservers: [NSObjectProtocol] = []

    init() {
        observeActivation()
    }

    deinit {
        loopTask?.cancel()
        for observer in activationObservers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    /// Start (or restart) the poll loop. Fires `action` immediately, then every
    /// `interval` while the app is active. H6d: the board publishes itself as its
    /// window's active poller via the `.tracksActiveBoard` preference (per window),
    /// so there is no global self-registration here anymore.
    func start(
        interval: Duration = BoardPoller.defaultInterval,
        action: @escaping @MainActor () async throws -> Void
    ) {
        self.interval = interval
        self.action = action
        startLoop()
    }

    /// Stop polling.
    func stop() {
        loopTask?.cancel()
        loopTask = nil
        action = nil
        isBackgrounded = false
    }

    /// Fire the poll action right now (⌘R). Restarting the loop both refreshes
    /// immediately and resets any error backoff.
    func refreshNow() {
        guard action != nil else { return }
        startLoop()
    }

    /// Bridge for view models whose `refresh()` captures load failures into a
    /// published field (`fetchError`/`errorText`) instead of throwing: call this
    /// right after `refresh()` inside the poll action so a captured failure
    /// feeds the backoff. No-op when the refresh succeeded (field is nil).
    static func throwIfFailed(_ capturedError: String?) throws {
        if let capturedError {
            throw BoardPollError.refreshFailed(capturedError)
        }
    }

    // MARK: - Loop

    private func startLoop() {
        loopTask?.cancel()
        loopTask = Task { [weak self] in
            var delay = self?.effectiveInterval ?? BoardPoller.defaultInterval
            while !Task.isCancelled {
                guard let self, let action = self.action else { return }
                self.isBackgrounded = !self.appIsActive
                do {
                    try await action()
                    self.lastSuccess = Date()
                    delay = self.effectiveInterval
                    try? await Task.sleep(for: delay)
                } catch is CancellationError {
                    return
                } catch {
                    // Exponential backoff: wait the current delay, then double
                    // it for the next failure (3 s → 6 s → 12 s → … cap 30 s).
                    // The next success resets the delay to the effective interval.
                    try? await Task.sleep(for: delay)
                    delay = min(delay * 2, Self.backoffCap)
                }
            }
        }
    }

    // MARK: - App activation

    private func observeActivation() {
        #if canImport(AppKit)
        let resignName = NSApplication.didResignActiveNotification
        let becomeName = NSApplication.didBecomeActiveNotification
        #elseif canImport(UIKit)
        let resignName = UIApplication.willResignActiveNotification
        let becomeName = UIApplication.didBecomeActiveNotification
        #endif
        let center = NotificationCenter.default
        activationObservers.append(center.addObserver(
            forName: resignName, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.appIsActive = false
                // The loop keeps running (background cadence); reflect the
                // degraded state immediately rather than at the next wake.
                if self.loopTask != nil { self.isBackgrounded = true }
            }
        })
        activationObservers.append(center.addObserver(
            forName: becomeName, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.appIsActive = true
                self.isBackgrounded = false
                // Refresh immediately so the board is fresh the moment the
                // operator comes back (also resets any error backoff and the
                // slower background cadence).
                if self.loopTask != nil { self.startLoop() }
            }
        })
    }

    private static func seconds(of duration: Duration) -> TimeInterval {
        let components = duration.components
        return TimeInterval(components.seconds)
            + TimeInterval(components.attoseconds) / 1e18
    }
}
// H6d: `BoardPollerHub` (the global "most-recently-started poller" singleton) was
// deleted. It could only ever track one active poller app-wide, so with multiple
// windows every window's freshness chip + ⌘R targeted the same board. Each board
// now publishes its poller to *its* window via the `.tracksActiveBoard` preference
// (see MultiWindowPlumbing / RootWindowView); commands read the key window's via
// `@FocusedValue(\.activeBoardPoller)`.
