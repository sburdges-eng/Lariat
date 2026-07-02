import XCTest
@testable import LariatModel

/// Ports every oracle case in `tests/js/test-host-stand-rules.mjs`
/// (pure-rule tests for lib/hostStand.ts).
final class HostStandComputeTests: XCTestCase {

    // ── sanitizeWaitlistInput ────────────────────────────────────────────

    func testReturnsCleanPayloadOnValidInput() {
        let out = HostStandCompute.sanitizeWaitlistInput(partyName: "Hendricks", partySize: 4)
        XCTAssertEqual(out, SanitizedWaitlistInput(partyName: "Hendricks", partySize: 4, phone: nil, notes: nil))
    }

    func testTrimsPartyName() {
        let out = HostStandCompute.sanitizeWaitlistInput(partyName: "  Smith  ", partySize: 2)
        XCTAssertEqual(out?.partyName, "Smith")
    }

    func testNilOnBlankOrMissingPartyName() {
        XCTAssertNil(HostStandCompute.sanitizeWaitlistInput(partyName: nil, partySize: 2))
        XCTAssertNil(HostStandCompute.sanitizeWaitlistInput(partyName: "   ", partySize: 2))
        XCTAssertNil(HostStandCompute.sanitizeWaitlistInput(partyName: "", partySize: 2))
    }

    func testNilOnMissingOrNonPositivePartySize() {
        XCTAssertNil(HostStandCompute.sanitizeWaitlistInput(partyName: "X", partySize: nil))
        XCTAssertNil(HostStandCompute.sanitizeWaitlistInput(partyName: "X", partySize: .nan)) // 'oops' → NaN
        XCTAssertNil(HostStandCompute.sanitizeWaitlistInput(partyName: "X", partySize: 0))
        XCTAssertNil(HostStandCompute.sanitizeWaitlistInput(partyName: "X", partySize: -3))
    }

    func testFloorsFractionalPartySize() {
        let out = HostStandCompute.sanitizeWaitlistInput(partyName: "X", partySize: 3.7)
        XCTAssertEqual(out?.partySize, 3)
    }

    func testClipsNamePhoneAndNotes() {
        let out = HostStandCompute.sanitizeWaitlistInput(
            partyName: String(repeating: "x", count: 200),
            partySize: 2,
            phone: String(repeating: "5", count: 100),
            notes: String(repeating: "n", count: 2000)
        )
        XCTAssertEqual(out?.partyName.count, HostStandCompute.maxPartyNameLength)
        XCTAssertEqual(out?.phone?.count, 32)
        XCTAssertEqual(out?.notes?.count, 500)
    }

    func testCapsPartySizeAtMax() {
        let out = HostStandCompute.sanitizeWaitlistInput(partyName: "X", partySize: 9999)
        XCTAssertEqual(out?.partySize, HostStandCompute.maxPartySize)
    }

    func testCoercesBlankPhoneAndNotesToNil() {
        let out = HostStandCompute.sanitizeWaitlistInput(
            partyName: "X", partySize: 2, phone: "  ", notes: ""
        )
        XCTAssertNil(out?.phone)
        XCTAssertNil(out?.notes)
    }

    // ── isValidStatusTransition ──────────────────────────────────────────

    func testAllowsWaitingToSeatedAndLeft() {
        XCTAssertTrue(HostStandCompute.isValidStatusTransition("waiting", "seated"))
        XCTAssertTrue(HostStandCompute.isValidStatusTransition("waiting", "left"))
    }

    func testRejectsAllOtherTransitions() {
        XCTAssertFalse(HostStandCompute.isValidStatusTransition("seated", "waiting"))
        XCTAssertFalse(HostStandCompute.isValidStatusTransition("seated", "left"))
        XCTAssertFalse(HostStandCompute.isValidStatusTransition("left", "waiting"))
        XCTAssertFalse(HostStandCompute.isValidStatusTransition("left", "seated"))
        XCTAssertFalse(HostStandCompute.isValidStatusTransition("waiting", "waiting"))
    }

    func testRejectsBogusCurrentStatus() {
        XCTAssertFalse(HostStandCompute.isValidStatusTransition("garbage", "seated"))
    }

    // ── minutesBetween ───────────────────────────────────────────────────

    func testFlooredMinutesWhenEndAfterStart() {
        XCTAssertEqual(
            HostStandCompute.minutesBetween("2026-05-13T18:00:00Z", "2026-05-13T18:15:30Z"),
            15
        )
    }

    func testZeroWhenEndBeforeStart() {
        XCTAssertEqual(
            HostStandCompute.minutesBetween("2026-05-13T19:00:00Z", "2026-05-13T18:00:00Z"),
            0
        )
    }

    func testZeroOnUnparseableInput() {
        XCTAssertEqual(HostStandCompute.minutesBetween("not-a-date", "2026-05-13T18:00:00Z"), 0)
        XCTAssertEqual(HostStandCompute.minutesBetween("2026-05-13T18:00:00Z", nil), 0)
    }

    // ── summarizeWaitlist ────────────────────────────────────────────────

    private let NOW = "2026-05-13T19:00:00.000Z"

    private func make(
        id: Int64 = 1,
        status: String = "waiting",
        joinedAt: String? = nil,
        seatedAt: String? = nil,
        leftAt: String? = nil
    ) -> WaitlistPartyRow {
        WaitlistPartyRow(
            id: id, locationId: "default", partyName: "X", partySize: 4,
            joinedAt: joinedAt ?? NOW, status: status,
            seatedAt: seatedAt, leftAt: leftAt, phone: nil, notes: nil
        )
    }

    func testZeroSummaryOnEmptyInput() {
        let s = HostStandCompute.summarizeWaitlist([], nowIso: NOW)
        XCTAssertEqual(s.total, 0)
        XCTAssertEqual(s.waiting, 0)
        XCTAssertEqual(s.seatedToday, 0)
        XCTAssertEqual(s.leftToday, 0)
        XCTAssertNil(s.avgWaitMinutes)
        XCTAssertNil(s.longestWaitMinutes)
        XCTAssertNil(s.longestWaitPartyId)
    }

    func testCountsWaitingAndTracksLongestWaiter() {
        let rows = [
            make(id: 1, joinedAt: "2026-05-13T18:10:00.000Z"), // 50 min
            make(id: 2, joinedAt: "2026-05-13T18:40:00.000Z"), // 20 min
            make(id: 3, joinedAt: "2026-05-13T18:55:00.000Z"), //  5 min
        ]
        let s = HostStandCompute.summarizeWaitlist(rows, nowIso: NOW)
        XCTAssertEqual(s.waiting, 3)
        XCTAssertEqual(s.longestWaitMinutes, 50)
        XCTAssertEqual(s.longestWaitPartyId, 1)
    }

    func testCountsSeatedTodayAndComputesAvgWait() {
        let rows = [
            make(id: 1, status: "seated", joinedAt: "2026-05-13T18:00:00.000Z", seatedAt: "2026-05-13T18:20:00.000Z"), // 20
            make(id: 2, status: "seated", joinedAt: "2026-05-13T18:30:00.000Z", seatedAt: "2026-05-13T18:40:00.000Z"), // 10
            make(id: 3, status: "seated", joinedAt: "2026-05-12T18:00:00.000Z", seatedAt: "2026-05-12T18:30:00.000Z"), // yesterday — skip
        ]
        let s = HostStandCompute.summarizeWaitlist(rows, nowIso: NOW)
        XCTAssertEqual(s.seatedToday, 2)
        XCTAssertEqual(s.avgWaitMinutes, 15)
    }

    func testCountsLeftTodayOnlyWhenLeftAtIsToday() {
        let rows = [
            make(id: 1, status: "left", leftAt: "2026-05-13T18:30:00.000Z"),
            make(id: 2, status: "left", leftAt: "2026-05-12T18:30:00.000Z"),
        ]
        let s = HostStandCompute.summarizeWaitlist(rows, nowIso: NOW)
        XCTAssertEqual(s.leftToday, 1)
    }
}
