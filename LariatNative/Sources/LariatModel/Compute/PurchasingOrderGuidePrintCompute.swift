import Foundation

// Print-ready purchasing order-guide COMPUTATION — a native-only nicety;
// `app/purchasing/page.jsx` has no print/export view on the web, so there is
// no parity oracle here (unlike `SettlementPrintCompute`). Renders the same
// up-to-200-row `OrderGuideSummary` the `PurchasingOrderGuideView.Table`
// shows, as monospaced text for the macOS print/copy/preview flow
// (H6b, `ShowSettlementView` / `SettlementPrintCompute` pattern).
public enum PurchasingOrderGuidePrintCompute {
    /// The full print body as monospaced text: a title/count header, an
    /// aligned ingredient/qty/unit/vendor/price table (or an empty-state
    /// line), one row per `EnrichedOrderGuideRow`.
    public static func renderText(_ summary: OrderGuideSummary) -> String {
        var out: [String] = []
        out.append("PURCHASING ORDER GUIDE")
        out.append("\(summary.totalCount) item\(summary.totalCount == 1 ? "" : "s") on file")
        out.append("")

        out.append(header)
        out.append(String(repeating: "-", count: header.count))
        if summary.rows.isEmpty {
            out.append("  No order guide rows.")
        } else {
            for item in summary.rows {
                out.append(row(item.row))
            }
        }
        out.append("")
        out.append("Showing \(summary.rows.count) of \(summary.totalCount) · Lariat purchasing order guide")
        return out.joined(separator: "\n")
    }

    /// The web-page-parity view's `qtyString` (`PurchasingOrderGuideView`) —
    /// integers render without a trailing ".0"; nil → "—".
    public static func qtyText(_ qty: Double?) -> String {
        guard let qty else { return "—" }
        if qty == qty.rounded(.towardZero), Swift.abs(qty) < 1e15 {
            return String(Int64(qty))
        }
        return String(qty)
    }

    /// Reuses `SettlementPrintCompute.dollars` (the codebase's one dollar
    /// formatter) instead of re-deriving money display — `unit_price` is
    /// REAL dollars, so it's rounded to the nearest cent first, same as the
    /// settlement deal editor's dollars→cents conversion.
    public static func priceText(_ price: Double?) -> String {
        guard let price else { return "—" }
        let cents = Int((price * 100).rounded())
        return SettlementPrintCompute.dollars(cents)
    }

    // ── columns ───────────────────────────────────────────────────────

    static let ingredientWidth = 28
    static let qtyWidth = 10
    static let unitWidth = 8
    static let vendorWidth = 18

    static var header: String {
        pad("Ingredient", ingredientWidth)
            + pad("Qty", qtyWidth)
            + pad("Unit", unitWidth)
            + pad("Vendor", vendorWidth)
            + "Unit $"
    }

    static func row(_ item: OrderGuideItemRow) -> String {
        pad(item.ingredient, ingredientWidth)
            + pad(qtyText(item.baseQty), qtyWidth)
            + pad(item.unit ?? "—", unitWidth)
            + pad(item.vendor ?? "—", vendorWidth)
            + priceText(item.unitPrice)
    }

    static func pad(_ s: String, _ width: Int) -> String {
        s.count >= width ? s + " " : s + String(repeating: " ", count: width - s.count)
    }
}
