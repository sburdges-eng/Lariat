import Foundation
import UserNotifications

// H6a — local notifications for red signals. The posting boundary: real
// UNUserNotificationCenter usage is wrapped here so AlertMonitorEngine (T4)
// can be tested against a recording double instead of the real system API —
// same injectable-seam pattern as BeoCascadeClient.Runner, adapted to a
// protocol since this boundary needs two independent operations rather than
// one.
public protocol NotificationPoster: Sendable {
    /// Checks current `UNAuthorizationStatus`; if `.notDetermined`, requests
    /// it. Returns whether posting is currently allowed. Must be safe to call
    /// repeatedly (only the FIRST call after a `.notDetermined` state actually
    /// prompts). Must reflect the CURRENT status on every call — caching
    /// across calls is AlertMonitorEngine's job, not this protocol's.
    func ensureAuthorized() async -> Bool

    /// Posts (or replaces, by `identifier`) a notification. `identifier` is
    /// always `CommandAlert.source` — `UNUserNotificationCenter.add` natively
    /// replaces any pending request with the same identifier, which is the
    /// entire "replace, don't stack" dedup mechanism; no manual bookkeeping
    /// beyond the peak-tracking dictionary in AlertMonitorCompute/Engine.
    func post(identifier: String, message: String) async
}

/// `UNUserNotificationCenter.current()` throws an uncatchable
/// `NSInternalInconsistencyException` ("bundleProxyForCurrentProcess is nil")
/// when the running process has no real bundle identity — an unbundled
/// `swift run LariatApp` executable (this project's standard dev-loop launch
/// command) is exactly that case; only a properly packaged `.app` (see H8,
/// `Scripts/package-app.sh`) has one. `Bundle.main.bundleIdentifier` is `nil`
/// in precisely the crashing case, so it's the cheapest reliable proxy check.
/// Discovered live via a manual launch smoke test after H6a first merged.
public enum NotificationEnvironment {
    public static func canUseNotifications(bundleIdentifier: String?) -> Bool {
        bundleIdentifier != nil
    }
}

public struct SystemNotificationPoster: NotificationPoster {
    public init() {}

    public func ensureAuthorized() async -> Bool {
        guard NotificationEnvironment.canUseNotifications(bundleIdentifier: Bundle.main.bundleIdentifier) else {
            return false
        }
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .notDetermined:
            return (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        case .denied:
            return false
        @unknown default:
            return false
        }
    }

    public func post(identifier: String, message: String) async {
        guard NotificationEnvironment.canUseNotifications(bundleIdentifier: Bundle.main.bundleIdentifier) else {
            return
        }
        let content = UNMutableNotificationContent()
        content.title = message
        content.body = message
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }
}

/// v1: every alert tap navigates to the same board (Command) — see the H6a
/// spec's "User-facing surface" §Tap action. Resolved against
/// FeatureCatalog.swift / FeatureRegistry.swift / ManagerFeatures.swift.
public enum AlertNotificationRouting {
    public static let commandFeatureId = "manager.command"
}

/// Test-only recording double — no dedicated test-support target exists in
/// this codebase, so this lives here (public) rather than behind a
/// compilation guard; a documented, deliberate tradeoff (see the H6a plan).
public final class RecordingNotificationPoster: NotificationPoster, @unchecked Sendable {
    public var authorizedToReturn: Bool
    public private(set) var postedIdentifiers: [String] = []
    public private(set) var postedMessages: [String] = []
    public private(set) var ensureAuthorizedCallCount = 0

    public init(authorizedToReturn: Bool) {
        self.authorizedToReturn = authorizedToReturn
    }

    public func ensureAuthorized() async -> Bool {
        ensureAuthorizedCallCount += 1
        return authorizedToReturn
    }

    public func post(identifier: String, message: String) async {
        postedIdentifiers.append(identifier)
        postedMessages.append(message)
    }
}
