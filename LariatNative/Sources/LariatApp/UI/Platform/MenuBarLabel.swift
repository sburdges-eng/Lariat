#if os(macOS)
import SwiftUI
import LariatModel

/// H6c — the menu-bar status-item label. Reads the H6a `AlertMonitor` and shows a
/// fork.knife glyph plus the red-alert count when there is one, tinted by worst
/// severity. Severity is *also* encoded in the presence of the count text, not
/// tint alone, because the macOS menu bar template-renders symbols and may drop
/// color — the numeral is the reliable "something is red" signal.
struct MenuBarStatusLabel: View {
    var monitor: AlertMonitor = .shared

    var body: some View {
        let status = MenuBarStatusCompute.status(from: monitor.currentAlerts)
        HStack(spacing: 3) {
            Image(systemName: "fork.knife")
            if let badge = status.badgeText {
                Text(badge)
            }
        }
        .foregroundStyle(tint(for: status.overall))
        .accessibilityLabel(accessibilityLabel(for: status))
    }

    private func tint(for severity: MenuBarSeverity) -> Color {
        switch severity {
        case .red:   return .red
        case .amber: return .orange
        case .clean: return .primary
        }
    }

    private func accessibilityLabel(for status: MenuBarStatus) -> String {
        if status.redCount > 0 {
            return "Lariat — \(status.redCount) critical, \(status.amberCount) warning"
        }
        if status.amberCount > 0 {
            return "Lariat — \(status.amberCount) warning"
        }
        return "Lariat — all clear"
    }
}
#endif
