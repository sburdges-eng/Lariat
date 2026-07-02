import Foundation

// GRDB-free port of the assembly half of `lib/morningDigest.ts`.
//
// The repository (MorningRepository) runs every SELECT and packs the raw
// row-sets into a `MorningBundle`; the command-summary half is produced by the
// already-ported `CommandCompute.summarize` + `alertsFor`. This module does ONLY
// the derivation `buildMorningDigest` performs AFTER its queries:
//   - cert day-window filter  (days_until in [0, 7])
//   - maintenance filter       (days_until <= 0)
//   - section shaping          ({ count, items })
//   - the webhook-ready Slack text (formatSlackText)
//
// No database, no clock — `today` is a parameter so the output is deterministic
// and parity-auditable against tests/js/test-morning-digest.mjs.

public enum MorningCompute {

    // MARK: - Date helpers (UTC start-of-day — matches the web's daysBetween)

    private static let isoCalDayUTC: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    /// `daysBetween(base, target)` — floor((target00Z - base00Z)/86400000).
    /// Mirrors the web helper exactly (UTC midnight, whole-day floor).
    static func daysBetween(_ baseIsoDate: String, _ targetIsoDate: String) -> Int? {
        guard let base = isoCalDayUTC.date(from: baseIsoDate),
              let target = isoCalDayUTC.date(from: targetIsoDate) else { return nil }
        let ms = (target.timeIntervalSince1970 - base.timeIntervalSince1970) * 1000.0
        return Int(floor(ms / 86_400_000.0))
    }

    // MARK: - Formatting helpers (mirror the TS module)

    /// `plural(n, one, many)` → "1 item" / "3 items".
    static func plural(_ n: Int, _ one: String, _ many: String) -> String {
        "\(n) \(n == 1 ? one : many)"
    }

    /// `fmtPct(n)` — "+5.0%", "-3.2%", or "—" for null/non-finite. Public so the
    /// native view can reuse the exact web format for price-shock deltas.
    public static func fmtPct(_ n: Double?) -> String {
        guard let n, n.isFinite else { return "—" }
        let sign = n > 0 ? "+" : ""
        return "\(sign)\(String(format: "%.1f", n))%"
    }

    // MARK: - assemble

    /// Assemble the morning digest from the command summary + the morning bundle.
    /// `alerts` are derived via CommandCompute.alertsFor(summary) — the same list
    /// the /command page and Slack "Heads-up" line consume.
    public static func assemble(
        summary: CommandSummary,
        bundle: MorningBundle,
        locationId: String,
        today: String
    ) -> MorningDigest {
        let alerts = CommandCompute.alertsFor(summary)

        // 86 board — repo already ordered id DESC, limit 10; count is the full unresolved total.
        let eightySix = MorningSection(count: bundle.eightySixCount, items: bundle.eightySixItems)

        // Price shocks — repo already ranked by |delta| DESC, capped at 10 (windowDays 7, minPct 5).
        let priceShocks = MorningSection(count: bundle.priceShocks.count, items: bundle.priceShocks)

        // Certs — map days_until, keep 0…7, slice(0, 10). Repo ordered expires_on ASC, cook_id ASC.
        let certItems = bundle.certRows.compactMap { row -> MorningCertItem? in
            guard let days = daysBetween(today, row.expiresOn) else { return nil }
            guard days >= 0 && days <= 7 else { return nil }
            return MorningCertItem(cookId: row.cookId, certLabel: row.certLabel,
                                   certType: row.certType, expiresOn: row.expiresOn, daysUntil: days)
        }.prefix(10)
        let certs = MorningSection(count: certItems.count, items: Array(certItems))

        // Maintenance — map days_until, keep <= 0 (past-or-today), slice(0, 10).
        // Repo ordered next_due ASC, name ASC.
        let maintItems = bundle.maintenanceRows.compactMap { row -> MorningMaintenanceItem? in
            guard let days = daysBetween(today, row.nextDue) else { return nil }
            guard days <= 0 else { return nil }
            return MorningMaintenanceItem(equipmentName: row.equipmentName, task: row.task,
                                          frequency: row.frequency, nextDue: row.nextDue, daysUntil: days)
        }.prefix(10)
        let maintenance = MorningSection(count: maintItems.count, items: Array(maintItems))

        // BEO prep — repo already filtered to open-task events (HAVING open > 0), ordered + limited.
        let beoItems = bundle.beoRows.map { r in
            MorningBeoPrepItem(eventId: r.eventId, title: r.title, eventDate: r.eventDate,
                               eventTime: r.eventTime, guestCount: r.guestCount,
                               openTasks: r.openTasks, doneTasks: r.doneTasks, totalTasks: r.totalTasks)
        }
        let beoPrep = MorningSection(count: beoItems.count, items: beoItems)

        let core = MorningDigestCore(
            shiftDate: today, alerts: alerts,
            eightySix: eightySix, priceShocks: priceShocks,
            certs: certs, maintenance: maintenance, beoPrep: beoPrep)

        return MorningDigest(
            shiftDate: today,
            locationId: locationId,
            alerts: alerts,
            eightySix: eightySix,
            priceShocks: priceShocks,
            certsExpiringWeek: certs,
            maintenanceDue: maintenance,
            beoPrep: beoPrep,
            webhookText: formatSlackText(core))
    }

    // MARK: - Slack text

    /// Intermediate carrier for formatSlackText — the `Omit<MorningDigest, 'webhook'>`
    /// shape the web passes to its formatter.
    struct MorningDigestCore {
        let shiftDate: String
        let alerts: [CommandAlert]
        let eightySix: MorningSection<MorningEightySixItem>
        let priceShocks: MorningSection<MorningPriceShock>
        let certs: MorningSection<MorningCertItem>
        let maintenance: MorningSection<MorningMaintenanceItem>
        let beoPrep: MorningSection<MorningBeoPrepItem>
    }

    /// Port of `formatSlackText` — a `\n`-joined webhook-ready string.
    static func formatSlackText(_ d: MorningDigestCore) -> String {
        var lines: [String] = [
            "Morning digest · \(d.shiftDate)",
            "86 board: \(plural(d.eightySix.count, "item", "items"))",
            "Price shocks: \(plural(d.priceShocks.count, "item", "items"))",
            "Certs this week: \(plural(d.certs.count, "cert", "certs"))",
            "Maintenance due: \(plural(d.maintenance.count, "task", "tasks"))",
            "BEO prep: \(plural(d.beoPrep.count, "event", "events"))",
        ]

        if d.eightySix.items.first != nil {
            let top = d.eightySix.items.prefix(3).map { $0.item }.joined(separator: ", ")
            lines.append("86 details: \(top)")
        }
        if d.priceShocks.items.first != nil {
            let top = d.priceShocks.items.prefix(3)
                .map { "\($0.ingredient) \(fmtPct($0.deltaPct))" }
                .joined(separator: ", ")
            lines.append("Price details: \(top)")
        }
        if d.certs.items.first != nil {
            let top = d.certs.items.prefix(3)
                .map { "\($0.cookId) \($0.expiresOn)" }
                .joined(separator: ", ")
            lines.append("Cert details: \(top)")
        }
        if d.maintenance.items.first != nil {
            let top = d.maintenance.items.prefix(3)
                .map { "\($0.equipmentName) · \($0.task)" }
                .joined(separator: ", ")
            lines.append("Maintenance details: \(top)")
        }
        if d.beoPrep.items.first != nil {
            let top = d.beoPrep.items.prefix(3)
                .map { "\($0.title) (\($0.openTasks) open)" }
                .joined(separator: ", ")
            lines.append("BEO details: \(top)")
        }

        if d.alerts.first != nil {
            let heads = d.alerts.prefix(3).map { $0.message }.joined(separator: " | ")
            lines.append("Heads-up: \(heads)")
        }

        return lines.joined(separator: "\n")
    }
}
