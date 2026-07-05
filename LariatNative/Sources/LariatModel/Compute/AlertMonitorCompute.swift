import Foundation

// H6a — local notifications for red signals. Pure diff/peak/re-arm state
// machine: decides which CommandAlerts warrant firing a notification this
// tick, given what was already notified last tick. No I/O — see
// NotificationPoster (posting boundary) / AlertMonitorEngine (permission-
// gated orchestration using this + that).
public enum AlertMonitorCompute {

    /// `currentRedAlerts` need not be pre-filtered — non-`.red` entries are
    /// ignored entirely (never fire, never tracked). A source present in
    /// `previousPeaks` but absent from `currentRedAlerts` is treated as having
    /// dropped to 0 and is removed from `nextPeaks` (re-arms it for a fresh
    /// fire next time it appears nonzero). `CommandAlert.count` is always > 0
    /// by construction for anything `CommandCompute.alertsFor` produces, so
    /// "count == 0" is represented by absence, not an explicit zero-count alert.
    public static func notificationsToFire(
        previousPeaks: [String: Int],
        currentRedAlerts: [CommandAlert]
    ) -> (fire: [CommandAlert], nextPeaks: [String: Int]) {
        var fire: [CommandAlert] = []
        var nextPeaks: [String: Int] = [:]

        for a in currentRedAlerts where a.severity == .red {
            let priorPeak = previousPeaks[a.source, default: 0]
            if a.count > priorPeak {
                fire.append(a)
                nextPeaks[a.source] = a.count
            } else {
                nextPeaks[a.source] = priorPeak
            }
        }

        return (fire, nextPeaks)
    }
}
