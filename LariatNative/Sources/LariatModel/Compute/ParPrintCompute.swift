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
/// nil/integer-trim rule. Par and on-hand are tracked in LEGITIMATELY
/// INDEPENDENT units (a standing par of "2 case" counted on-hand as
/// "14 ea") — same parity convention as the web boards
/// (`app/inventory/par/page.jsx` / `app/bar/par/page.jsx` render
/// `par {qty} {par_unit}` and `on hand {qty} {on_hand_unit}` separately), so
/// each quantity column carries its own unit rather than sharing one across
/// the row.
public enum ParPrintCompute {
    /// The full print body: a title/count header, one column header +
    /// separator, then each category group's title (verbatim — the boards'
    /// own list views don't uppercase category headers either) followed by
    /// its aligned rows (name / par+unit / on-hand+unit / below-par marker),
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
    static let parWidth = 14
    static let onHandWidth = 16

    static var header: String {
        PrintText.pad("Item", nameWidth)
            + PrintText.pad("Par", parWidth)
            + PrintText.pad("On Hand", onHandWidth)
            + "Status"
    }

    /// Reuses `PurchasingOrderGuidePrintCompute.qtyText` for both qty
    /// columns — same nil/integer-trim rule, no money on either board.
    static func rowLine(_ row: ParPrintRow) -> String {
        PrintText.pad(row.name, nameWidth)
            + PrintText.pad(qtyUnitText(row.par, row.parUnit), parWidth)
            + PrintText.pad(qtyUnitText(row.onHand, row.onHandUnit), onHandWidth)
            + (row.belowPar ? "LOW" : "")
    }

    /// Combines a quantity with ITS OWN unit — "12 btl", "20" (qty on file
    /// but no unit recorded — the unit is simply omitted), "—" (no qty, the
    /// same em-dash `qtyText` already uses for a missing quantity). Par and
    /// on-hand never share a unit here — see the enum-level doc comment.
    static func qtyUnitText(_ qty: Double?, _ unit: String?) -> String {
        let qtyStr = PurchasingOrderGuidePrintCompute.qtyText(qty)
        guard let unit, !unit.isEmpty else { return qtyStr }
        return "\(qtyStr) \(unit)"
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
/// `InventoryParWithOnHand` maps into this at the call site. `parUnit` and
/// `onHandUnit` are tracked SEPARATELY (never collapsed to one shared
/// `unit`) because a board's standing par and its latest counted on-hand
/// are legitimately denominated differently (e.g. par in "case", on-hand
/// counted in "ea") — mislabeling one as the other on a physical restocking
/// sheet is exactly the bug this shape prevents.
public struct ParPrintRow: Sendable, Equatable {
    public let name: String
    public let par: Double?
    public let onHand: Double?
    public let parUnit: String?
    public let onHandUnit: String?
    public let belowPar: Bool

    public init(name: String, par: Double?, onHand: Double?, parUnit: String?, onHandUnit: String?, belowPar: Bool) {
        self.name = name
        self.par = par
        self.onHand = onHand
        self.parUnit = parUnit
        self.onHandUnit = onHandUnit
        self.belowPar = belowPar
    }
}
