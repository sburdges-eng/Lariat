import Foundation

// Print-ready standing prep-par COMPUTATION — a native-only nicety, same as
// `PurchasingOrderGuidePrintCompute` (no web print/export view exists for
// `app/prep/par`). Renders the already station-grouped `PrepParBoardSnapshot`
// (`PrepParCompute.group`) as monospaced text for the macOS print/copy/preview
// flow (H6b, `ShowSettlementView` / `SettlementPrintCompute` pattern). No
// money values live on this board — `target_qty` is a plain quantity, not
// dollars — so qty formatting reuses `PurchasingOrderGuidePrintCompute.qtyText`
// instead of re-deriving the nil/integer-trim rule.
public enum PrepParPrintCompute {
    /// The full print body: a title/count header, one column header +
    /// separator, then each station group's uppercase title followed by its
    /// aligned rows (label / qty / unit / station / note), or an empty-state
    /// line when there are no groups.
    public static func renderText(_ snapshot: PrepParBoardSnapshot) -> String {
        var out: [String] = []
        let count = snapshot.rows.count
        out.append("STANDING PREP PAR")
        out.append("\(count) target\(count == 1 ? "" : "s") on file")
        out.append("")

        if snapshot.groups.isEmpty {
            out.append("  No standing prep targets on file.")
        } else {
            out.append(header)
            out.append(String(repeating: "-", count: header.count))
            for group in snapshot.groups {
                out.append(group.title.uppercased())
                for row in group.rows {
                    out.append(rowLine(row))
                }
            }
        }
        out.append("")
        out.append("Lariat standing prep par")
        return out.joined(separator: "\n")
    }

    // ── columns ───────────────────────────────────────────────────────

    static let labelWidth = 28
    static let qtyWidth = 8
    static let unitWidth = 12
    static let stationWidth = 14

    static var header: String {
        pad("Item", labelWidth)
            + pad("Qty", qtyWidth)
            + pad("Unit", unitWidth)
            + pad("Station", stationWidth)
            + "Note"
    }

    /// Reuses `PurchasingOrderGuidePrintCompute.qtyText` for the qty column —
    /// same nil/integer-trim rule, no money on this board to re-derive.
    static func rowLine(_ row: PrepParRow) -> String {
        let station = row.stationId.isEmpty ? "General" : row.stationId
        return pad(row.label, labelWidth)
            + pad(PurchasingOrderGuidePrintCompute.qtyText(row.targetQty), qtyWidth)
            + pad(row.unit ?? "—", unitWidth)
            + pad(station, stationWidth)
            + (row.note ?? "")
    }

    static func pad(_ s: String, _ width: Int) -> String {
        s.count >= width ? s + " " : s + String(repeating: " ", count: width - s.count)
    }
}
