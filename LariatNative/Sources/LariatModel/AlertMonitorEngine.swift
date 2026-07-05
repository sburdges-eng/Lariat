import Foundation

// H6a — permission-gated fire/post orchestration on top of
// AlertMonitorCompute's pure diff/peak/re-arm math. This is a decomposition
// beyond the H6a spec's literal three components: this codebase has no
// LariatAppTests target, so the "denied -> suppress; keeps computing;
// granted-later -> catch-up fire" behavior needs a LariatModel-resident home
// to be unit-tested without touching UNUserNotificationCenter for real.
public final class AlertMonitorEngine {
    private let poster: NotificationPoster
    private var lastNotifiedPeak: [String: Int] = [:]
    // Sticky ONLY in the `true` direction — see `tick` below. An earlier
    // draft cached the first check's result forever regardless of outcome,
    // which meant a permission grant AFTER an initial denial would never be
    // observed. That directly contradicted the spec's own invariant ("the
    // monitor keeps computing diffs... so it doesn't silently break once
    // granted later") and its own required test — fixed during adversarial
    // review before this was ever implemented.
    private var isAuthorized = false

    public init(poster: NotificationPoster) {
        self.poster = poster
    }

    /// Called once per poll tick with the FULL current alert list (any
    /// severities). Filters to `.red` internally. Never throws;
    /// `NotificationPoster`'s methods aren't throwing, so there is no I/O
    /// failure for `tick` to catch at this layer — genuine repository-read
    /// failures are caught one layer up, in `AlertMonitor` (LariatApp), per
    /// the spec's "a poll failure degrades silently" invariant.
    public func tick(alerts: [CommandAlert]) async {
        let reds = alerts.filter { $0.severity == .red }
        let (fire, candidatePeaks) = AlertMonitorCompute.notificationsToFire(
            previousPeaks: lastNotifiedPeak, currentRedAlerts: reds)

        guard !fire.isEmpty else {
            // Nothing to fire this tick — re-arm drops (if any) still apply,
            // but there is no candidate alert, so no permission check happens
            // (never request permission until there is an actual candidate).
            lastNotifiedPeak = candidatePeaks
            return
        }

        // Asymmetric cache: while false, re-verify on every fire-triggering
        // tick so permission granted later (outside the app) is picked up on
        // the next candidate tick. Once true is observed, never check again.
        if !isAuthorized {
            isAuthorized = await poster.ensureAuthorized()
        }

        if isAuthorized {
            for alert in fire {
                await poster.post(identifier: alert.source, message: alert.message)
            }
            lastNotifiedPeak = candidatePeaks   // safe: every fired source was just posted
        } else {
            // Re-arm drops still commit even while unauthorized — only the
            // FIRED sources' peaks stay frozen at their prior value (0 /
            // absent if never notified before).
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
