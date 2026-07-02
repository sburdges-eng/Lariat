import XCTest
@testable import LariatModel

/// Parity tests for MorningCompute — the Swift port of the assembly half of
/// `lib/morningDigest.ts` (`buildMorningDigest` post-query derivation +
/// `formatSlackText`). Cases are lifted from tests/js/test-morning-digest.mjs:
///   - "assembles the manager-open digest" (section shapes + Slack text)
///   - "excludes expired certs from the this-week section"
///   - maintenance past-or-today filtering
///   - "limits BEO prep to events that still have open tasks" (repo-side; shape here)
///
/// `today` is pinned to "2026-04-25" (TODAY in the web test) so the cert/maintenance
/// day-window math is graded against the same base date.
final class MorningComputeTests: XCTestCase {

    private let today = "2026-04-25"

    /// A zeroed CommandSummary — the morning digest's `alerts` are derived from this
    /// via CommandCompute.alertsFor(). A summary with all-zero counts yields no alerts,
    /// keeping the Slack "Heads-up:" line out unless a test opts in.
    private func emptySummary() -> CommandSummary {
        CommandSummary(
            shiftDate: today, yesterday: "2026-04-24", locationId: "default",
            sales: .init(yesterdayNet: 0, orders: 0, guests: 0, avg7Net: 0, avg7Orders: 0, deltaPct: 0),
            eightySix: 0,
            inventory: .init(lowPar: 0, parTotal: 0, openCounts: 0),
            labor: .init(openBreaks: 0, certExpiring30d: 0, certExpired: 0,
                         performanceReviewsToday: 1, performanceReviewsTotal: 1),
            foodSafety: .init(tempBreaches: 0, tempReadings: 0, dateMarksExpired: 0,
                              dateMarksDueToday: 0, cleaningOverdue: 0, cleaningDueToday: 0,
                              probesOverdue: 0, probesFailed: 0, probesDueSoon: 0),
            preshiftNotes: 0, eventsToday: 0, eventsGuests: 0,
            reservations: .init(booked: 0, seated: 0, completed: 0, noShow: 0, cancelled: 0, total: 0),
            prep: .init(todo: 0, inProgress: 0, done: 0, skipped: 0, rush: 0),
            priceMoves: .init(total: 0, up: 0, down: 0),
            marginMoves: .init(total: 0, up: 0, down: 0),
            diningTables: .init(open: 0, seated: 0, dirty: 0, closed: 0, total: 0, seatsTotal: 0, seatsSeated: 0),
            waste: .init(today: 0, last7d: 0))
    }

    // ── "assembles the manager-open digest" (section shapes + Slack text) ──────

    func testAssemblesDigestSectionsAndSlackText() {
        // Bundle mirrors the web test's inserted rows (post-repo shape):
        //   eighty_six: Avocado unresolved (Lime resolved → excluded by repo) → count 1
        //   price_shocks: Avocado AVO-1 +25% (repo already ranked/capped)
        //   certs: cook-1 due today+3 (within 7d); cook-2 far (2026-05-20 excluded by window)
        //   maintenance: Walk-in cooler due TODAY (days_until 0 ≤ 0 → included)
        //   beo_prep: Wedding tasting, 1 open / 2 total (repo filtered to open>0)
        let bundle = MorningBundle(
            eightySixItems: [
                MorningEightySixItem(item: "Avocado", reason: "vendor short",
                                     quantity: nil, stationId: nil, createdAt: nil),
            ],
            eightySixCount: 1,
            priceShocks: [
                MorningPriceShock(vendor: "sysco", sku: "AVO-1", ingredient: "Avocado", deltaPct: 25.0),
            ],
            certRows: [
                MrnCertRow(cookId: "cook-1", certLabel: "Food Handler",
                           certType: "food_handler", expiresOn: "2026-04-28"), // +3d
                MrnCertRow(cookId: "cook-2", certLabel: "Food Handler",
                           certType: "food_handler", expiresOn: "2026-05-20"), // far → excluded
            ],
            maintenanceRows: [
                MrnMaintenanceRow(equipmentName: "Walk-in cooler", task: "Filter clean",
                                  frequency: "weekly", nextDue: today), // due today → days 0
            ],
            beoRows: [
                MrnBeoRow(eventId: 1, title: "Wedding tasting", eventDate: today, eventTime: "17:00",
                          guestCount: 80, openTasks: 1, doneTasks: 1, totalTasks: 2),
            ])

        let digest = MorningCompute.assemble(
            summary: emptySummary(), bundle: bundle, locationId: "default", today: today)

        XCTAssertEqual(digest.locationId, "default")
        XCTAssertEqual(digest.shiftDate, today)

        XCTAssertEqual(digest.eightySix.count, 1)
        XCTAssertEqual(digest.eightySix.items.first?.item, "Avocado")

        XCTAssertEqual(digest.priceShocks.count, 1)
        XCTAssertEqual(digest.priceShocks.items.first?.sku, "AVO-1")

        XCTAssertEqual(digest.certsExpiringWeek.count, 1)
        XCTAssertEqual(digest.certsExpiringWeek.items.first?.cookId, "cook-1")
        XCTAssertEqual(digest.certsExpiringWeek.items.first?.daysUntil, 3)

        XCTAssertEqual(digest.maintenanceDue.count, 1)
        XCTAssertEqual(digest.maintenanceDue.items.first?.equipmentName, "Walk-in cooler")

        XCTAssertEqual(digest.beoPrep.count, 1)
        XCTAssertEqual(digest.beoPrep.items.first?.title, "Wedding tasting")
        XCTAssertEqual(digest.beoPrep.items.first?.openTasks, 1)

        // Slack text assertions mirror the web test's regex matches.
        XCTAssertTrue(digest.webhookText.contains("Morning digest"))
        XCTAssertTrue(digest.webhookText.contains("86 board: 1 item"))
        XCTAssertTrue(digest.webhookText.contains("Price shocks: 1 item"))
        // Detail lines present when items exist.
        XCTAssertTrue(digest.webhookText.contains("86 details: Avocado"))
        XCTAssertTrue(digest.webhookText.contains("Price details: Avocado +25.0%"))
        XCTAssertTrue(digest.webhookText.contains("Cert details: cook-1 2026-04-28"))
        XCTAssertTrue(digest.webhookText.contains("Maintenance details: Walk-in cooler · Filter clean"))
        XCTAssertTrue(digest.webhookText.contains("BEO details: Wedding tasting (1 open)"))
    }

    // ── "excludes expired certs from the this-week section" ────────────────────

    func testExcludesExpiredCertsFromThisWeek() {
        // cook-expired: 2026-04-24 → days_until -1 (excluded)
        // cook-today:   2026-04-25 → days_until 0  (included)
        // cook-soon:    2026-04-28 → days_until 3  (included)
        let bundle = MorningBundle(
            eightySixItems: [], eightySixCount: 0, priceShocks: [],
            certRows: [
                MrnCertRow(cookId: "cook-expired", certLabel: "Food Handler",
                           certType: "food_handler", expiresOn: "2026-04-24"),
                MrnCertRow(cookId: "cook-today", certLabel: "Food Handler",
                           certType: "food_handler", expiresOn: "2026-04-25"),
                MrnCertRow(cookId: "cook-soon", certLabel: "Food Handler",
                           certType: "food_handler", expiresOn: "2026-04-28"),
            ],
            maintenanceRows: [], beoRows: [])

        let digest = MorningCompute.assemble(
            summary: emptySummary(), bundle: bundle, locationId: "default", today: today)

        XCTAssertEqual(digest.certsExpiringWeek.items.map { $0.cookId }, ["cook-today", "cook-soon"])
        XCTAssertEqual(digest.certsExpiringWeek.count, 2)
    }

    // ── maintenance: only past-or-today (days_until <= 0) survives ─────────────

    func testMaintenanceKeepsPastOrTodayDropsFuture() {
        let bundle = MorningBundle(
            eightySixItems: [], eightySixCount: 0, priceShocks: [], certRows: [],
            maintenanceRows: [
                MrnMaintenanceRow(equipmentName: "Flat top", task: "Scrape",
                                  frequency: "daily", nextDue: "2026-04-24"),   // -1 → kept
                MrnMaintenanceRow(equipmentName: "Walk-in", task: "Filter",
                                  frequency: "weekly", nextDue: today),          // 0 → kept
                MrnMaintenanceRow(equipmentName: "Oven", task: "Deep clean",
                                  frequency: "weekly", nextDue: "2026-04-30"),   // +5 → dropped
            ],
            beoRows: [])

        let digest = MorningCompute.assemble(
            summary: emptySummary(), bundle: bundle, locationId: "default", today: today)

        XCTAssertEqual(digest.maintenanceDue.count, 2)
        XCTAssertEqual(digest.maintenanceDue.items.map { $0.equipmentName }, ["Flat top", "Walk-in"])
    }

    // ── empty digest: zero counts, no detail lines, no heads-up ────────────────

    func testEmptyDigestSlackTextHasSummaryLinesOnly() {
        let bundle = MorningBundle(
            eightySixItems: [], eightySixCount: 0, priceShocks: [],
            certRows: [], maintenanceRows: [], beoRows: [])

        let digest = MorningCompute.assemble(
            summary: emptySummary(), bundle: bundle, locationId: "default", today: today)

        XCTAssertEqual(digest.alerts.count, 0) // performanceReviewsToday=1 suppresses the reviews-none alert
        let lines = digest.webhookText.split(separator: "\n").map(String.init)
        // Only the 6 fixed summary lines; no detail / heads-up lines.
        XCTAssertEqual(lines.count, 6)
        XCTAssertEqual(lines[0], "Morning digest · \(today)")
        XCTAssertEqual(lines[1], "86 board: 0 items")
        XCTAssertEqual(lines[5], "BEO prep: 0 events")
        XCTAssertFalse(digest.webhookText.contains("Heads-up:"))
    }

    // ── alerts flow through to the Heads-up Slack line ─────────────────────────

    func testAlertsSurfaceInHeadsUpLine() {
        var summary = emptySummary()
        summary.eightySix = 2 // → a red "eighty-six" alert with message "2 items 86’d"

        let bundle = MorningBundle(
            eightySixItems: [], eightySixCount: 2, priceShocks: [],
            certRows: [], maintenanceRows: [], beoRows: [])

        let digest = MorningCompute.assemble(
            summary: summary, bundle: bundle, locationId: "default", today: today)

        XCTAssertTrue(digest.alerts.contains { $0.source == "eighty-six" && $0.count == 2 })
        XCTAssertTrue(digest.webhookText.contains("Heads-up: 2 items 86’d"))
    }

    // ── fmtPct parity (matches lib/morningDigest.ts fmtPct) ────────────────────

    func testFmtPctParity() {
        XCTAssertEqual(MorningCompute.fmtPct(25.0), "+25.0%")
        XCTAssertEqual(MorningCompute.fmtPct(-3.25), "-3.2%")
        XCTAssertEqual(MorningCompute.fmtPct(0), "0.0%")
        XCTAssertEqual(MorningCompute.fmtPct(nil), "—")
        XCTAssertEqual(MorningCompute.fmtPct(Double.nan), "—")
    }

    // ── daysBetween parity (UTC whole-day floor) ───────────────────────────────

    func testDaysBetweenParity() {
        XCTAssertEqual(MorningCompute.daysBetween("2026-04-25", "2026-04-28"), 3)
        XCTAssertEqual(MorningCompute.daysBetween("2026-04-25", "2026-04-25"), 0)
        XCTAssertEqual(MorningCompute.daysBetween("2026-04-25", "2026-04-24"), -1)
        XCTAssertEqual(MorningCompute.daysBetween("2026-04-25", "2026-05-02"), 7)
    }
}
