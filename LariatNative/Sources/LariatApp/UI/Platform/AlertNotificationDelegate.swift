import Foundation
import UserNotifications
import LariatModel

/// H6a — implements BOTH required delegate methods. `willPresent` is not
/// optional here: once any `UNUserNotificationCenterDelegate` is set (which
/// this is, to handle the tap), the system suppresses the banner/sound
/// entirely while the app is foreground/active UNLESS the delegate calls the
/// completion handler with presentation options. This feature's whole point
/// is alerting an operator who is looking at a *different* board — i.e. the
/// app IS frontmost — so without `willPresent` every notification in the
/// primary use case would silently produce nothing visible.
final class AlertNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    private let navigate: (String) -> Void

    init(navigate: @escaping (String) -> Void) {
        self.navigate = navigate
    }

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
        navigate(AlertNotificationRouting.commandFeatureId)
        completionHandler()
    }
}
