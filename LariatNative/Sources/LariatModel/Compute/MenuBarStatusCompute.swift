import Foundation

// H6c — menu-bar extra. Pure core: partitions the live CommandAlert set into
// deterministically-sorted red/amber sections and derives the status-item badge
// + worst-severity glyph state. No SwiftUI / Foundation-UI / I/O — the App-layer
// MenuBarPanelView + MenuBarExtra scene consume this (they are `swift build` +
// GUI smoke, since the package has no LariatAppTests target). Sibling of the H6a
// AlertMonitorCompute: this feature *displays* alerts; that one decides firing.

/// Worst severity currently present, for the status-item glyph tint.
public enum MenuBarSeverity: Equatable {
    case clean   // no red, no amber
    case amber   // amber present, no red
    case red     // at least one red (red always wins over amber)
}

/// The rendered state of the menu-bar extra for one poll snapshot. Stored fields
/// are the two severity-partitioned lists; everything else is derived, so two
/// snapshots are `Equatable`-equal exactly when their alert sections match.
public struct MenuBarStatus: Equatable {
    /// Red alerts, sorted count-descending then source-ascending.
    public let redAlerts: [CommandAlert]
    /// Amber alerts, sorted the same way.
    public let amberAlerts: [CommandAlert]

    public init(redAlerts: [CommandAlert], amberAlerts: [CommandAlert]) {
        self.redAlerts = redAlerts
        self.amberAlerts = amberAlerts
    }

    /// Number of red alert *rows* (distinct red signals) — not the sum of their
    /// individual `count`s, which mixes heterogeneous units.
    public var redCount: Int { redAlerts.count }
    public var amberCount: Int { amberAlerts.count }

    /// Status-item badge: the red row count, or `nil` when there are no red
    /// alerts. Amber never contributes to the badge (H6a "red = critical").
    public var badgeText: String? { redAlerts.isEmpty ? nil : String(redAlerts.count) }

    public var overall: MenuBarSeverity {
        if !redAlerts.isEmpty { return .red }
        if !amberAlerts.isEmpty { return .amber }
        return .clean
    }

    /// True when the panel should show its single calm "All clear" row.
    public var isAllClear: Bool { redAlerts.isEmpty && amberAlerts.isEmpty }
}

public enum MenuBarStatusCompute {

    /// Build the menu-bar snapshot from the full (red + amber) live alert list.
    /// Input order is irrelevant: each section is sorted deterministically so the
    /// panel never reorders rows spuriously between ticks.
    public static func status(from alerts: [CommandAlert]) -> MenuBarStatus {
        MenuBarStatus(
            redAlerts: alerts.filter { $0.severity == .red }.sorted(by: ordered),
            amberAlerts: alerts.filter { $0.severity == .amber }.sorted(by: ordered)
        )
    }

    /// Count descending, then `source` ascending as a stable tie-break.
    private static func ordered(_ a: CommandAlert, _ b: CommandAlert) -> Bool {
        a.count != b.count ? a.count > b.count : a.source < b.source
    }
}
