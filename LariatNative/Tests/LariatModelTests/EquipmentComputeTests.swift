import XCTest
@testable import LariatModel

/// Value-parity tests for the /equipment board's derived state
/// (`app/equipment/EquipmentBoard.tsx` — no web test file covers these;
/// cases are authored against the component code, lines cited inline).
final class EquipmentComputeTests: XCTestCase {

    // isWarrantyExpired / isOverdue (EquipmentBoard.tsx L26-42): both are
    // `date < today` at local midnight; null / unparseable dates are never
    // expired/overdue.

    func testPastDateIsPast() {
        XCTAssertTrue(EquipmentCompute.isPastDate("2026-06-30", today: "2026-07-02"))
        XCTAssertTrue(EquipmentCompute.isPastDate("2025-01-01", today: "2026-07-02"))
    }

    func testTodayIsNotPast() {
        // `d < today` — a warranty expiring today is not yet expired.
        XCTAssertFalse(EquipmentCompute.isPastDate("2026-07-02", today: "2026-07-02"))
    }

    func testFutureDateIsNotPast() {
        XCTAssertFalse(EquipmentCompute.isPastDate("2026-07-03", today: "2026-07-02"))
    }

    func testNilAndInvalidDatesAreNotPast() {
        XCTAssertFalse(EquipmentCompute.isPastDate(nil, today: "2026-07-02"))
        XCTAssertFalse(EquipmentCompute.isPastDate("", today: "2026-07-02"))
        XCTAssertFalse(EquipmentCompute.isPastDate("not-a-date", today: "2026-07-02"))
    }

    // Schedule overdue flag (EquipmentBoard.tsx L287): any schedule row with
    // next_due in the past marks the equipment card "Service overdue".

    func testAnyScheduleOverdue() {
        let rows = [
            EquipmentScheduleRow(id: 1, equipmentId: 1, task: "Filter", frequency: "Monthly",
                                 lastDone: nil, nextDue: "2026-07-10", notes: nil,
                                 locationId: "default", createdAt: nil),
            EquipmentScheduleRow(id: 2, equipmentId: 1, task: "Degrease", frequency: "Weekly",
                                 lastDone: nil, nextDue: "2026-06-30", notes: nil,
                                 locationId: "default", createdAt: nil),
        ]
        XCTAssertTrue(EquipmentCompute.anyOverdue(rows, today: "2026-07-02"))
        XCTAssertFalse(EquipmentCompute.anyOverdue([rows[0]], today: "2026-07-02"))
        XCTAssertFalse(EquipmentCompute.anyOverdue([], today: "2026-07-02"))
    }
}
