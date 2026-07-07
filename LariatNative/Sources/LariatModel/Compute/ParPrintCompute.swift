import Foundation

/// Print-ready par-board COMPUTATION — ONE shared renderer for BOTH
/// `/bar/par` and `/inventory/par` (H6b T3). Neither web page has a
/// print/export view, so like `PrepParPrintCompute` /
/// `PurchasingOrderGuidePrintCompute` there is no web parity oracle; this
/// pins the native contract directly. `ParPrintGroup`/`ParPrintRow` are
/// small board-agnostic inputs — each call site (`BarParView`,
/// `InventoryParView`) maps its own already-loaded rows (`BarParRow`,
/// `InventoryParWithOnHand`) into these before calling `renderText`, so the
/// renderer itself never special-cases "bar" vs "inventory" beyond the
/// `title` parameter. Par/on-hand are plain quantities on both boards (no
/// money on either) — qty formatting reuses
/// `PurchasingOrderGuidePrintCompute.qtyText` rather than re-deriving the
/// nil/integer-trim rule.
public enum ParPrintCompute {
    /// The full print body: a title/count header, one column header +
    /// separator, then each category group's title (verbatim — the boards'
    /// own list views don't uppercase category headers either) followed by
    /// its aligned rows (name / par / on-hand / unit / below-par marker),
    /// or an empty-state line when there are no rows.
    public static func renderText(title: String, groups: [ParPrintGroup]) -> String {
        var out: [String] = []
        let count = groups.reduce(0) { $0 + $1.rows.count }
        out.append(title)
        out.append("\(count) item\(count == 1 ? "" : "s") on file")
        out.append("")

        if count == 0 {
            out.append("  No par items on file.")
        } else {
            out.append(header)
            out.append(String(repeating: "-", count: header.count))
            for group in groups {
                out.append(group.category)
                for row in group.rows {
                    out.append(rowLine(row))
                }
            }
        }
        out.append("")
        out.append("Lariat par sheet")
        return out.joined(separator: "\n")
    }

    // ── columns ───────────────────────────────────────────────────────

    static let nameWidth = 26
    static let parWidth = 8
    static let onHandWidth = 10
    static let unitWidth = 8

    static var header: String {
        PrintText.pad("Item", nameWidth)
            + PrintText.pad("Par", parWidth)
            + PrintText.pad("On Hand", onHandWidth)
            + PrintText.pad("Unit", unitWidth)
            + "Status"
    }

    /// Reuses `PurchasingOrderGuidePrintCompute.qtyText` for both qty
    /// columns — same nil/integer-trim rule, no money on either board.
    static func rowLine(_ row: ParPrintRow) -> String {
        PrintText.pad(row.name, nameWidth)
            + PrintText.pad(PurchasingOrderGuidePrintCompute.qtyText(row.par), parWidth)
            + PrintText.pad(PurchasingOrderGuidePrintCompute.qtyText(row.onHand), onHandWidth)
            + PrintText.pad(row.unit ?? "—", unitWidth)
            + (row.belowPar ? "LOW" : "")
    }
}

/// One category section of a par print — maps 1:1 to the boards' own
/// category grouping (`BarParViewModel.grouped` / `InventoryParViewModel.grouped`).
public struct ParPrintGroup: Sendable, Equatable {
    public let category: String
    public let rows: [ParPrintRow]

    public init(category: String, rows: [ParPrintRow]) {
        self.category = category
        self.rows = rows
    }
}

/// One par-board row, board-agnostic — a `BarParRow` or
/// `InventoryParWithOnHand` maps into this at the call site.
public struct ParPrintRow: Sendable, Equatable {
    public let name: String
    public let par: Double?
    public let onHand: Double?
    public let unit: String?
    public let belowPar: Bool

    public init(name: String, par: Double?, onHand: Double?, unit: String?, belowPar: Bool) {
        self.name = name
        self.par = par
        self.onHand = onHand
        self.unit = unit
        self.belowPar = belowPar
    }
}
