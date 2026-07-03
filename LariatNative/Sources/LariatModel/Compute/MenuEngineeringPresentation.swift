import Foundation

// Presentation helpers for the standalone Menu Engineering screen
// (port of app/menu-engineering/page.tsx display logic).
//
// The quadrant classification itself is CostingCompute.computeMenuEngineering —
// the web deliberately shares one engine between /costing and /menu-engineering,
// and so do we. These helpers only shape the already computed rows for the
// dedicated screen; no I/O, no re-computation.

public enum MenuEngineeringPresentation {

    /// Web threshold for the "Critical Margin Hazards" call-out.
    /// Mirrors app/menu-engineering/page.tsx: `margin_pct != null && margin_pct < 20.0`.
    public static let marginHazardThresholdPct: Double = 20.0

    /// High-volume plowhorses whose margin sits below the hazard threshold —
    /// the dishes a GM should reprice or swap a cheaper component into first.
    ///
    /// Mirrors the web `hazards` filter:
    ///   rows.filter(r => r.quadrant === 'plowhorse' && r.margin_pct != null && r.margin_pct < 20)
    public static func hazards(
        _ rows: [MenuEngineeringRow],
        thresholdPct: Double = marginHazardThresholdPct
    ) -> [MenuEngineeringRow] {
        rows.filter { row in
            guard row.quadrant == .plowhorse, let margin = row.marginPct else { return false }
            return margin < thresholdPct
        }
    }

    /// Table display order: costed rows first (net sales descending), with
    /// uncosted rows sunk to the bottom.
    ///
    /// Mirrors the web sort in app/menu-engineering/page.tsx, which pushes
    /// `link_state === 'unlinked'` rows below the fold and otherwise orders by
    /// `net_sales` desc. The native `MenuEngineeringRow` has no `link_state`, but
    /// an uncosted dish is exactly the one that falls to the `.unknown` quadrant
    /// (nil cost → nil margin → unknown), so that flag is the faithful proxy.
    public static func sortedForTable(_ rows: [MenuEngineeringRow]) -> [MenuEngineeringRow] {
        rows.sorted { lhs, rhs in
            let lhsUncosted = lhs.quadrant == .unknown
            let rhsUncosted = rhs.quadrant == .unknown
            if lhsUncosted != rhsUncosted {
                return !lhsUncosted        // costed rows sort ahead of uncosted
            }
            return lhs.netSales > rhs.netSales
        }
    }
}
