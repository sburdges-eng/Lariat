import Foundation

// Print-ready BEO (banquet event order) sheet COMPUTATION — a native-only
// nicety; the web `BeoBoard.tsx` has no print/export view, so there is no
// parity oracle here (unlike `SettlementPrintCompute`). Renders the event
// header, prep-sheet line items, courses/fire-times, and the money totals
// footer as monospaced text for the macOS print/copy/preview flow (H6b,
// `ShowSettlementView` / `SettlementPrintCompute` pattern).
//
// MONEY: `totals` is a caller-supplied `BeoWorksheetCompute.Totals` — this
// renderer is a PURE presentation layer over it and NEVER recomputes money
// from `lines`. It also NEVER touches the cascade/order-guide/prep-demand
// data (`BeoCascadeClient`) — the printable sheet is only the event header,
// prep-sheet line items, courses/fire-times, and the totals footer.
public enum BeoPrintCompute {
    public static func renderText(
        event: BeoEventRow,
        lines: [BeoLineItemRow],
        courses: [BeoCourseRow],
        totals: BeoWorksheetCompute.Totals
    ) -> String {
        var out: [String] = []
        out.append("BANQUET EVENT ORDER — \(event.title)")
        out.append(headerDetail(event))
        out.append("")

        out.append(lineHeader)
        out.append(String(repeating: "-", count: lineHeader.count))
        if lines.isEmpty {
            out.append("  No line items yet.")
        } else {
            for l in lines {
                out.append(lineRow(l, courses: courses))
            }
        }
        out.append("")

        out.append("COURSES")
        if courses.isEmpty {
            out.append("  No courses yet.")
        } else {
            for c in courses {
                out.append(courseLine(c))
            }
        }
        out.append("")

        out.append("TOTALS")
        out.append(moneyLine("Subtotal", totals.subtotal))
        out.append(moneyLine("Tax", totals.tax))
        out.append(moneyLine("Service fee", totals.fee))
        out.append(moneyLine("Total", totals.total))
        return out.joined(separator: "\n")
    }

    // ── event header ──────────────────────────────────────────────────

    static func headerDetail(_ event: BeoEventRow) -> String {
        var parts: [String] = [(event.eventDate?.isEmpty == false) ? event.eventDate! : "no date"]
        if let t = event.eventTime, !t.isEmpty { parts.append(t) }
        if let c = event.contactName, !c.isEmpty { parts.append(c) }
        if let g = event.guestCount { parts.append("\(g) covers") }
        return parts.joined(separator: " · ")
    }

    // ── line items ──────────────────────────────────────────────────────

    static let itemWidth = 24
    static let categoryWidth = 14
    static let qtyWidth = 8
    static let courseWidth = 14

    static var lineHeader: String {
        PrintText.pad("Item", itemWidth)
            + PrintText.pad("Category", categoryWidth)
            + PrintText.pad("Qty", qtyWidth)
            + PrintText.pad("Course", courseWidth)
            + "Prep notes"
    }

    static func lineRow(_ line: BeoLineItemRow, courses: [BeoCourseRow]) -> String {
        PrintText.pad(line.itemName, itemWidth)
            + PrintText.pad(line.category ?? "—", categoryWidth)
            + PrintText.pad(qtyText(line.quantity), qtyWidth)
            + PrintText.pad(courseLabel(for: line.courseId, in: courses), courseWidth)
            + (line.prepNotes ?? "—")
    }

    static func courseLabel(for courseId: Int64?, in courses: [BeoCourseRow]) -> String {
        guard let courseId, let c = courses.first(where: { $0.id == courseId }) else { return "—" }
        return c.courseLabel
    }

    /// Trim a trailing ".0" for whole-number quantities (order-guide print
    /// parity style); non-integral quantities print as-is.
    static func qtyText(_ qty: Double) -> String {
        if qty == qty.rounded(.towardZero), Swift.abs(qty) < 1e15 {
            return String(Int64(qty))
        }
        return String(qty)
    }

    // ── courses / fire-time section ──────────────────────────────────────

    static func courseLine(_ course: BeoCourseRow) -> String {
        "  " + PrintText.pad(course.courseLabel, courseLabelWidth) + BeoCourseRules.isoToLocalHHMM(course.fireAt)
    }

    static let courseLabelWidth = 20

    // ── money footer ──────────────────────────────────────────────────────

    static let moneyLabelWidth = 14

    /// Dollars → cents → `SettlementPrintCompute.dollars` (the T1 pattern) —
    /// `totals` fields are already `roundMoney`-rounded Doubles, so this
    /// conversion is safe and introduces no new rounding.
    static func moneyLine(_ label: String, _ dollars: Double) -> String {
        let cents = Int((dollars * 100).rounded())
        return "  " + PrintText.pad(label, moneyLabelWidth) + SettlementPrintCompute.dollars(cents)
    }
}
