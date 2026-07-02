import Foundation
import GRDB
import LariatModel

/// READ-ONLY repository for the inspector-ready HACCP plan (`lib/haccpPlan.ts`,
/// GET /api/food-safety/haccp-plan). Runs the same location-scoped SELECTs the
/// web `buildHaccpPlan` runs and packs a raw `HaccpPlanBundle`; the pure
/// `HaccpPlanCompute.build` does the assembly.
///
/// This surface has NO write path, NO audit, NO RuleGate — it opens only the
/// read-only `LariatDatabase`. Every query is scoped to `location_id`.
public struct HaccpPlanRepository {
    let database: LariatDatabase
    let locationId: String

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    /// Fetch every row-set for the plan covering `today` (YYYY-MM-DD) back over
    /// the 30-day evidence window. Mirrors the queries in `buildHaccpPlan`.
    public func fetch(today: String) async throws -> HaccpPlanBundle {
        let windowStart = HaccpPlanCompute.isoMinusDays(today, HaccpPlanCompute.windowDays)
        let loc = locationId

        return try await database.pool.read { db in
            // ── CCP inventory + per-point monitoring evidence ──────────────
            let tempCounts = try HaccpTempCountRow.fetchAll(
                db,
                sql: """
                    SELECT point_id,
                           COUNT(*) AS logs,
                           SUM(CASE WHEN corrective_action IS NOT NULL
                                     AND TRIM(corrective_action) != '' THEN 1 ELSE 0 END) AS corrective
                      FROM temp_log
                     WHERE location_id = ? AND shift_date >= ? AND shift_date <= ?
                     GROUP BY point_id
                    """,
                arguments: [loc, windowStart, today]
            )

            // ── Cooling (CCP-8) summary ────────────────────────────────────
            let coolingRow = try HaccpCoolingRow.fetchOne(
                db,
                sql: """
                    SELECT COUNT(*) AS batches,
                           SUM(CASE WHEN status = 'breach' THEN 1 ELSE 0 END) AS breaches,
                           SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS open_now
                      FROM cooling_log
                     WHERE location_id = ? AND shift_date >= ? AND shift_date <= ?
                    """,
                arguments: [loc, windowStart, today]
            )

            // ── Rule-module inventory: per-table window counts ─────────────
            // Each (table, dateCol) mirrors the web `countWindow(...)` calls.
            // The identifiers are fixed literals — no untrusted interpolation.
            func countWindow(_ table: String, _ dateCol: String) throws -> Int {
                try Int.fetchOne(
                    db,
                    sql: """
                        SELECT COUNT(*) AS c FROM \(table)
                         WHERE location_id = ? AND \(dateCol) >= ? AND \(dateCol) <= ?
                        """,
                    arguments: [loc, windowStart, today]
                ) ?? 0
            }

            let moduleCounts: [String: Int] = [
                "receiving": try countWindow("receiving_log", "shift_date"),
                "date_marking": try countWindow("date_marks", "prepared_on"),
                "tphc": try countWindow("tphc_entries", "shift_date"),
                "sanitizer": try countWindow("sanitizer_checks", "shift_date"),
                "cleaning": try countWindow("cleaning_log", "shift_date"),
                "sick_worker": try countWindow("sick_worker_reports", "shift_date"),
                "pest_control": try countWindow("pest_control_log", "shift_date"),
            ]

            let sdsActive = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) AS c FROM sds_registry WHERE location_id = ? AND active = 1",
                arguments: [loc]
            ) ?? 0

            // ── Corrective-action log (temp_log + line_check_entries) ──────
            let tempLogCorrective = try HaccpTempLogCorrectiveRow.fetchAll(
                db,
                sql: """
                    SELECT id, shift_date, point_id, corrective_action, cook_id, created_at
                      FROM temp_log
                     WHERE location_id = ? AND shift_date >= ? AND shift_date <= ?
                       AND corrective_action IS NOT NULL AND TRIM(corrective_action) != ''
                     ORDER BY created_at DESC
                    """,
                arguments: [loc, windowStart, today]
            )
            let lineCheckCorrective = try HaccpLineCheckCorrectiveRow.fetchAll(
                db,
                sql: """
                    SELECT id, shift_date, station_id, item, note, cook_id, created_at
                      FROM line_check_entries
                     WHERE location_id = ? AND shift_date >= ? AND shift_date <= ?
                       AND status = 'fail' AND note IS NOT NULL AND TRIM(note) != ''
                     ORDER BY created_at DESC
                    """,
                arguments: [loc, windowStart, today]
            )

            // ── Calibration log (window) + probe status board (all history) ─
            let calibrationWindow = try HaccpCalibrationWindowRow.fetchAll(
                db,
                sql: """
                    SELECT id, thermometer_id, method, before_reading_f, after_reading_f,
                           passed, action_taken, cook_id, calibrated_at
                      FROM thermometer_calibrations
                     WHERE location_id = ?
                       AND substr(calibrated_at, 1, 10) >= ? AND substr(calibrated_at, 1, 10) <= ?
                     ORDER BY calibrated_at DESC, id DESC
                    """,
                arguments: [loc, windowStart, today]
            )
            let allCalibrations = try HaccpProbeCalibrationRow.fetchAll(
                db,
                sql: """
                    SELECT thermometer_id, method, before_reading_f, passed, calibrated_at, frequency_days
                      FROM thermometer_calibrations
                     WHERE location_id = ?
                    """,
                arguments: [loc]
            )

            return HaccpPlanBundle(
                locationId: loc,
                tempCounts: tempCounts,
                coolingRow: coolingRow,
                moduleCounts: moduleCounts,
                sdsActive: sdsActive,
                tempLogCorrective: tempLogCorrective,
                lineCheckCorrective: lineCheckCorrective,
                calibrationWindow: calibrationWindow,
                allCalibrations: allCalibrations
            )
        }
    }

    /// Convenience: fetch + assemble in one call. `generatedAt` defaults to now
    /// (ISO-8601 UTC) — the plan's timestamp stamp, mirroring the web's
    /// `new Date().toISOString()`.
    public func buildPlan(today: String, generatedAt: String? = nil) async throws -> HaccpPlan {
        let bundle = try await fetch(today: today)
        let stamp = generatedAt ?? Self.nowISO()
        return HaccpPlanCompute.build(bundle: bundle, today: today, generatedAt: stamp)
    }

    static func nowISO() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: Date())
    }
}
