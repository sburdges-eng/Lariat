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
///   - pause while the app is inactive (`NSApplication.didResignActiveNotification`
///     on macOS, `UIApplication.willResignActiveNotification` on iOS), with an
///     immediate re-fire on re-activation,
///   - published freshness state (`lastSuccess`, `isStale`, `isPaused`) that the
///     shell's `PollFreshnessIndicator` renders for the active board.
@Observable @MainActor
final class BoardPoller {
    /// Established cross-process cadence (endgame §6.5).
    nonisolated static let defaultInterval: Duration = .seconds(3)
    /// Backoff ceiling: a broken read path retries every 30 s, not every 3 s.
    nonisolated static let backoffCap: Duration = .seconds(30)
    /// While the app is inactive the loop skips polling and re-checks on this
    /// cadence (resume latency; the become-active notification usually beats it).
    private nonisolated static let inactiveRecheck: Duration = .milliseconds(500)

    /// Wall-clock time of the last successful poll action. `nil` until the
    /// first success after `start()`.
    private(set) var lastSuccess: Date?
    /// True while polling is suspended because the app is inactive.
    private(set) var isPaused = false
    /// The interval passed to `start` (drives the staleness threshold).
    private(set) var interval: Duration = BoardPoller.defaultInterval

    /// Stale = the last successful refresh is older than 3× the poll interval
    /// (i.e. at least two consecutive cycles have failed or been delayed).
    var isStale: Bool {
        guard let lastSuccess else { return false }
        return Date().timeIntervalSince(lastSuccess) > staleAfterSeconds
    }

    /// Staleness threshold in seconds (3× interval), exposed for the indicator.
    var staleAfterSeconds: TimeInterval { 3 * Self.seconds(of: interval) }

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
    /// `interval` while the app is active. Registers this poller as the active
    /// board's poller for the shell freshness indicator and ⌘R.
    func start(
        interval: Duration = BoardPoller.defaultInterval,
        action: @escaping @MainActor () async throws -> Void
    ) {
        self.interval = interval
        self.action = action
        BoardPollerHub.shared.activate(self)
        startLoop()
    }

    /// Stop polling and deregister from the hub.
    func stop() {
        loopTask?.cancel()
        loopTask = nil
        action = nil
        isPaused = false
        BoardPollerHub.shared.deactivate(self)
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
            var delay = self?.interval ?? BoardPoller.defaultInterval
            while !Task.isCancelled {
                guard let self, let action = self.action else { return }
                guard self.appIsActive else {
                    // Inactive: skip the query entirely; the become-active
                    // notification restarts the loop for an immediate refresh.
                    self.isPaused = true
                    try? await Task.sleep(for: Self.inactiveRecheck)
                    continue
                }
                self.isPaused = false
                do {
                    try await action()
                    self.lastSuccess = Date()
                    delay = self.interval
                    try? await Task.sleep(for: delay)
                } catch is CancellationError {
                    return
                } catch {
                    // Exponential backoff: wait the current delay, then double
                    // it for the next failure (3 s → 6 s → 12 s → … cap 30 s).
                    // The next success resets the delay to the base interval.
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
                self?.appIsActive = false
            }
        })
        activationObservers.append(center.addObserver(
            forName: becomeName, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.appIsActive = true
                // Refresh immediately so the board is fresh the moment the
                // operator comes back (also resets any error backoff).
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

/// Tracks the poller of the board currently on screen so generic shell chrome
/// (freshness indicator, ⌘R "Refresh Now") can reach it without the shell
/// knowing any feature — pollers self-register in `start()`/`stop()`, exactly
/// like features self-register in `FeatureRegistry` (A0 pattern).
@Observable @MainActor
final class BoardPollerHub {
    static let shared = BoardPollerHub()

    /// The most recently started, still-running poller — i.e. the active board's.
    private(set) var active: BoardPoller?

    fileprivate func activate(_ poller: BoardPoller) {
        active = poller
    }

    fileprivate func deactivate(_ poller: BoardPoller) {
        if active === poller { active = nil }
    }
}
