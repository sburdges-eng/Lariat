import XCTest
@testable import LariatModel

/// Coverage for `CleaningCompute.validateCleaningLog` (port of lib/cleaning.ts).
/// The C1 verify pass found the clip/validation 400 branches were all ported but
/// only "missing task" had a native test. These pin every branch + normalization.
final class CleaningComputeTests: XCTestCase {
    private func validate(
        task: String? = nil, item: String? = nil, area: String? = nil,
        notes: String? = nil, shiftDate: String? = nil, completedAt: String? = nil,
        cookId: String? = nil, verifiedByCookId: String? = nil, scheduleId: Int64? = nil
    ) -> Result<CleaningCompute.NormalizedCleaningLog, CleaningWriteError> {
        CleaningCompute.validateCleaningLog(
            task: task, item: item, area: area, notes: notes, shiftDate: shiftDate,
            completedAt: completedAt, cookId: cookId, verifiedByCookId: verifiedByCookId,
            scheduleId: scheduleId
        )
    }

    private func message(_ r: Result<CleaningCompute.NormalizedCleaningLog, CleaningWriteError>) -> String? {
        guard case .failure(.validationFailed(let m)) = r else { return nil }
        return m
    }

    private func value(_ r: Result<CleaningCompute.NormalizedCleaningLog, CleaningWriteError>) -> CleaningCompute.NormalizedCleaningLog? {
        guard case .success(let v) = r else { return nil }
        return v
    }

    func testMissingItemAndTaskRejected() {
        XCTAssertEqual(message(validate()), "item or task is required")
        XCTAssertEqual(message(validate(task: "   ", item: "  ")), "item or task is required")
    }

    func testTaskTooLongRejected() {
        let m = message(validate(task: String(repeating: "x", count: CleaningCompute.taskMaxLen + 1)))
        XCTAssertTrue(m?.contains("task length") == true, "got \(m ?? "nil")")
    }

    func testAreaTooLongRejected() {
        let m = message(validate(task: "Wipe", area: String(repeating: "a", count: CleaningCompute.areaMaxLen + 1)))
        XCTAssertTrue(m?.contains("area length") == true, "got \(m ?? "nil")")
    }

    func testNotesTooLongRejected() {
        let m = message(validate(task: "Wipe", notes: String(repeating: "n", count: CleaningCompute.notesMaxLen + 1)))
        XCTAssertTrue(m?.contains("notes length") == true, "got \(m ?? "nil")")
    }

    func testCompletedAtTooLongRejected() {
        let m = message(validate(task: "Wipe", completedAt: String(repeating: "1", count: CleaningCompute.completedAtMaxLen + 1)))
        XCTAssertTrue(m?.contains("completed_at length") == true, "got \(m ?? "nil")")
    }

    func testCompletedAtNonISORejected() {
        XCTAssertEqual(message(validate(task: "Wipe", completedAt: "not-a-date")), "completed_at must be an ISO-8601 timestamp")
    }

    func testShiftDateBadFormatRejected() {
        XCTAssertEqual(message(validate(task: "Wipe", shiftDate: "2026/04/20")), "shift_date must match YYYY-MM-DD")
    }

    func testShiftDateTooLongRejected() {
        let m = message(validate(task: "Wipe", shiftDate: String(repeating: "1", count: CleaningCompute.shiftDateMaxLen + 1)))
        XCTAssertTrue(m?.contains("shift_date length") == true, "got \(m ?? "nil")")
    }

    func testCookIdTooLongRejected() {
        let m = message(validate(task: "Wipe", cookId: String(repeating: "c", count: CleaningCompute.cookIdMaxLen + 1)))
        XCTAssertTrue(m?.contains("cook_id length") == true, "got \(m ?? "nil")")
    }

    func testVerifiedByCookIdTooLongRejected() {
        let m = message(validate(task: "Wipe", verifiedByCookId: String(repeating: "v", count: CleaningCompute.cookIdMaxLen + 1)))
        XCTAssertTrue(m?.contains("verified_by_cook_id length") == true, "got \(m ?? "nil")")
    }

    func testScheduleIdNonPositiveRejected() {
        XCTAssertEqual(message(validate(task: "Wipe", scheduleId: 0)), "schedule_id must be a positive integer")
        XCTAssertEqual(message(validate(task: "Wipe", scheduleId: -1)), "schedule_id must be a positive integer")
    }

    func testItemPreferredOverTaskAndTrimmed() {
        let v = value(validate(task: "task-fallback", item: "  Sanitize station  ", area: "  Grill  "))
        XCTAssertEqual(v?.task, "Sanitize station")   // item wins, trimmed
        XCTAssertEqual(v?.area, "Grill")               // trimmed
    }

    func testTaskUsedWhenItemEmpty() {
        XCTAssertEqual(value(validate(task: "Mop the floor", item: "   "))?.task, "Mop the floor")
    }
}
