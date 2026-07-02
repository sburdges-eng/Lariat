import SwiftUI

/// Endgame H5: compact data-freshness chip for the shell (bottom-trailing of
/// the detail pane). Reflects the active board's `BoardPoller` state:
///   - green dot + "Updated Ns ago" while polling is healthy,
///   - amber warning once the last success is older than 3× the poll interval
///     (two consecutive failed/backed-off cycles),
///   - "Paused" while the app is inactive and polling is suspended.
/// Renders nothing when no poller is active (e.g. static screens).
struct PollFreshnessIndicator: View {
    var body: some View {
        if let poller = BoardPollerHub.shared.active {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                chip(for: poller, now: context.date)
            }
            .allowsHitTesting(false)
        }
    }

    @ViewBuilder
    private func chip(for poller: BoardPoller, now: Date) -> some View {
        HStack(spacing: 5) {
            if poller.isPaused {
                Image(systemName: "pause.circle.fill")
                    .foregroundStyle(.secondary)
                Text("Paused")
            } else if let last = poller.lastSuccess {
                if poller.isStale {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(LariatTheme.warn)
                    Text("Stale · updated \(recency(from: last, to: now))")
                } else {
                    Circle()
                        .fill(LariatTheme.ok)
                        .frame(width: 6, height: 6)
                    Text("Updated \(recency(from: last, to: now))")
                }
            } else {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .foregroundStyle(.secondary)
                Text("Refreshing…")
            }
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(.ultraThinMaterial, in: Capsule())
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
        if poller.isPaused { return "Data refresh paused" }
        guard let last = poller.lastSuccess else { return "Refreshing data" }
        let base = "Data updated \(recency(from: last, to: now))"
        return poller.isStale ? "Warning, data is stale. \(base)" : base
    }
}
