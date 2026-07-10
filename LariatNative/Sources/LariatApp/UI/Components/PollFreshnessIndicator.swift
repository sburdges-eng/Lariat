import SwiftUI

/// Endgame H5: compact data-freshness chip for the shell (bottom-trailing of
/// the detail pane). Reflects the active board's `BoardPoller` state:
///   - green dot + "Updated Ns ago" while polling is healthy,
///   - amber warning once the last success is older than 3× the effective poll
///     interval (two consecutive failed/backed-off cycles),
///   - a moon glyph while the app is inactive and polling has degraded to the
///     slower background cadence (data still flows — wall-mounted boards).
/// Renders nothing when no poller is active (e.g. static screens).
///
/// H6d: the active poller is passed in per-window (published up by the active
/// board via `ActiveBoardPollerKey`), not read from a global hub — so each
/// window's chip reflects *its own* board, even when it is not key/frontmost.
struct PollFreshnessIndicator: View {
    let poller: BoardPoller?

    var body: some View {
        if let poller {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                chip(for: poller, now: context.date)
            }
            .allowsHitTesting(false)
        }
    }

    @ViewBuilder
    private func chip(for poller: BoardPoller, now: Date) -> some View {
        HStack(spacing: 5) {
            if let last = poller.lastSuccess {
                if poller.isStale {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(LaRiOS.Colors.metal)
                    Text("Stale · updated \(recency(from: last, to: now))")
                } else if poller.isBackgrounded {
                    Image(systemName: "moon.fill")
                        .foregroundStyle(LaRiOS.Colors.textMuted)
                    Text("Updated \(recency(from: last, to: now))")
                } else {
                    Circle()
                        .fill(LaRiOS.Colors.ok)
                        .frame(width: 6, height: 6)
                    Text("Updated \(recency(from: last, to: now))")
                }
            } else {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .foregroundStyle(LaRiOS.Colors.textMuted)
                Text("Refreshing…")
            }
        }
        .font(LaRiOS.Typography.xsmall)
        .foregroundStyle(LaRiOS.Colors.textMuted)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(LaRiOS.Colors.panelRaised, in: RoundedRectangle(cornerRadius: LaRiOS.Radius.small))
        .overlay {
            RoundedRectangle(cornerRadius: LaRiOS.Radius.small)
                .stroke(LaRiOS.Colors.hairline, lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText(for: poller, now: now))
    }

    private func recency(from lastSuccess: Date, to now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(lastSuccess)))
        if seconds < 1 { return "just now" }
        if seconds < 60 { return "\(seconds)s ago" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        return "\(minutes / 60)h ago"
    }

    private func accessibilityText(for poller: BoardPoller, now: Date) -> String {
        guard let last = poller.lastSuccess else { return "Refreshing data" }
        let base = "Data updated \(recency(from: last, to: now))"
        if poller.isStale { return "Warning, data is stale. \(base)" }
        if poller.isBackgrounded { return "\(base), refreshing at background cadence" }
        return base
    }
}
