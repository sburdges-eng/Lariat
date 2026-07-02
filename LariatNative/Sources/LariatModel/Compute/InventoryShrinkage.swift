import Foundation

/// T8 — cooking-shrinkage math for inventory depletion. Pure port of the
/// pure-function layer in `lib/inventoryShrinkage.ts` (the DB lookup lives in
/// `InventoryUpdateRepository`). Parity oracle: `tests/js/test-t8-cooking-shrinkage.mjs`.
///
/// Toast sells cooked weight (8 oz burger); raw inventory depletes at the
/// pre-cook equivalent (`raw = cooked / (1 - loss_factor)`). Out-of-range
/// loss_factor (nil, <=0, >=1) falls through to the cooked qty with a reason.
public enum InventoryShrinkage {

    /// Reason strings are the PUBLIC contract — they persist in
    /// `inventory_updates.note` and downstream tools grep for them.
    public enum ShrinkageReason: String, Sendable, Equatable {
        case applied = "shrinkage_applied"
        case noLossFactor = "no_loss_factor"
        case outOfRange = "loss_factor_out_of_range"
        case noBomLine = "no_bom_line"
        case invalidQty = "invalid_cooked_qty"
    }

    public struct ShrinkageMath: Sendable, Equatable {
        public let cookedQty: Double
        public let unit: String?
        public let rawQty: Double
        public let applied: Bool
        public let lossFactor: Double?
        public let reason: ShrinkageReason

        public init(cookedQty: Double, unit: String?, rawQty: Double, applied: Bool, lossFactor: Double?, reason: ShrinkageReason) {
            self.cookedQty = cookedQty; self.unit = unit; self.rawQty = rawQty
            self.applied = applied; self.lossFactor = lossFactor; self.reason = reason
        }
    }

    /// `raw = cooked / (1 - loss_factor)`. Pure; no DB.
    public static func applyShrinkage(cookedQty: Double, lossFactor: Double?, unit: String?) -> ShrinkageMath {
        if !cookedQty.isFinite || cookedQty <= 0 {
            return ShrinkageMath(cookedQty: cookedQty, unit: unit, rawQty: cookedQty, applied: false, lossFactor: nil, reason: .invalidQty)
        }
        guard let lossFactor else {
            return ShrinkageMath(cookedQty: cookedQty, unit: unit, rawQty: cookedQty, applied: false, lossFactor: nil, reason: .noLossFactor)
        }
        // <=0 is nonsensical (0 = no shrinkage but log a reason; negative = impossible);
        // >=1 is the divide-by-zero / 100%-loss trap.
        if lossFactor <= 0 || lossFactor >= 1 {
            return ShrinkageMath(cookedQty: cookedQty, unit: unit, rawQty: cookedQty, applied: false, lossFactor: lossFactor, reason: .outOfRange)
        }
        return ShrinkageMath(cookedQty: cookedQty, unit: unit, rawQty: cookedQty / (1 - lossFactor), applied: true, lossFactor: lossFactor, reason: .applied)
    }

    /// Format the `inventory_updates.delta` column: signed (depletion = negative),
    /// rounded to 3 dp, trailing zeros stripped. e.g. `-10.667 oz`, `-8 oz`, `-8`.
    public static func formatDepletionDelta(rawQty: Double, unit: String?) -> String {
        let signed = -abs(rawQty)
        let rounded = jsRound(signed * 1000) / 1000
        let qtyStr: String
        if rounded == 0 {
            // Explicit so sub-millionth inputs don't drop the sign / masquerade as 0.
            qtyStr = "0"
        } else {
            qtyStr = trimTrailingZeros(String(format: "%.3f", rounded))
        }
        if let u = unit?.trimmingCharacters(in: .whitespaces), !u.isEmpty {
            return "\(qtyStr) \(u)"
        }
        return qtyStr
    }

    /// Audit note capturing the exact conversion. e.g.
    /// `T8: cooked=8 oz × 1/(1-0.25) → raw=10.667 oz [shrinkage_applied]`
    public static func formatShrinkageNote(_ math: ShrinkageMath) -> String {
        let unit = (math.unit?.isEmpty == false) ? " \(math.unit!)" : ""
        if math.applied, let lf = math.lossFactor {
            let raw = jsRound(math.rawQty * 1000) / 1000
            return "T8: cooked=\(jsNum(math.cookedQty))\(unit) × 1/(1-\(jsNum(lf))) → raw=\(jsNum(raw))\(unit) [\(math.reason.rawValue)]"
        }
        return "T8: cooked=\(jsNum(math.cookedQty))\(unit) (no shrinkage) [\(math.reason.rawValue)]"
    }

    // ── numeric formatting parity ──────────────────────────────────────

    /// JS `Math.round` = `floor(x + 0.5)` (rounds .5 toward +∞). Swift's default
    /// `.rounded()` is half-away-from-zero and differs on negative ties, so the
    /// delta rounding MUST use this to stay bit-exact with the web helper.
    private static func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }

    /// Strip the trailing-zeros of a `%.3f` string (which always has a "."),
    /// then a bare trailing ".", matching JS `toFixed(3).replace(/\.?0+$/, '')`.
    private static func trimTrailingZeros(_ s: String) -> String {
        guard s.contains(".") else { return s }
        var out = s
        while out.hasSuffix("0") { out.removeLast() }
        if out.hasSuffix(".") { out.removeLast() }
        return out
    }

    /// Render a Double the way JS renders a Number in a template string:
    /// integer-valued → no ".0" ("8", not "8.0"); otherwise shortest round-trip.
    private static func jsNum(_ d: Double) -> String {
        if d.isFinite, d == d.rounded(.towardZero), abs(d) < 9.007e15 {
            return String(Int64(d))
        }
        return "\(d)"
    }
}

/// Pure helpers for the waste view's range window — parity with
/// `app/inventory/waste/page.jsx` (`days` clamp + `startOfRange(days-1)`).
public enum InventoryWaste {
    /// `Number(days)` finite && >0 && <=90 ? `Math.floor` : 7.
    public static func clampDays(_ raw: Double?) -> Int {
        guard let n = raw, n.isFinite, n > 0, n <= 90 else { return 7 }
        return Int(n.rounded(.down))
    }

    /// `since` = today's UTC date minus `(days - 1)` calendar days (YYYY-MM-DD).
    public static func sinceDate(today: String, days: Int) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        let f = DateFormatter()
        f.calendar = cal
        f.timeZone = cal.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        guard let base = f.date(from: today),
              let shifted = cal.date(byAdding: .day, value: -(days - 1), to: base) else { return today }
        return f.string(from: shifted)
    }
}
