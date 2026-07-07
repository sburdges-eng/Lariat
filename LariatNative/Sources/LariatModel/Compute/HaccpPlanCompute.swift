import Foundation

// Pure port of `buildHaccpPlan` in `lib/haccpPlan.ts`. The web function mixes DB
// reads with aggregation; this module does ONLY the aggregation the JS performs
// after its SELECTs. `HaccpPlanRepository` owns the reads and packs a
// `HaccpPlanBundle`; `build(bundle:today:generatedAt:)` assembles the plan.
//
// READ-ONLY: no writes, no audit, no clock read inside the pure function
// (`generatedAt` is injected so the assembly is deterministic and testable —
// the web's `new Date().toISOString()` is supplied by the caller).
//
// All numbers/citations are copied faithfully from the web rule modules.

public enum HaccpPlanCompute {

    public static let windowDays = 30

    // ── Assembled citations (mirror the TS module-level constants) ─────────

    /// COOLING_CITATION — assembled from lib/cooling.ts constants.
    /// STAGE1_MAX_MINUTES/60 = 2 h, STAGE2_MAX_MINUTES/60 = 4 h.
    public static let coolingCitation =
        "FDA §3-501.14 — two-stage cooling: 135→\(intF(CoolingCompute.stage1CeilingF))°F within " +
        "\(CoolingCompute.stage1MaxMinutes / 60) h, then to \(intF(CoolingCompute.stage2CeilingF))°F within " +
        "\(CoolingCompute.stage2MaxMinutes / 60) h more"

    /// CALIBRATION_CITATION — pulled from lib/calibrations.ts's validation result.
    public static let calibrationCitation =
        "FDA §4-502.11 — temp measuring device accurate within ±2°F"

    /// TPHC_CITATION — assembled from lib/tphc.ts constants (hot 4 h / cold 6 h).
    public static let tphcCitation =
        "FDA §3-501.19 — time as a public health control: hot \(tphcHotHours) h / " +
        "cold \(tphcColdHours) h caps"

    /// CORRECTIVE_ACTION_CITATION from lib/correctiveActions.ts.
    public static let correctiveActionCitation = "FDA 2022 §8-405.11"

    // Constants copied from the rule modules (kept local so the Swift port never
    // drifts from the web wording).
    private static let tphcHotHours = 4
    private static let tphcColdHours = 6
    public static let defaultFrequencyDays = 30
    private static let dueSoonWindowDays = 7.0

    /// Format a Double critical-limit like the web template literal (70, not 70.0).
    private static func intF(_ v: Double) -> String {
        if v == v.rounded() { return String(Int(v)) }
        return String(v)
    }

    // ── Date window (mirror isoMinusDays) ──────────────────────────────────

    /// `isoMinusDays(today, days)` — UTC date arithmetic on a YYYY-MM-DD string.
    /// Returns the ISO date `days` before `today`, or `today` unchanged if it
    /// cannot be parsed (defensive; the route only passes a validated date).
    public static func isoMinusDays(_ isoDate: String, _ days: Int) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let f = DateFormatter()
        f.calendar = cal
        f.timeZone = cal.timeZone
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        guard let base = f.date(from: isoDate),
              let shifted = cal.date(byAdding: .day, value: -days, to: base) else {
            return isoDate
        }
        return f.string(from: shifted)
    }

    // ── Plan assembly (mirror buildHaccpPlan) ──────────────────────────────

    /// Assemble the plan from a raw bundle. `today` is the plan date (YYYY-MM-DD);
    /// `generatedAt` is the ISO timestamp the caller stamps (web: `new Date().toISOString()`).
    public static func build(bundle: HaccpPlanBundle, today: String, generatedAt: String) -> HaccpPlan {
        let windowStart = isoMinusDays(today, windowDays)

        // ── CCP inventory + per-point monitoring evidence ──────────────────
        let countByPoint = Dictionary(
            bundle.tempCounts.map { ($0.pointId, $0) },
            uniquingKeysWith: { _, last in last }
        )
        let ccps: [HaccpPlanCcp] = TempLogCompute.points.map { p in
            let c = countByPoint[p.id]
            return HaccpPlanCcp(
                pointId: p.id,
                label: p.label,
                ccpId: p.ccpId,
                requiredMinF: p.requiredMinF,
                requiredMaxF: p.requiredMaxF,
                citation: p.citation,
                logs30d: c?.logs ?? 0,
                corrective30d: c?.corrective ?? 0
            )
        }

        // ── Cooling (CCP-8) summary ────────────────────────────────────────
        let coolingRow = bundle.coolingRow
        let cooling = HaccpCoolingSummary(
            citation: coolingCitation,
            batches30d: coolingRow?.batches ?? 0,
            breaches30d: coolingRow?.breaches ?? 0,
            openNow: coolingRow?.openNow ?? 0
        )

        // ── Rule-module inventory ──────────────────────────────────────────
        let windowLabel = "entries in last \(windowDays) days"
        let mc = bundle.moduleCounts
        // Mirror moduleDefs[] order exactly.
        let moduleDefs: [(id: String, name: String, citation: String, records: Int, evidenceLabel: String)] = [
            (
                id: "receiving",
                name: "Receiving",
                citation: "FDA §3-202.11 — receiving temperatures; §3-202.15 — package integrity",
                records: mc["receiving"] ?? 0,
                evidenceLabel: windowLabel
            ),
            (
                id: "date_marking",
                name: "Date marking",
                citation: "FDA §3-501.17 — RTE TCS food held >24 h discarded within 7 days (prep day = day 1)",
                records: mc["date_marking"] ?? 0,
                evidenceLabel: "batches marked in last \(windowDays) days"
            ),
            (
                id: "tphc",
                name: "Time as a public health control",
                citation: tphcCitation,
                records: mc["tphc"] ?? 0,
                evidenceLabel: windowLabel
            ),
            (
                id: "sanitizer",
                name: "Sanitizer checks",
                citation: "FDA §4-703.11 — sanitizing food-contact surfaces (chemistry-specific ppm bands)",
                records: mc["sanitizer"] ?? 0,
                evidenceLabel: "checks in last \(windowDays) days"
            ),
            (
                id: "cleaning",
                name: "Cleaning log",
                citation: "FDA §4-602.11 — food-contact surfaces cleaned at the frequency required to keep equipment safe",
                records: mc["cleaning"] ?? 0,
                evidenceLabel: "completions in last \(windowDays) days"
            ),
            (
                id: "sick_worker",
                name: "Employee health",
                citation: "FDA §2-201.11 — reportable symptoms and Big-6 diagnoses; exclude or restrict",
                records: mc["sick_worker"] ?? 0,
                evidenceLabel: "reports in last \(windowDays) days"
            ),
            (
                id: "pest_control",
                name: "Pest control",
                citation: "FDA §6-501.111 — controlling pests; minimizing presence of pests on the premises",
                records: mc["pest_control"] ?? 0,
                evidenceLabel: windowLabel
            ),
            (
                id: "sds",
                name: "Safety Data Sheets",
                citation: "OSHA 29 CFR 1910.1200 — Hazard Communication Standard (HCS 2012, GHS-aligned)",
                records: bundle.sdsActive,
                evidenceLabel: "active sheets on file"
            ),
        ]
        let ruleModules: [HaccpRuleModule] = moduleDefs.map { m in
            HaccpRuleModule(
                id: m.id, name: m.name, citation: m.citation,
                records: m.records, evidenceLabel: m.evidenceLabel,
                active: m.records > 0
            )
        }

        // ── Corrective-action log (merge + sort newest-first) ──────────────
        let correctiveEntries = mergeCorrectiveActions(
            tempLogRows: bundle.tempLogCorrective,
            lineCheckRows: bundle.lineCheckCorrective
        )

        // ── Calibration log (window) + probe status board (all history) ────
        let calibrationRecords: [HaccpCalibrationRecord] = bundle.calibrationWindow.map { r in
            HaccpCalibrationRecord(
                id: r.id,
                thermometerId: r.thermometerId,
                method: r.method,
                beforeReadingF: r.beforeReadingF,
                afterReadingF: r.afterReadingF,
                passed: r.passed == 1,
                actionTaken: r.actionTaken,
                cookId: r.cookId,
                calibratedAt: r.calibratedAt
            )
        }
        // Evaluate probe status at end of plan_date (today T23:59:59Z) so the plan
        // is reproducible for a given (location, date) pair — mirrors the web.
        let probes = classifyProbes(bundle.allCalibrations, nowISO: "\(today)T23:59:59Z")

        return HaccpPlan(
            locationId: bundle.locationId,
            planDate: today,
            windowStart: windowStart,
            windowDays: windowDays,
            generatedAt: generatedAt,
            ccps: ccps,
            cooling: cooling,
            ruleModules: ruleModules,
            correctiveActions: HaccpCorrectiveSection(
                citation: correctiveActionCitation,
                count: correctiveEntries.count,
                entries: correctiveEntries
            ),
            calibrations: HaccpCalibrationSection(
                citation: calibrationCitation,
                frequencyDaysDefault: defaultFrequencyDays,
                records: calibrationRecords,
                probes: probes
            )
        )
    }

    // ── mergeCorrectiveActions (port of lib/correctiveActions.ts) ──────────

    /// Merge corrective-action rows from temp_log and line_check_entries into a
    /// single chronologically-sorted feed (newest first). Mirrors
    /// `mergeCorrectiveActions`: the caller pre-filters the source rows.
    public static func mergeCorrectiveActions(
        tempLogRows: [HaccpTempLogCorrectiveRow],
        lineCheckRows: [HaccpLineCheckCorrectiveRow]
    ) -> [HaccpCorrectiveEntry] {
        var out: [HaccpCorrectiveEntry] = []
        for r in tempLogRows {
            out.append(HaccpCorrectiveEntry(
                source: .tempLog,
                entryId: r.id,
                shiftDate: r.shiftDate,
                // temp_log rows aren't station-scoped — point_id is the subject.
                stationId: nil,
                subject: r.pointId,
                note: r.correctiveAction,
                cookId: r.cookId,
                createdAt: r.createdAt
            ))
        }
        for r in lineCheckRows {
            out.append(HaccpCorrectiveEntry(
                source: .lineCheck,
                entryId: r.id,
                shiftDate: r.shiftDate,
                stationId: r.stationId,
                subject: "\(r.stationId): \(r.item)",
                note: r.note,
                cookId: r.cookId,
                createdAt: r.createdAt
            ))
        }
        // Sort: created_at DESC; ties → source ASC then entry_id DESC (stable).
        out.sort { a, b in
            if a.createdAt != b.createdAt {
                return a.createdAt > b.createdAt
            }
            if a.source != b.source {
                return a.source.rawValue < b.source.rawValue
            }
            return a.entryId > b.entryId
        }
        return out
    }

    // ── classifyProbes (port of lib/calibrations.ts) ───────────────────────

    /// Aggregate calibration rows into one summary per probe. `nowISO` is the
    /// evaluation instant (web passes `today+'T23:59:59Z'`). Mirrors
    /// `classifyProbes` including its status precedence + stable sort.
    public static func classifyProbes(
        _ rows: [HaccpProbeCalibrationRow],
        nowISO: String,
        frequencyDays: Int = defaultFrequencyDays
    ) -> [HaccpProbeSummary] {
        let now = parseTs(nowISO) ?? Date()

        // Group by thermometer_id (skip blank ids).
        var grouped: [String: [HaccpProbeCalibrationRow]] = [:]
        var order: [String] = []
        for r in rows {
            if r.thermometerId.isEmpty { continue }
            if grouped[r.thermometerId] == nil { order.append(r.thermometerId) }
            grouped[r.thermometerId, default: []].append(r)
        }

        var out: [HaccpProbeSummary] = []
        for id in order {
            let bucket = grouped[id] ?? []
            // Sort newest-first (lexicographic on calibrated_at, matching TS).
            let sorted = bucket.sorted { ($0.calibratedAt) > ($1.calibratedAt) }
            guard let last = sorted.first else { continue }

            let freq = (last.frequencyDays ?? 0) > 0 ? last.frequencyDays! : frequencyDays
            let passed = last.passed == 1

            var status: HaccpProbeStatus
            var nextDue: String? = nil
            if !passed {
                status = .failed
            } else if let lastAt = parseTs(last.calibratedAt) {
                let dueMs = lastAt.timeIntervalSince1970 + Double(freq) * 86400.0
                let dueDate = Date(timeIntervalSince1970: dueMs)
                nextDue = isoStringZ(dueDate)
                let daysRemaining = (dueMs - now.timeIntervalSince1970) / 86400.0
                if daysRemaining < 0 {
                    status = .overdue
                } else if daysRemaining <= dueSoonWindowDays {
                    status = .dueSoon
                } else {
                    status = .ok
                }
            } else {
                // Passed but unparseable timestamp — treat as 'ok'.
                status = .ok
            }

            let method: String?
            switch last.method {
            case "ice_point", "boiling_point", "reference_probe": method = last.method
            default: method = nil
            }

            out.append(HaccpProbeSummary(
                thermometerId: id,
                status: status,
                lastCalibratedAt: last.calibratedAt,
                lastMethod: method,
                lastReadingF: last.beforeReadingF,
                lastPassed: passed,
                nextDueAt: nextDue,
                frequencyDays: freq,
                total: bucket.count
            ))
        }

        // Stable order: failed → overdue → due_soon → unknown → ok, tie-break by id.
        let rank: [HaccpProbeStatus: Int] = [
            .failed: 0, .overdue: 1, .dueSoon: 2, .unknown: 3, .ok: 4,
        ]
        out.sort { a, b in
            let ra = rank[a.status] ?? 5
            let rb = rank[b.status] ?? 5
            if ra != rb { return ra < rb }
            return a.thermometerId < b.thermometerId
        }
        return out
    }

    /// Port of `calibrationWarningFor` (lib/calibrations.ts): the per-write
    /// advisory emitted when a CCP reading cites a probe. Returns nil for
    /// `ok`/`due_soon` — due_soon is a board-level signal, not a per-write block.
    public static func calibrationWarningFor(_ summary: HaccpProbeSummary?) -> String? {
        guard let summary else { return nil }
        switch summary.status {
        case .unknown:
            return "probe \"\(summary.thermometerId)\" has no calibration on record — log an ice-point or boiling-point calibration before using it for a CCP reading"
        case .failed:
            return "probe \"\(summary.thermometerId)\" failed its last calibration on \(summary.lastCalibratedAt ?? "?") — recalibrate before using it for a CCP reading"
        case .overdue:
            return "probe \"\(summary.thermometerId)\" is overdue for calibration (last: \(summary.lastCalibratedAt ?? "?"), due: \(summary.nextDueAt ?? "?")) — recalibrate"
        case .ok, .dueSoon:
            return nil
        }
    }

    // ── Timestamp parsing (mirror parseTs in lib/calibrations.ts) ──────────

    /// Parse a sqlite-style timestamp: 'YYYY-MM-DD HH:MM:SS', 'YYYY-MM-DD', or an
    /// ISO string with tz. Treated as UTC when no tz. Returns nil on bad input.
    static func parseTs(_ s: String?) -> Date? {
        guard let s = s, !s.isEmpty else { return nil }
        let hasTz = s.range(of: "[zZ]|[+-]\\d\\d:?\\d\\d$", options: .regularExpression) != nil
        let iso = hasTz ? s.replacingOccurrences(of: " ", with: "T")
                        : s.replacingOccurrences(of: " ", with: "T") + "Z"
        if let d = isoParser.date(from: iso) { return d }
        if let d = isoParserFraction.date(from: iso) { return d }
        // 'YYYY-MM-DD' (no time component) → append midnight.
        let midnight = hasTz ? iso : (s + "T00:00:00Z")
        return isoParser.date(from: midnight)
    }

    private static let isoParser: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static let isoParserFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// Format a Date as an ISO-8601 UTC string with milliseconds, matching
    /// JS `Date.toISOString()` (e.g. "2026-07-05T23:59:59.000Z").
    private static func isoStringZ(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: d)
    }
}
