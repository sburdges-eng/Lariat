import Foundation

/// The BEO prep-sheet money math + GROUP-NOTE row grouping from
/// `app/beo/BeoBoard.tsx` (the web keeps this inline in the component).
/// Pure; no I/O.
public enum BeoWorksheetCompute {
    /// Web `roundMoney` = `Math.round(n * 100) / 100`. JS `Math.round(x)` is
    /// `floor(x + 0.5)` (half-up), which differs from Swift's
    /// `.toNearestOrAwayFromZero` only on negatives — reproduced exactly.
    public static func roundMoney(_ n: Double) -> Double {
        ((n * 100) + 0.5).rounded(.down) / 100
    }

    /// Per-line total: `roundMoney(unit_cost * quantity)` (dollars).
    public static func lineTotal(unitCost: Double, quantity: Double) -> Double {
        roundMoney(unitCost * quantity)
    }

    public struct Line: Equatable, Sendable {
        public let unitCost: Double
        public let quantity: Double

        public init(unitCost: Double, quantity: Double) {
            self.unitCost = unitCost
            self.quantity = quantity
        }
    }

    public struct Totals: Equatable, Sendable {
        public let subtotal: Double
        public let tax: Double
        public let fee: Double
        public let total: Double

        public init(subtotal: Double, tax: Double, fee: Double, total: Double) {
            self.subtotal = subtotal; self.tax = tax
            self.fee = fee; self.total = total
        }
    }

    /// Footer math from `PrepSheetTable`:
    ///   subtotal = Σ rounded line totals (not re-rounded)
    ///   tax      = roundMoney(subtotal × taxRate)          (rate is a fraction)
    ///   fee      = roundMoney(subtotal × serviceFeePct/100) (pct is a percent)
    ///   total    = roundMoney(subtotal + tax + fee)
    /// nil rates behave like the web's `Number(x || 0)` → 0.
    public static func totals(lines: [Line], taxRate: Double?, serviceFeePct: Double?) -> Totals {
        let subtotal = lines.reduce(0.0) { $0 + lineTotal(unitCost: $1.unitCost, quantity: $1.quantity) }
        let rate = taxRate ?? 0
        let pct = serviceFeePct ?? 0
        let tax = roundMoney(subtotal * rate)
        let fee = roundMoney(subtotal * (pct / 100))
        let total = roundMoney(subtotal + tax + fee)
        return Totals(subtotal: subtotal, tax: tax, fee: fee, total: total)
    }

    /// Group consecutive rows that share a category — the `group_note` on the
    /// first row of a run spans the whole run (the xlsx merged-A-column
    /// behavior). nil categories group under "".
    public static func categoryRuns(_ categories: [String?]) -> [(category: String, indices: Range<Int>)] {
        var out: [(category: String, indices: Range<Int>)] = []
        for (i, raw) in categories.enumerated() {
            let cat = raw ?? ""
            if let last = out.last, last.category == cat {
                out[out.count - 1].indices = last.indices.lowerBound..<(i + 1)
            } else {
                out.append((category: cat, indices: i..<(i + 1)))
            }
        }
        return out
    }
}
