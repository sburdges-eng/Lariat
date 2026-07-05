import Foundation
import Observation
import UserNotifications
import LariatDB
import LariatModel

/// H6a — local notifications for red signals. A dedicated app-level poller,
/// independent of which board is on screen: `BoardPoller` instances stop when
/// their board's view disappears (see CommandView.stop()), so notifications
/// for a red signal must not depend on the operator having Command open.
///
/// Deliberately does NOT reuse `BoardPoller`'s loop — that loop hard-codes a
/// 3 s/15 s foreground/background cadence via platform activation
/// notifications, which contradicts this feature's "independent of app
/// foreground/background state" requirement. This owns its own bespoke,
/// always-45s `Task` loop instead.
///
/// No independently-testable branches remain here once AlertMonitorCompute/
/// NotificationPoster/AlertMonitorEngine (LariatModel, all unit-tested) are
/// extracted — this file is "construct two repositories, `async let` them,
/// call an already-tested engine," the same untested-by-design posture as
/// `BoardPoller.swift` and `CommandViewModel`. Its acceptance gate is a clean
/// `swift build`.
@Observable @MainActor
final class AlertMonitor {
    static let shared = AlertMonitor()

    private static let tickInterval: Duration = .seconds(45)

    private let engine = AlertMonitorEngine(poster: SystemNotificationPoster())
    private var loopTask: Task<Void, Never>?
    private(set) var navigate: ((String) -> Void)?
    // Retained here — UNUserNotificationCenter.delegate is `weak`, so the
    // adapter would be deallocated immediately without this.
    private var notificationDelegate: AlertNotificationDelegate?

    private init() {}

    /// Starts the loop once; a second call while already running is a no-op
    /// (this is an app-wide singleton, not a per-board poller — there is no
    /// "switch boards, restart at a different interval" concept here).
    func start(db: LariatDatabase, writeDb: LariatWriteDatabase?, navigate: @escaping (String) -> Void) {
        self.navigate = navigate
        if notificationDelegate == nil,
           NotificationEnvironment.canUseNotifications(bundleIdentifier: Bundle.main.bundleIdentifier) {
            let delegate = AlertNotificationDelegate(navigate: navigate)
            notificationDelegate = delegate
            UNUserNotificationCenter.current().delegate = delegate
        }
        guard loopTask == nil else { return }
        loopTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.tick(db: db, writeDb: writeDb)
                try? await Task.sleep(for: Self.tickInterval)
            }
        }
    }

    func stop() {
        loopTask?.cancel()
        loopTask = nil
    }

    private func tick(db: LariatDatabase, writeDb: LariatWriteDatabase?) async {
        let locationId = LocationScope.resolve()
        let today = Self.todayISO()
        let commandRepo = CommandRepository(database: db, locationId: locationId)

        async let bundleResult = commandRepo.fetch(today: today)

        // Cooling read, guarded: no write handle means no CoolingRepository
        // (it requires both a read and write pool) — degrade to 0 rather than
        // skip the whole tick. A read failure degrades the same way; a
        // cooling-read problem must never crash the tick (poll failures
        // degrade silently).
        let coolingOverdueCount: Int
        if let writeDb {
            let coolingRepo = CoolingRepository(readDB: db, writeDB: writeDb)
            coolingOverdueCount = (try? await coolingRepo.load(locationId: locationId).scan.filter(\.breached).count) ?? 0
        } else {
            coolingOverdueCount = 0
        }

        do {
            let bundle = try await bundleResult
            let summary = CommandCompute.summarize(
                bundle: bundle,
                locationId: locationId,
                today: today,
                coolingOverdueCount: coolingOverdueCount
            )
            let alerts = CommandCompute.alertsFor(summary)
            await engine.tick(alerts: alerts)
        } catch {
            // Poll failure degrades silently — never crash, never itself post
            // a notification about its own failure.
        }
    }

    // Web parity: lib/db.ts `todayISO()` uses `new Date().toISOString().slice(0,10)`,
    // which is UTC — same fix as CommandViewModel.todayISO().
    private static let isoDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private static func todayISO() -> String {
        isoDateFormatter.string(from: Date())
    }
}
