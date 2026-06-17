import XCTest
@testable import LariatModel

/// Parity tests for CommandCompute — the Swift port of commandCenter.ts's
/// `summarize` + `alertsFor`. The input CommandBundle is built as a literal
/// from the SAME values the Task 7 fixture seeds (data/Fixtures.swift) so the
/// assertions are a faithful hand-derivation of the web logic.
///
/// `today` is pinned to "2026-06-16" because two fixture inputs carry hardcoded
/// calendar dates that the web logic grades against `today`:
///   - staff_certifications.expires_on (2026-05-01 / 2026-07-01 / 2027-01-01)
///   - all date('now')-relative rows are reproduced here as their 2026-06-16 values
final class CommandComputeTests: XCTestCase {

    private let today = "2026-06-16"
    // yesterdayISO("2026-06-16") = "2026-06-15"
    private let yesterday = "2026-06-15"

    /// Build the CommandBundle exactly as CommandRepository.fetch would, but as a
    /// literal pinned to today=2026-06-16. Each field is annotated with the fixture
    /// row(s) it derives from.
    private func fixtureBundle() -> CommandBundle {
        CommandBundle(
            // toast_sales_daily comparison_group=1, shift_date=2026-06-15
            salesYesterday: CmdSalesDailyRow(netSales: 4200.0, orders: 180, guests: 230),
            // AVG over the two cg=1 rows with shift_date < 2026-06-16:
            //   (4200+3900)/2 = 4050 ; (180+165)/2 = 172.5
            salesTrailing: CmdSalesTrailingAvg(avgSales: 4050.0, avgOrders: 172.5),
            // eighty_six: Lobster Bisque unresolved today; Mahi resolved → count=1
            eightySixCount: 1,
            // inventory_par⋈count_lines: only Flour (on_hand 2 < par 5) is below par
            lowParIngredients: [CmdLowParIngredient(ingredient: "Flour")],
            // inventory_par: 3 rows (Flour, Butter, Salt)
            parTotal: 3,
            // inventory_counts: 1 open (closed_at NULL)
            openCountsCount: 1,
            // shift_breaks today: one open (ended_at NULL, waived 0), one ended
            shiftBreaks: [
                CmdShiftBreakRow(endedAt: nil, waived: 0),
                CmdShiftBreakRow(endedAt: "2026-06-16 12:00:00", waived: 0),
            ],
            // staff_certifications active w/ expires_on (3 rows)
            certRows: [
                CmdCertRow(expiresOn: "2026-05-01"), // expired
                CmdCertRow(expiresOn: "2026-07-01"), // 15d → expiring 30d
                CmdCertRow(expiresOn: "2027-01-01"), // far → neither
            ],
            // performance_reviews: 2 today, 3 total
            performanceReviewsToday: 2,
            performanceReviewsTotal: 3,
            // temp_log today: point_ids are 'WALK-IN-COOLER'/'REACH-IN-COOLER' which are
            // NOT in the TempPoints registry → classifyReadings drops both → temp_breaches=0.
            // temp_readings is the RAW row count (=2).
            tempLogRows: [
                CmdTempLogRow(id: 1, pointId: "WALK-IN-COOLER", readingF: 38.0,
                              requiredMinF: 33.0, requiredMaxF: 41.0,
                              correctiveAction: nil, createdAt: "2026-06-16 06:00:00"),
                CmdTempLogRow(id: 2, pointId: "REACH-IN-COOLER", readingF: 55.0,
                              requiredMinF: 33.0, requiredMaxF: 41.0,
                              correctiveAction: "Adjusted cooler", createdAt: "2026-06-16 08:00:00"),
            ],
            // date_marks active (discarded_at NULL): one expired (discard 2026-06-15),
            // one due_today (discard 2026-06-16). 'Old Sauce' is discarded → not in bundle.
            dateMarkRows: [
                CmdDateMarkRow(id: 1, item: "Chicken Stock", preparedOn: "2026-06-12",
                               discardOn: "2026-06-15", discardedAt: nil),
                CmdDateMarkRow(id: 2, item: "Hollandaise", preparedOn: "2026-06-16",
                               discardOn: "2026-06-16", discardedAt: nil),
            ],
            // thermometer_calibrations: both passed, both within their 30-day window
            // relative to today=2026-06-16 → all probes 'ok' → overdue/failed/due_soon = 0.
            calibrationRows: [
                CmdCalibrationRow(thermometerId: "THERM-001", method: "ice_point",
                                  beforeReadingF: 32.2, passed: 1,
                                  calibratedAt: "2026-06-09 09:00:00", frequencyDays: 30),
                CmdCalibrationRow(thermometerId: "THERM-002", method: "ice_point",
                                  beforeReadingF: 31.8, passed: 1,
                                  calibratedAt: "2026-06-02 09:00:00", frequencyDays: 30),
            ],
            // cleaning_schedule: overdue=1 (next_due 2026-06-15), due_today=1 (2026-06-16)
            cleaningCounts: CmdCleaningCounts(overdue: 1, dueToday: 1),
            // preshift_notes today
            preshiftNoteCount: 2,
            // beo_events today: 1 active (50 guests), 1 cancelled
            eventsCount: 1,
            eventsGuests: 50,
            // reservations today by status
            reservationRows: [
                CmdReservationRow(status: "booked", c: 2),
                CmdReservationRow(status: "seated", c: 1),
                CmdReservationRow(status: "completed", c: 1),
                CmdReservationRow(status: "no_show", c: 1),
                CmdReservationRow(status: "cancelled", c: 1),
            ],
            // prep_tasks today
            prepTaskRows: [
                CmdPrepTaskRow(status: "todo", priority: 1),
                CmdPrepTaskRow(status: "todo", priority: 3),
                CmdPrepTaskRow(status: "in_progress", priority: 2),
                CmdPrepTaskRow(status: "done", priority: 2),
                CmdPrepTaskRow(status: "skipped", priority: 1),
            ],
            // inventory_updates waste: 2 today, 5 within 7-day window
            wasteTodayCount: 2,
            waste7dCount: 5,
            // dining_tables
            diningTableRows: [
                CmdDiningTableRow(status: "open", capacity: 4),
                CmdDiningTableRow(status: "seated", capacity: 6),
                CmdDiningTableRow(status: "dirty", capacity: 2),
                CmdDiningTableRow(status: "closed", capacity: 4),
            ]
        )
    }

    // MARK: - summarize parity

    func testSummarize_topLevelFields() {
        let s = CommandCompute.summarize(bundle: fixtureBundle(), locationId: "default", today: today)
        XCTAssertEqual(s.shiftDate, today)
        XCTAssertEqual(s.yesterday, yesterday)
        XCTAssertEqual(s.locationId, "default")
        XCTAssertEqual(s.eightySix, 1)
        XCTAssertEqual(s.preshiftNotes, 2)
        XCTAssertEqual(s.eventsToday, 1)
        XCTAssertEqual(s.eventsGuests, 50)
    }

    func testSummarize_sales() {
        let s = CommandCompute.summarize(bundle: fixtureBundle(), locationId: "default", today: today)
        XCTAssertEqual(s.sales.yesterdayNet, 4200.0)
        XCTAssertEqual(s.sales.orders, 180)
        XCTAssertEqual(s.sales.guests, 230)
        XCTAssertEqual(s.sales.avg7Net, 4050.0)
        XCTAssertEqual(s.sales.avg7Orders, 172.5)
        // delta_pct = (4200 - 4050)/4050 = 0.037037...
        XCTAssertEqual(s.sales.deltaPct, (4200.0 - 4050.0) / 4050.0, accuracy: 1e-9)
        XCTAssertGreaterThan(s.sales.deltaPct, 0) // up vs avg → no sales-down alert
    }

    func testSummarize_inventory() {
        let s = CommandCompute.summarize(bundle: fixtureBundle(), locationId: "default", today: today)
        XCTAssertEqual(s.inventory.lowPar, 1)
        XCTAssertEqual(s.inventory.parTotal, 3)
        XCTAssertEqual(s.inventory.openCounts, 1)
    }

    func testSummarize_labor() {
        let s = CommandCompute.summarize(bundle: fixtureBundle(), locationId: "default", today: today)
        XCTAssertEqual(s.labor.openBreaks, 1)     // one break with ended_at NULL && !waived
        XCTAssertEqual(s.labor.certExpired, 1)    // 2026-05-01 < today
        XCTAssertEqual(s.labor.certExpiring30d, 1) // 2026-07-01 within 30d
        XCTAssertEqual(s.labor.performanceReviewsToday, 2)
        XCTAssertEqual(s.labor.performanceReviewsTotal, 3)
    }

    func testSummarize_foodSafety() {
        let s = CommandCompute.summarize(bundle: fixtureBundle(), locationId: "default", today: today)
        // Both temp rows have unknown point_ids → classifyReadings drops them → 0 breaches.
        XCTAssertEqual(s.foodSafety.tempBreaches, 0)
        XCTAssertEqual(s.foodSafety.tempReadings, 2) // raw row count
        XCTAssertEqual(s.foodSafety.dateMarksExpired, 1)
        XCTAssertEqual(s.foodSafety.dateMarksDueToday, 1)
        XCTAssertEqual(s.foodSafety.cleaningOverdue, 1)
        XCTAssertEqual(s.foodSafety.cleaningDueToday, 1)
        XCTAssertEqual(s.foodSafety.probesOverdue, 0)
        XCTAssertEqual(s.foodSafety.probesFailed, 0)
        XCTAssertEqual(s.foodSafety.probesDueSoon, 0)
    }

    func testSummarize_reservations() {
        let s = CommandCompute.summarize(bundle: fixtureBundle(), locationId: "default", today: today)
        XCTAssertEqual(s.reservations.booked, 2)
        XCTAssertEqual(s.reservations.seated, 1)
        XCTAssertEqual(s.reservations.completed, 1)
        XCTAssertEqual(s.reservations.noShow, 1)
        XCTAssertEqual(s.reservations.cancelled, 1)
        // total = booked + seated + completed + no_show (cancelled excluded)
        XCTAssertEqual(s.reservations.total, 5)
    }

    func testSummarize_prep() {
        let s = CommandCompute.summarize(bundle: fixtureBundle(), locationId: "default", today: today)
        XCTAssertEqual(s.prep.todo, 2)
        XCTAssertEqual(s.prep.inProgress, 1)
        XCTAssertEqual(s.prep.done, 1)
        XCTAssertEqual(s.prep.skipped, 1)
        // rush = (priority 1|2) AND (todo|in_progress): todo/p1 + in_progress/p2 = 2
        XCTAssertEqual(s.prep.rush, 2)
    }

    func testSummarize_diningTablesAndWaste() {
        let s = CommandCompute.summarize(bundle: fixtureBundle(), locationId: "default", today: today)
        XCTAssertEqual(s.diningTables.open, 1)
        XCTAssertEqual(s.diningTables.seated, 1)
        XCTAssertEqual(s.diningTables.dirty, 1)
        XCTAssertEqual(s.diningTables.closed, 1)
        XCTAssertEqual(s.diningTables.total, 4)
        XCTAssertEqual(s.diningTables.seatsTotal, 16) // 4+6+2+4
        XCTAssertEqual(s.diningTables.seatsSeated, 6) // only the seated table's capacity
        XCTAssertEqual(s.waste.today, 2)
        XCTAssertEqual(s.waste.last7d, 5)
    }

    func testSummarize_priceAndMarginMovesDefaultZero() {
        // Bundle carries no price/margin data; with no summary passed they are zero.
        let s = CommandCompute.summarize(bundle: fixtureBundle(), locationId: "default", today: today)
        XCTAssertEqual(s.priceMoves.total, 0)
        XCTAssertEqual(s.priceMoves.up, 0)
        XCTAssertEqual(s.priceMoves.down, 0)
        XCTAssertEqual(s.marginMoves.total, 0)
        XCTAssertEqual(s.marginMoves.up, 0)
        XCTAssertEqual(s.marginMoves.down, 0)
    }

    func testSummarize_priceMovesInjected() {
        // When price/margin summaries ARE supplied (the web reads them from a
        // separate repo), summarize threads them straight through.
        let s = CommandCompute.summarize(
            bundle: fixtureBundle(), locationId: "default", today: today,
            priceMoves: CommandCompute.MoveSummary(total: 1, up: 1, down: 0),
            marginMoves: CommandCompute.MoveSummary(total: 2, up: 0, down: 2))
        XCTAssertEqual(s.priceMoves.total, 1)
        XCTAssertEqual(s.priceMoves.up, 1)
        XCTAssertEqual(s.marginMoves.total, 2)
        XCTAssertEqual(s.marginMoves.down, 2)
    }

    // MARK: - alertsFor parity

    func testAlertsFor_exactSet() {
        let s = CommandCompute.summarize(bundle: fixtureBundle(), locationId: "default", today: today)
        let alerts = CommandCompute.alertsFor(s)
        let sources = alerts.map(\.source)
        // Red (in order): date-marks-expired, cleaning-overdue, cert-expired, eighty-six
        // (temp-breaches=0, probes-failed=0, probes-overdue=0, no_show=1<3 → suppressed)
        // Amber (in order): date-marks-due-today, cleaning-due-today, inventory-low-par,
        //   inventory-open-counts, open-breaks, cert-expiring-30d, prep-rush,
        //   reservations-to-seat, tables-dirty
        // (sales-down: delta>0; probes-due-soon=0; reviews-none: today=2; price/margin=0)
        let expected = [
            "date-marks-expired", "cleaning-overdue", "cert-expired", "eighty-six",
            "date-marks-due-today", "cleaning-due-today", "inventory-low-par",
            "inventory-open-counts", "open-breaks", "cert-expiring-30d", "prep-rush",
            "reservations-to-seat", "tables-dirty",
        ]
        XCTAssertEqual(sources, expected)
    }

    func testAlertsFor_severityOrdering() {
        let s = CommandCompute.summarize(bundle: fixtureBundle(), locationId: "default", today: today)
        let alerts = CommandCompute.alertsFor(s)
        // All reds precede all ambers.
        let firstAmber = alerts.firstIndex { $0.severity == .amber } ?? alerts.count
        let lastRed = alerts.lastIndex { $0.severity == .red } ?? -1
        XCTAssertLessThan(lastRed, firstAmber)
        XCTAssertEqual(alerts.filter { $0.severity == .red }.count, 4)
        XCTAssertEqual(alerts.filter { $0.severity == .amber }.count, 9)
    }

    func testAlertsFor_messagesAndCounts() {
        let s = CommandCompute.summarize(bundle: fixtureBundle(), locationId: "default", today: today)
        let bySource = Dictionary(uniqueKeysWithValues: CommandCompute.alertsFor(s).map { ($0.source, $0) })
        XCTAssertEqual(bySource["eighty-six"]?.count, 1)
        XCTAssertEqual(bySource["eighty-six"]?.message, "1 item 86’d")
        XCTAssertEqual(bySource["date-marks-expired"]?.message, "1 expired date mark — toss now")
        XCTAssertEqual(bySource["inventory-low-par"]?.message, "1 item below par")
        XCTAssertEqual(bySource["reservations-to-seat"]?.count, 2)
        XCTAssertEqual(bySource["reservations-to-seat"]?.message, "2 reservations still to seat")
        XCTAssertEqual(bySource["prep-rush"]?.count, 2)
    }

    func testAlertsFor_noShowRedThreshold() {
        // no_show >= 3 fires a red 'reservation-no-shows'; below 3 it is suppressed.
        var s = CommandCompute.summarize(bundle: fixtureBundle(), locationId: "default", today: today)
        XCTAssertFalse(CommandCompute.alertsFor(s).contains { $0.source == "reservation-no-shows" })
        s.reservations.noShow = 3
        let alerts = CommandCompute.alertsFor(s)
        let noShow = alerts.first { $0.source == "reservation-no-shows" }
        XCTAssertEqual(noShow?.severity, .red)
        XCTAssertEqual(noShow?.count, 3)
    }

    func testAlertsFor_salesDownAmber() {
        // delta_pct < -0.15 AND avg7_net > 0 fires amber 'sales-down'.
        var s = CommandCompute.summarize(bundle: fixtureBundle(), locationId: "default", today: today)
        s.sales.deltaPct = -0.20
        let down = CommandCompute.alertsFor(s).first { $0.source == "sales-down" }
        XCTAssertEqual(down?.severity, .amber)
        XCTAssertEqual(down?.count, 1)
        XCTAssertEqual(down?.message, "Sales -20% vs 7-day avg")
    }

    func testAlertsFor_performanceReviewsNoneAmber() {
        // performance_reviews_today == 0 fires amber 'performance-reviews-none'.
        var s = CommandCompute.summarize(bundle: fixtureBundle(), locationId: "default", today: today)
        s.labor.performanceReviewsToday = 0
        let none = CommandCompute.alertsFor(s).first { $0.source == "performance-reviews-none" }
        XCTAssertEqual(none?.severity, .amber)
        XCTAssertEqual(none?.message, "No staff reviews logged today")
    }
}
