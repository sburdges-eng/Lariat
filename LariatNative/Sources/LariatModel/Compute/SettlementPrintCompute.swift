import Foundation

// Print-ready settlement COMPUTATION — parity port of the line items,
// totals, labels, and formatting in `lib/settlementPrint.ts`. The web
// renders HTML + auto-`window.print()`; native renders the same content as
// a monospaced text preview (macOS print integration is a later H6 item —
// deferred-cosmetic). HTML escaping / CSP headers are web-transport
// concerns with no native analog.

public enum SettlementPrintCompute {
    /// Web `SOURCE_LABELS`.
    public static let sourceLabels: [String: String] = [
        "dice": "DICE",
        "walkup": "Walk-up",
        "comp": "Comp",
        "will_call": "Will call",
        "guestlist": "Guest list",
    ]

    public static func sourceLabel(_ source: String) -> String {
        sourceLabels[source] ?? source
    }

    /// Web `dollars(cents)` — `-$1,234.56` style with en-US grouping.
    public static func dollars(_ cents: Int) -> String {
        let sign = cents < 0 ? "-" : ""
        let abs = Swift.abs(cents)
        let whole = abs / 100
        let frac = abs % 100
        return "\(sign)$\(grouped(whole)).\(String(format: "%02d", frac))"
    }

    /// Web vs% label: nil → "—", else `(pct*100).toFixed(0)%`.
    public static func vsPctLabel(_ pct: Double?) -> String {
        guard let pct else { return "—" }
        return "\(Int((pct * 100 + 0.5).rounded(.down)))%"
    }

    /// Ticket sources with non-zero qty, in the fixed web source order —
    /// zero-qty sources are hidden (web `ticketSourceRows` filter).
    public static func ticketSourceRows(
        _ summary: SettlementSummary
    ) -> [(label: String, qty: Int, grossCents: Int)] {
        BoxOfficeSource.allCases.compactMap { src in
            guard let v = summary.ticketing.bySource[src], v.qty > 0 else { return nil }
            return (sourceLabel(src.rawValue), v.qty, v.grossCents)
        }
    }

    /// Web toast warning row — emitted when no Toast rows exist for the date.
    public static func toastWarning(_ summary: SettlementSummary) -> String? {
        guard summary.toast.rowsFound == 0 else { return nil }
        return "No Toast rows for \(summary.show.date) yet — settlement may be incomplete."
    }

    /// The full print body as monospaced text — same sections, line items,
    /// and totals as the web `renderShowSection`.
    public static func renderText(_ summary: SettlementSummary) -> String {
        var out: [String] = []
        out.append("SETTLEMENT — \(summary.show.bandName)")
        out.append("\(summary.show.date) · \(summary.show.locationId)")
        out.append("")

        out.append("TICKETS")
        out.append(moneyLine("Gross", summary.ticketing.grossCents))
        out.append(moneyLine("Fees", summary.ticketing.feesCents))
        out.append(moneyLine("Net", summary.ticketing.netCents))
        let sources = ticketSourceRows(summary)
        if sources.isEmpty {
            out.append("  No ticket lines yet.")
        } else {
            for s in sources {
                out.append(line(s.label, "\(s.qty) · \(dollars(s.grossCents))"))
            }
        }
        out.append("")

        out.append("TOAST")
        out.append(moneyLine("Net sales", summary.toast.totalCents))
        out.append(line("Orders", String(summary.toast.ordersCount)))
        out.append(line("Guests", String(summary.toast.guestsCount)))
        if let warning = toastWarning(summary) {
            out.append("  ⚠ \(warning)")
        }
        out.append("")

        out.append("DEAL TERMS")
        out.append(moneyLine("Guarantee", summary.deal.guaranteeCents))
        out.append(line("vs % after costs", vsPctLabel(summary.deal.vsPctAfterCosts)))
        out.append(moneyLine("Buyout", summary.deal.buyoutCents))
        out.append("")

        out.append("COSTS OFF TOP")
        if summary.deal.costsOffTop.isEmpty {
            out.append("  No costs off top.")
        } else {
            for c in summary.deal.costsOffTop {
                out.append(moneyLine(c.label, c.cents))
            }
            out.append(moneyLine("Total costs off top", summary.costsOffTopCents))
        }
        out.append("")

        out.append("TALENT PAYOUT")
        out.append(moneyLine("Guarantee", summary.talent.guaranteeCents))
        out.append(moneyLine("vs bonus", summary.talent.vsBonusCents))
        out.append(moneyLine("Buyout", summary.talent.buyoutCents))
        out.append(moneyLine("Total", summary.talent.totalCents))
        out.append("")

        out.append("NET TO DOOR")
        out.append("  \(dollars(summary.netDoorCents))")
        out.append("  tickets net − costs off top − talent payout")
        out.append("")

        out.append("Computed \(summary.computedAt) · Lariat settlement · \(summary.show.bandName)")
        return out.joined(separator: "\n")
    }

    // ── helpers ───────────────────────────────────────────────────────

    static let labelWidth = 22

    static func line(_ label: String, _ value: String) -> String {
        let padded = label.count >= labelWidth
            ? label + " "
            : label + String(repeating: " ", count: labelWidth - label.count)
        return "  \(padded)\(value)"
    }

    static func moneyLine(_ label: String, _ cents: Int) -> String {
        line(label, dollars(cents))
    }

    static func grouped(_ n: Int) -> String {
        let digits = Array(String(n))
        var out: [Character] = []
        for (i, ch) in digits.enumerated() {
            let remaining = digits.count - i
            if i > 0 && remaining % 3 == 0 { out.append(",") }
            out.append(ch)
        }
        return String(out)
    }
}
