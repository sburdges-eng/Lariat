#if os(macOS)
import SwiftUI
import LariatModel

/// H6c — the menu-bar extra's dropdown panel (`.menuBarExtraStyle(.window)`).
/// Reads the H6a `AlertMonitor`'s published `currentAlerts`, renders them via the
/// tested `MenuBarStatusCompute` into deterministically-sorted red/amber sections,
/// and offers Open-Command / Refresh actions. Pure display — no DB writes, no
/// second poll (it consumes AlertMonitor's existing 45s poll).
///
/// Untested in-package (there is no LariatAppTests target) — acceptance is
/// `swift build` + GUI smoke; every *decision* (partition, sort, badge, all-clear)
/// lives in `MenuBarStatusCompute`, which is unit-tested. Alert-row styling mirrors
/// `CommandView`'s convention locally (`.red` / `.orange`) rather than extracting
/// that view's `private` rows, to avoid perturbing the shipped Command board.
struct MenuBarPanelView: View {
    /// The app-wide alert poller (H6a). Injectable for previews; defaults to the
    /// singleton the scene observes.
    var monitor: AlertMonitor = .shared

    /// Activate the app + navigate to the Command board. Supplied by the scene,
    /// since it needs the app-level `selectedId` and `NSApp` activation.
    let onOpenCommand: () -> Void

    private var status: MenuBarStatus {
        MenuBarStatusCompute.status(from: monitor.currentAlerts)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            Divider()
            if status.isAllClear {
                allClear
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if !status.redAlerts.isEmpty {
                            section(title: "Critical", color: .red, alerts: status.redAlerts)
                        }
                        if !status.redAlerts.isEmpty && !status.amberAlerts.isEmpty {
                            Divider()
                        }
                        if !status.amberAlerts.isEmpty {
                            section(title: "Warnings", color: .orange, alerts: status.amberAlerts)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 320)
            }
            Divider()
            footer
        }
        .padding(12)
        .frame(width: 320)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text("Live signals").font(.headline)
            Spacer(minLength: 0)
            Text(freshness)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    /// "updated N seconds ago" from the last successful tick, or "—" if it has
    /// never ticked (e.g. DB unavailable).
    private var freshness: String {
        guard let last = monitor.lastTickAt else { return "—" }
        return "updated \(last.formatted(.relative(presentation: .numeric)))"
    }

    private var allClear: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
            Text("All clear")
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func section(title: String, color: Color, alerts: [CommandAlert]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(color)
            ForEach(alerts, id: \.source) { alert in
                Button(action: onOpenCommand) {
                    HStack(spacing: 8) {
                        Circle()
                            .fill(color)
                            .frame(width: 8, height: 8)
                            .accessibilityHidden(true)
                        Text(alert.message)
                            .font(.callout)
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the Command board")
            }
        }
    }

    private var footer: some View {
        HStack {
            Button("Open Command Board", action: onOpenCommand)
            Spacer(minLength: 8)
            Button("Refresh Now") { monitor.refreshNow() }
        }
        .font(.callout)
    }
}
#endif
