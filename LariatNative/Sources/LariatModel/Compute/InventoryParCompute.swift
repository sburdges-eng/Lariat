import Foundation

/// Pure inventory-par rules. The only rule with a decision is the "below par"
/// flag used by the par board's latest-count LEFT JOIN — parity with the web
/// `par/page.jsx` predicate `par_qty != null && on_hand_qty != null &&
/// Number(on_hand_qty) < Number(par_qty)` (the same predicate `CommandRepository`
/// uses for its low-par rollup). Quantities are compared only when BOTH are
/// present; a never-counted item (nil on-hand) is never "low".
public enum InventoryParCompute {
    public static func isLowPar(parQty: Double?, onHand: Double?) -> Bool {
        guard let parQty, let onHand else { return false }
        return onHand < parQty
    }
}
