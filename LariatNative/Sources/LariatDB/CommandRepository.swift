import Foundation
import GRDB
import LariatModel

// `CommandBundle` is defined in LariatModel (Compute/CommandCompute.swift) so it
// is shared by both this repository and the GRDB-free CommandCompute layer.
// The `Cmd*` projection records it holds also live in LariatModel (Records.swift).

public struct CommandRepository {
    let database: LariatDatabase
    let locationId: String

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    public func fetch(today: String) async throws -> CommandBundle {
        // Compute yesterday from today
        let yesterday: String = {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            formatter.timeZone = TimeZone(identifier: "UTC")
            guard let d = formatter.date(from: today) else { return today }
            let prev = Calendar(identifier: .gregorian).date(byAdding: .day, value: -1, to: d)!
            return formatter.string(from: prev)
        }()
        // Compute since7 (6 days before today, inclusive window of 7 days)
        let since7: String = {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            formatter.timeZone = TimeZone(identifier: "UTC")
            guard let d = formatter.date(from: today) else { return today }
            let prev = Calendar(identifier: .gregorian).date(byAdding: .day, value: -6, to: d)!
            return formatter.string(from: prev)
        }()

        return try await database.pool.read { db in
            // 1. Yesterday sales row
            let salesYesterday = try CmdSalesDailyRow.fetchOne(db,
                sql: """
                    SELECT net_sales, orders, guests
                      FROM toast_sales_daily
                     WHERE location_id = ? AND comparison_group = 1 AND shift_date = ?
                    """,
                arguments: [locationId, yesterday])

            // 2. Trailing 7-day average
            let salesTrailing = try CmdSalesTrailingAvg.fetchOne(db,
                sql: """
                    SELECT AVG(net_sales) AS avg_sales, AVG(orders) AS avg_orders
                      FROM (
                        SELECT net_sales, orders FROM toast_sales_daily
                         WHERE location_id = ? AND comparison_group = 1
                           AND shift_date < ?
                         ORDER BY shift_date DESC LIMIT 7
                      )
                    """,
                arguments: [locationId, today])

            // 3. 86'd items today
            let eightySixCount = try Int.fetchOne(db,
                sql: """
                    SELECT COUNT(*) FROM eighty_six
                     WHERE location_id = ? AND shift_date = ? AND resolved_at IS NULL
                    """,
                arguments: [locationId, today]) ?? 0

            // 4. Low-par ingredients (inventory_par JOIN inventory_count_lines)
            let lowParIngredients = try CmdLowParIngredient.fetchAll(db,
                sql: """
                    SELECT p.ingredient
                      FROM inventory_par p
                      JOIN (
                        SELECT l1.ingredient, l1.sku, l1.on_hand_qty
                          FROM inventory_count_lines l1
                         WHERE l1.location_id = ?
                           AND l1.counted_at = (
                             SELECT MAX(l2.counted_at)
                               FROM inventory_count_lines l2
                              WHERE l2.location_id = l1.location_id
                                AND l2.ingredient = l1.ingredient
                                AND COALESCE(l2.sku,'') = COALESCE(l1.sku,'')
                           )
                      ) AS latest
                        ON latest.ingredient = p.ingredient
                       AND COALESCE(latest.sku,'') = COALESCE(p.sku,'')
                     WHERE p.location_id = ?
                       AND p.par_qty IS NOT NULL
                       AND latest.on_hand_qty IS NOT NULL
                       AND latest.on_hand_qty < p.par_qty
                    """,
                arguments: [locationId, locationId])

            // 5. Par total
            let parTotal = try Int.fetchOne(db,
                sql: "SELECT COUNT(*) FROM inventory_par WHERE location_id = ?",
                arguments: [locationId]) ?? 0

            // 6. Open inventory counts
            let openCountsCount = try Int.fetchOne(db,
                sql: "SELECT COUNT(*) FROM inventory_counts WHERE location_id = ? AND closed_at IS NULL",
                arguments: [locationId]) ?? 0

            // 7. Shift breaks for today
            let shiftBreaks = try CmdShiftBreakRow.fetchAll(db,
                sql: "SELECT ended_at, waived FROM shift_breaks WHERE location_id = ? AND shift_date = ?",
                arguments: [locationId, today])

            // 8. Staff certifications (active, non-null expires_on)
            let certRows = try CmdCertRow.fetchAll(db,
                sql: "SELECT expires_on FROM staff_certifications WHERE location_id = ? AND expires_on IS NOT NULL AND active = 1",
                arguments: [locationId])

            // 9. Performance reviews today
            let performanceReviewsToday = try Int.fetchOne(db,
                sql: "SELECT COUNT(*) FROM performance_reviews WHERE location_id = ? AND review_date = ?",
                arguments: [locationId, today]) ?? 0

            // 10. Performance reviews total
            let performanceReviewsTotal = try Int.fetchOne(db,
                sql: "SELECT COUNT(*) FROM performance_reviews WHERE location_id = ?",
                arguments: [locationId]) ?? 0

            // 11. Temp log for today
            let tempLogRows = try CmdTempLogRow.fetchAll(db,
                sql: """
                    SELECT id, point_id, reading_f, required_min_f, required_max_f,
                           corrective_action, created_at
                      FROM temp_log
                     WHERE location_id = ? AND shift_date = ?
                    """,
                arguments: [locationId, today])

            // 12. Active date marks
            let dateMarkRows = try CmdDateMarkRow.fetchAll(db,
                sql: """
                    SELECT id, item, prepared_on, discard_on, discarded_at
                      FROM date_marks
                     WHERE location_id = ? AND discarded_at IS NULL
                    """,
                arguments: [locationId])

            // 13. Thermometer calibrations
            let calibrationRows = try CmdCalibrationRow.fetchAll(db,
                sql: """
                    SELECT thermometer_id, method, before_reading_f, passed,
                           calibrated_at, frequency_days
                      FROM thermometer_calibrations
                     WHERE location_id = ?
                    """,
                arguments: [locationId])

            // 14. Cleaning counts for today
            let cleaningCounts = try CmdCleaningCounts.fetchOne(db,
                sql: """
                    SELECT
                      SUM(CASE WHEN next_due IS NOT NULL AND next_due < ? THEN 1 ELSE 0 END) AS overdue,
                      SUM(CASE WHEN next_due = ? THEN 1 ELSE 0 END) AS due_today
                     FROM cleaning_schedule
                    WHERE location_id = ? AND active = 1 AND archived_at IS NULL
                    """,
                arguments: [today, today, locationId])

            // 15. Preshift notes today
            let preshiftNoteCount = try Int.fetchOne(db,
                sql: "SELECT COUNT(*) FROM preshift_notes WHERE location_id = ? AND shift_date = ?",
                arguments: [locationId, today]) ?? 0

            // 16. BEO events today — use typed projection to avoid Double/Int64 decode ambiguity
            let eventsRow = try BeoEventsCount.fetchOne(db,
                sql: """
                    SELECT COUNT(*) AS c, COALESCE(SUM(guest_count), 0) AS guests
                      FROM beo_events
                     WHERE location_id = ? AND event_date = ?
                       AND COALESCE(status,'') NOT IN ('cancelled','canceled')
                    """,
                arguments: [locationId, today])
            let eventsCount: Int = eventsRow?.c ?? 0
            let eventsGuests: Int = eventsRow?.guests ?? 0

            // 17. Reservations by status for today
            let reservationRows = try CmdReservationRow.fetchAll(db,
                sql: """
                    SELECT status, COUNT(*) AS c FROM reservations
                     WHERE location_id = ?
                       AND substr(reservation_at, 1, 10) = ?
                     GROUP BY status
                    """,
                arguments: [locationId, today])

            // 18. Prep tasks for today
            let prepTaskRows = try CmdPrepTaskRow.fetchAll(db,
                sql: "SELECT status, priority FROM prep_tasks WHERE location_id = ? AND shift_date = ?",
                arguments: [locationId, today])

            // 19. Waste today
            let wasteTodayCount = try Int.fetchOne(db,
                sql: "SELECT COUNT(*) FROM inventory_updates WHERE location_id = ? AND direction = 'waste' AND shift_date = ?",
                arguments: [locationId, today]) ?? 0

            // 20. Waste last 7 days
            let waste7dCount = try Int.fetchOne(db,
                sql: "SELECT COUNT(*) FROM inventory_updates WHERE location_id = ? AND direction = 'waste' AND shift_date >= ?",
                arguments: [locationId, since7]) ?? 0

            // 21. Dining tables
            let diningTableRows = try CmdDiningTableRow.fetchAll(db,
                sql: "SELECT status, COALESCE(capacity, 0) AS capacity FROM dining_tables WHERE location_id = ?",
                arguments: [locationId])

            return CommandBundle(
                salesYesterday: salesYesterday,
                salesTrailing: salesTrailing,
                eightySixCount: eightySixCount,
                lowParIngredients: lowParIngredients,
                parTotal: parTotal,
                openCountsCount: openCountsCount,
                shiftBreaks: shiftBreaks,
                certRows: certRows,
                performanceReviewsToday: performanceReviewsToday,
                performanceReviewsTotal: performanceReviewsTotal,
                tempLogRows: tempLogRows,
                dateMarkRows: dateMarkRows,
                calibrationRows: calibrationRows,
                cleaningCounts: cleaningCounts,
                preshiftNoteCount: preshiftNoteCount,
                eventsCount: eventsCount,
                eventsGuests: eventsGuests,
                reservationRows: reservationRows,
                prepTaskRows: prepTaskRows,
                wasteTodayCount: wasteTodayCount,
                waste7dCount: waste7dCount,
                diningTableRows: diningTableRows
            )
        }
    }
}
