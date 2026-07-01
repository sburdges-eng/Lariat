import XCTest
@testable import LariatModel

// Value-parity port of tests/js/test-tphc-rules.mjs — Time as Public Health
// Control (FDA §3-501.19). Known input/output values lifted from the web test
// so the Swift rule module cannot drift from the JS one.

final class TphcComputeTests: XCTestCase {

    // ── constants ───────────────────────────────────────────────────────

    func testHotIs4Hours() {
        XCTAssertEqual(TphcCompute.hotHours, 4)
    }

    func testColdIs6Hours() {
        XCTAssertEqual(TphcCompute.coldHours, 6)
    }

    func testWarningBandIs30Minutes() {
        XCTAssertEqual(TphcCompute.warningMinutes, 30)
    }

    func testKindsCoverHotAndCold() {
        XCTAssertEqual(TphcKind.allCases.map(\.rawValue), ["hot_time_only", "cold_time_only"])
    }

    func testDiscardReasonsPinFixedEnum() {
        XCTAssertEqual(
            TphcDiscardReason.allCases.map(\.rawValue),
            ["reached_cutoff", "consumed", "quality", "contamination"]
        )
    }

    // ── hoursFor ────────────────────────────────────────────────────────

    func testHoursForHot() { XCTAssertEqual(TphcCompute.hoursFor(.hotTimeOnly), 4) }
    func testHoursForCold() { XCTAssertEqual(TphcCompute.hoursFor(.coldTimeOnly), 6) }

    // ── computeCutoffAt ─────────────────────────────────────────────────

    func testHotAddsExactly4Hours() {
        XCTAssertEqual(
            TphcCompute.computeCutoffAt(startedAt: "2026-04-24T12:00:00Z", kind: .hotTimeOnly),
            "2026-04-24T16:00:00.000Z"
        )
    }

    func testColdAddsExactly6Hours() {
        XCTAssertEqual(
            TphcCompute.computeCutoffAt(startedAt: "2026-04-24T10:00:00Z", kind: .coldTimeOnly),
            "2026-04-24T16:00:00.000Z"
        )
    }

    func testRollsAcrossMidnightWithoutDstDrift() {
        // 2026-03-08 is US spring-forward. Compute in UTC so 4h stays 4h.
        XCTAssertEqual(
            TphcCompute.computeCutoffAt(startedAt: "2026-03-08T08:30:00Z", kind: .hotTimeOnly),
            "2026-03-08T12:30:00.000Z"
        )
    }

    func testRejectsBadTimestamp() {
        XCTAssertNil(TphcCompute.computeCutoffAt(startedAt: "not-a-time", kind: .hotTimeOnly))
    }

    func testRejectsDateOnlyInput() {
        XCTAssertNil(TphcCompute.computeCutoffAt(startedAt: "2026-04-24", kind: .hotTimeOnly))
    }

    // ── validateTphcCreate ──────────────────────────────────────────────

    func testAcceptsWellFormedInput() {
        let r = TphcCompute.validateTphcCreate(item: "pizza topping", startedAt: "2026-04-24T12:00:00Z", kind: "hot_time_only")
        XCTAssertTrue(r.ok)
        XCTAssertNil(r.reason)
    }

    func testRejectsEmptyItem() {
        let r = TphcCompute.validateTphcCreate(item: "  ", startedAt: "2026-04-24T12:00:00Z", kind: "hot_time_only")
        XCTAssertFalse(r.ok)
    }

    func testRejectsMissingStartedAt() {
        let r = TphcCompute.validateTphcCreate(item: "pizza topping", startedAt: nil, kind: "hot_time_only")
        XCTAssertFalse(r.ok)
    }

    func testRejectsUnknownKind() {
        let r = TphcCompute.validateTphcCreate(item: "pizza topping", startedAt: "2026-04-24T12:00:00Z", kind: "mild_time_only")
        XCTAssertFalse(r.ok)
    }

    // ── type guards ─────────────────────────────────────────────────────

    func testIsTphcKindGatesExactlyTheEnum() {
        XCTAssertTrue(TphcCompute.isTphcKind("hot_time_only"))
        XCTAssertTrue(TphcCompute.isTphcKind("cold_time_only"))
        XCTAssertFalse(TphcCompute.isTphcKind("warm_time_only"))
        XCTAssertFalse(TphcCompute.isTphcKind(nil))
    }

    func testIsTphcDiscardReasonGatesExactlyTheEnum() {
        XCTAssertTrue(TphcCompute.isTphcDiscardReason("reached_cutoff"))
        XCTAssertFalse(TphcCompute.isTphcDiscardReason("lost_track"))
    }

    // ── scanActiveTphc ──────────────────────────────────────────────────

    private let now = "2026-04-24T14:00:00Z"

    func testMarksPastCutoffRowsExpired() {
        let rows = [TphcRowSnapshot(
            id: 1, item: "pizza topping", stationId: nil,
            startedAt: "2026-04-24T09:00:00Z", cutoffAt: "2026-04-24T13:00:00Z", discardedAt: nil)]
        let s = TphcCompute.scanActiveTphc(rows, now: now)!
        XCTAssertEqual(s.count, 1)
        XCTAssertEqual(s[0].status, .expired)
        XCTAssertLessThan(s[0].minutesUntilCutoff, 0)
    }

    func testMarksWithinWarningBandAsWarning() {
        let rows = [TphcRowSnapshot(
            id: 2, item: "cut tomato", stationId: "salad",
            startedAt: "2026-04-24T08:15:00Z", cutoffAt: "2026-04-24T14:15:00Z", discardedAt: nil)]
        let s = TphcCompute.scanActiveTphc(rows, now: now)!
        XCTAssertEqual(s[0].status, .warning)
        XCTAssertEqual(s[0].minutesUntilCutoff, 15)
    }

    func testMarksComfortableWindowAsOk() {
        let rows = [TphcRowSnapshot(
            id: 3, item: "stuffed pepper", stationId: "grill",
            startedAt: "2026-04-24T13:30:00Z", cutoffAt: "2026-04-24T17:30:00Z", discardedAt: nil)]
        let s = TphcCompute.scanActiveTphc(rows, now: now)!
        XCTAssertEqual(s[0].status, .ok)
        XCTAssertEqual(s[0].minutesUntilCutoff, 210)
    }

    func testDropsDiscardedRows() {
        let rows = [TphcRowSnapshot(
            id: 4, item: "tossed batch", stationId: nil,
            startedAt: "2026-04-24T10:00:00Z", cutoffAt: "2026-04-24T14:00:00Z",
            discardedAt: "2026-04-24T13:45:00Z")]
        XCTAssertEqual(TphcCompute.scanActiveTphc(rows, now: now)!.count, 0)
    }

    func testSortsMostPastDueFirstThenNearestCutoff() {
        let rows = [
            TphcRowSnapshot(id: 1, item: "A", stationId: nil, startedAt: "2026-04-24T13:30:00Z", cutoffAt: "2026-04-24T17:30:00Z", discardedAt: nil),
            TphcRowSnapshot(id: 2, item: "B", stationId: nil, startedAt: "2026-04-24T08:00:00Z", cutoffAt: "2026-04-24T12:00:00Z", discardedAt: nil),
            TphcRowSnapshot(id: 3, item: "C", stationId: nil, startedAt: "2026-04-24T08:15:00Z", cutoffAt: "2026-04-24T14:15:00Z", discardedAt: nil),
        ]
        let s = TphcCompute.scanActiveTphc(rows, now: now)!
        XCTAssertEqual(s.map(\.id), [2, 3, 1])
    }

    func testRejectsMalformedNow() {
        XCTAssertNil(TphcCompute.scanActiveTphc([], now: "not-a-time"))
    }

    func testExactlyWarningMinutesFromCutoffIsWarningBoundaryInclusive() {
        // At exactly TPHC_WARNING_MINUTES remaining, status must be 'warning'.
        let refMs = TphcCompute.parseInstantStrictMs(now)!
        let cutoffMs = refMs + Double(TphcCompute.warningMinutes) * 60 * 1000
        let cutoffAt = isoString(cutoffMs)
        let rows = [TphcRowSnapshot(
            id: 10, item: "edge tomato", stationId: "salad",
            startedAt: "2026-04-24T08:00:00Z", cutoffAt: cutoffAt, discardedAt: nil)]
        let s = TphcCompute.scanActiveTphc(rows, now: now)!
        XCTAssertEqual(s[0].status, .warning)
        XCTAssertEqual(s[0].minutesUntilCutoff, TphcCompute.warningMinutes)
    }

    func testWarningMinutesPlus1FromCutoffIsOkBoundaryExclusive() {
        // One minute beyond the warning band must be 'ok'.
        let refMs = TphcCompute.parseInstantStrictMs(now)!
        let cutoffMs = refMs + Double(TphcCompute.warningMinutes + 1) * 60 * 1000
        let cutoffAt = isoString(cutoffMs)
        let rows = [TphcRowSnapshot(
            id: 11, item: "edge pepper", stationId: "grill",
            startedAt: "2026-04-24T08:00:00Z", cutoffAt: cutoffAt, discardedAt: nil)]
        let s = TphcCompute.scanActiveTphc(rows, now: now)!
        XCTAssertEqual(s[0].status, .ok)
        XCTAssertEqual(s[0].minutesUntilCutoff, TphcCompute.warningMinutes + 1)
    }

    // ── helper ──────────────────────────────────────────────────────────

    private func isoString(_ ms: Double) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(secondsFromGMT: 0)
        return f.string(from: Date(timeIntervalSince1970: ms / 1000))
    }
}
