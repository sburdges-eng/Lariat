import XCTest
@testable import LariatModel

/// Ports the inline `parseTimeTo24h` assertion table kept as a comment in
/// `app/reservations/ReservationsBoard.jsx`, plus the 12h formatters, hour
/// bucketing, and header counts (authored against that component — the web
/// has no test file for the board's client layer).
final class ReservationsComputeTests: XCTestCase {

    // ── parseTimeTo24h (inline web assertions, verbatim) ─────────────────

    func testParseTimeInlineAssertionTable() {
        XCTAssertEqual(ReservationsCompute.parseTimeTo24h("7:00 PM"), "19:00")
        XCTAssertEqual(ReservationsCompute.parseTimeTo24h("7pm"), "19:00")
        XCTAssertEqual(ReservationsCompute.parseTimeTo24h("19:00"), "19:00")
        XCTAssertEqual(ReservationsCompute.parseTimeTo24h("19"), "19:00")
        XCTAssertEqual(ReservationsCompute.parseTimeTo24h("7:30am"), "07:30")
        XCTAssertEqual(ReservationsCompute.parseTimeTo24h("12:00 AM"), "00:00")
        XCTAssertEqual(ReservationsCompute.parseTimeTo24h("12:30 PM"), "12:30")
        XCTAssertNil(ReservationsCompute.parseTimeTo24h("garbage"))
    }

    func testParseTimeAdditionalDocumentedShapes() {
        // "7:00pm" → "19:00", "7" → "07:00" (bare hour: assume AM if ≤12).
        XCTAssertEqual(ReservationsCompute.parseTimeTo24h("7:00pm"), "19:00")
        XCTAssertEqual(ReservationsCompute.parseTimeTo24h("7"), "07:00")
        XCTAssertEqual(ReservationsCompute.parseTimeTo24h("  7:00 PM  "), "19:00")
    }

    func testParseTimeRejectsOutOfRange() {
        XCTAssertNil(ReservationsCompute.parseTimeTo24h(""))
        XCTAssertNil(ReservationsCompute.parseTimeTo24h(nil))
        XCTAssertNil(ReservationsCompute.parseTimeTo24h("24"))       // 24h hour > 23
        XCTAssertNil(ReservationsCompute.parseTimeTo24h("13pm"))     // am/pm hour > 12
        XCTAssertNil(ReservationsCompute.parseTimeTo24h("0pm"))      // am/pm hour < 1
        XCTAssertNil(ReservationsCompute.parseTimeTo24h("7:60"))     // minutes > 59
    }

    // ── formatRowTime / formatHourHeader ─────────────────────────────────

    func testFormatRowTime() {
        XCTAssertEqual(ReservationsCompute.formatRowTime("2026-04-25 18:30"), "6:30 PM")
        XCTAssertEqual(ReservationsCompute.formatRowTime("2026-04-25 00:15"), "12:15 AM")
        XCTAssertEqual(ReservationsCompute.formatRowTime("2026-04-25 12:00"), "12:00 PM")
        XCTAssertEqual(ReservationsCompute.formatRowTime(nil), "")
        XCTAssertEqual(ReservationsCompute.formatRowTime("no time here"), "")
    }

    func testFormatHourHeader() {
        XCTAssertEqual(ReservationsCompute.formatHourHeader("18:00"), "6:00 PM")
        XCTAssertEqual(ReservationsCompute.formatHourHeader("00:00"), "12:00 AM")
        XCTAssertEqual(ReservationsCompute.formatHourHeader("12:00"), "12:00 PM")
        XCTAssertEqual(ReservationsCompute.formatHourHeader("bogus"), "bogus")
    }

    // ── hourBuckets ──────────────────────────────────────────────────────

    func testHourBucketsGroupAndSortWithUnscheduledLast() {
        let rows = [
            res(id: 1, at: "2026-04-25 20:30"),
            res(id: 2, at: "2026-04-25 18:00"),
            res(id: 3, at: "garbled"),
            res(id: 4, at: "2026-04-25 18:45"),
        ]
        let buckets = ReservationsCompute.hourBuckets(rows)
        XCTAssertEqual(buckets.map(\.key), ["18:00", "20:00", ""])
        XCTAssertEqual(buckets[0].rows.map(\.id), [2, 4])
        XCTAssertEqual(buckets[1].rows.map(\.id), [1])
        XCTAssertEqual(buckets[2].rows.map(\.id), [3])
    }

    // ── counts ───────────────────────────────────────────────────────────

    func testCountsPeopleOnBookIsBookedPlusSeated() {
        let rows = [
            res(id: 1, at: "2026-04-25 18:00", status: "booked", size: 4),
            res(id: 2, at: "2026-04-25 18:00", status: "seated", size: 2),
            res(id: 3, at: "2026-04-25 18:00", status: "completed", size: 6),
            res(id: 4, at: "2026-04-25 18:00", status: "cancelled", size: 3),
            res(id: 5, at: "2026-04-25 18:00", status: "no_show", size: 5),
        ]
        let c = ReservationsCompute.counts(rows)
        XCTAssertEqual(c, ReservationCounts(
            booked: 1, seated: 1, completed: 1, cancelled: 1, noShow: 1, people: 6
        ))
    }

    // ── statusLabel ──────────────────────────────────────────────────────

    func testStatusLabels() {
        XCTAssertEqual(ReservationsCompute.statusLabel("booked"), "Booked")
        XCTAssertEqual(ReservationsCompute.statusLabel("seated"), "Seated")
        XCTAssertEqual(ReservationsCompute.statusLabel("completed"), "Done")
        XCTAssertEqual(ReservationsCompute.statusLabel("cancelled"), "Cancelled")
        XCTAssertEqual(ReservationsCompute.statusLabel("no_show"), "No show")
        XCTAssertEqual(ReservationsCompute.statusLabel("weird"), "weird")
    }

    private func res(id: Int64, at: String, status: String = "booked", size: Int = 2) -> ReservationRow {
        ReservationRow(
            id: id, partyName: "P\(id)", partySize: size, reservationAt: at,
            status: status, tableId: nil, phone: nil, email: nil, notes: nil,
            source: "manual", sourceRef: nil, seatedAt: nil, completedAt: nil,
            cookId: nil, createdAt: nil, updatedAt: nil
        )
    }
}
