import XCTest
@testable import LariatModel

/// Value-parity tests for `BeoCourseRules` — ported case-for-case from
/// `tests/js/test-beo-courses-rules.mjs` (the oracle for `lib/beoCourses.ts`).
/// Type-mismatch cases from the JS suite (notes: 12, sort_order: 'not a
/// number') are unrepresentable in the typed Swift draft and are documented
/// in the plan doc rather than ported.
final class BeoCourseRulesTests: XCTestCase {

    // ── isIso8601Utc ─────────────────────────────────────────────────────

    func testAcceptsCanonicalToISOStringOutput() {
        XCTAssertTrue(BeoCourseRules.isIso8601Utc("2026-05-04T19:30:00.000Z"))
    }

    func testRejectsZWithoutMilliseconds() {
        XCTAssertFalse(BeoCourseRules.isIso8601Utc("2026-05-04T19:30:00Z"))
    }

    func testRejectsSpaceSeparatedDateTime() {
        XCTAssertFalse(BeoCourseRules.isIso8601Utc("2026-05-04 19:30:00"))
    }

    func testRejectsGarbage() {
        XCTAssertFalse(BeoCourseRules.isIso8601Utc(""))
        XCTAssertFalse(BeoCourseRules.isIso8601Utc(nil))
        XCTAssertFalse(BeoCourseRules.isIso8601Utc("not a date"))
    }

    func testRejectsNonUtcOffset() {
        // JS: parses, but toISOString() renders 'Z' → not equal → false.
        XCTAssertFalse(BeoCourseRules.isIso8601Utc("2026-05-04T19:30:00.000+00:00"))
    }

    // ── validateCoursePayload ────────────────────────────────────────────

    func testAcceptsWellFormedPayload() {
        let r = BeoCourseRules.validateCoursePayload(BeoCourseRules.CourseDraft(
            courseLabel: "Entree",
            fireAt: "2026-05-04T19:30:00.000Z",
            notes: "no sauce on side"
        ))
        guard case .ok(let p) = r else { return XCTFail("expected ok, got \(r)") }
        XCTAssertEqual(p.courseLabel, "Entree")
        XCTAssertEqual(p.fireAt, "2026-05-04T19:30:00.000Z")
        XCTAssertEqual(p.notes, "no sauce on side")
        XCTAssertNil(p.sortOrder)
        XCTAssertNil(p.stationId)
    }

    func testRejectsMissingCourseLabel() {
        let r = BeoCourseRules.validateCoursePayload(BeoCourseRules.CourseDraft(
            fireAt: "2026-05-04T19:30:00.000Z"
        ))
        guard case .error(let msg) = r else { return XCTFail("expected error") }
        XCTAssertTrue(msg.contains("course_label"))
    }

    func testRejectsEmptyCourseLabelAfterTrim() {
        let r = BeoCourseRules.validateCoursePayload(BeoCourseRules.CourseDraft(
            courseLabel: "   ",
            fireAt: "2026-05-04T19:30:00.000Z"
        ))
        guard case .error = r else { return XCTFail("expected error") }
    }

    func testRejectsCourseLabelLongerThan80() {
        let r = BeoCourseRules.validateCoursePayload(BeoCourseRules.CourseDraft(
            courseLabel: String(repeating: "x", count: 81),
            fireAt: "2026-05-04T19:30:00.000Z"
        ))
        guard case .error(let msg) = r else { return XCTFail("expected error") }
        XCTAssertTrue(msg.contains("too long"))
    }

    func testRejectsNonCanonicalFireAt() {
        let r = BeoCourseRules.validateCoursePayload(BeoCourseRules.CourseDraft(
            courseLabel: "Entree",
            fireAt: "2026-05-04 19:30"
        ))
        guard case .error(let msg) = r else { return XCTFail("expected error") }
        XCTAssertTrue(msg.contains("fire_at"))
    }

    func testTreatsNilNotesAsAbsent() {
        let r = BeoCourseRules.validateCoursePayload(BeoCourseRules.CourseDraft(
            courseLabel: "Entree",
            fireAt: "2026-05-04T19:30:00.000Z",
            notes: nil
        ))
        guard case .ok(let p) = r else { return XCTFail("expected ok") }
        XCTAssertNil(p.notes)
    }

    func testEmptyNotesAfterTrimBecomeNil() {
        let r = BeoCourseRules.validateCoursePayload(BeoCourseRules.CourseDraft(
            courseLabel: "Entree",
            fireAt: "2026-05-04T19:30:00.000Z",
            notes: "   "
        ))
        guard case .ok(let p) = r else { return XCTFail("expected ok") }
        XCTAssertNil(p.notes)
    }

    func testRejectsNotesLongerThan2000() {
        let r = BeoCourseRules.validateCoursePayload(BeoCourseRules.CourseDraft(
            courseLabel: "Entree",
            fireAt: "2026-05-04T19:30:00.000Z",
            notes: String(repeating: "n", count: 2001)
        ))
        guard case .error(let msg) = r else { return XCTFail("expected error") }
        XCTAssertTrue(msg.contains("notes too long"))
    }

    func testRejectsNegativeSortOrder() {
        let r = BeoCourseRules.validateCoursePayload(BeoCourseRules.CourseDraft(
            courseLabel: "Entree",
            fireAt: "2026-05-04T19:30:00.000Z",
            sortOrder: -1
        ))
        guard case .error(let msg) = r else { return XCTFail("expected error") }
        XCTAssertTrue(msg.contains("sort_order"))
    }

    func testAcceptsZeroSortOrder() {
        let r = BeoCourseRules.validateCoursePayload(BeoCourseRules.CourseDraft(
            courseLabel: "Entree",
            fireAt: "2026-05-04T19:30:00.000Z",
            sortOrder: 0
        ))
        guard case .ok(let p) = r else { return XCTFail("expected ok") }
        XCTAssertEqual(p.sortOrder, 0)
    }

    func testRejectsUppercaseStationId() {
        let r = BeoCourseRules.validateCoursePayload(BeoCourseRules.CourseDraft(
            courseLabel: "Entree",
            fireAt: "2026-05-04T19:30:00.000Z",
            stationId: "GRILL"
        ))
        guard case .error(let msg) = r else { return XCTFail("expected error") }
        XCTAssertTrue(msg.contains("station_id"))
    }

    func testAcceptsLowercaseStationSlug() {
        let r = BeoCourseRules.validateCoursePayload(BeoCourseRules.CourseDraft(
            courseLabel: "Entree",
            fireAt: "2026-05-04T19:30:00.000Z",
            stationId: "grill"
        ))
        guard case .ok(let p) = r else { return XCTFail("expected ok") }
        XCTAssertEqual(p.stationId, "grill")
    }

    // ── isStationSlug ────────────────────────────────────────────────────

    func testStationSlugRules() {
        XCTAssertTrue(BeoCourseRules.isStationSlug("grill"))
        XCTAssertTrue(BeoCourseRules.isStationSlug("grill-1"))
        XCTAssertFalse(BeoCourseRules.isStationSlug(""))
        XCTAssertFalse(BeoCourseRules.isStationSlug("Grill"))
        XCTAssertFalse(BeoCourseRules.isStationSlug(nil))
    }

    // ── nextSortOrder ────────────────────────────────────────────────────

    func testNextSortOrderReturnsZeroWhenNoPriorCourses() {
        XCTAssertEqual(BeoCourseRules.nextSortOrder(nil), 0)
    }

    func testNextSortOrderAppendsWithPlusTenStep() {
        XCTAssertEqual(BeoCourseRules.nextSortOrder(0), 10)
        XCTAssertEqual(BeoCourseRules.nextSortOrder(20), 30)
    }

    func testNextSortOrderTreatsNegativeExistingAsZero() {
        XCTAssertEqual(BeoCourseRules.nextSortOrder(-5), 10)
    }

    // ── parseCourseIdPatch ───────────────────────────────────────────────
    // Tri-state input: nil = key absent, .some(nil) = explicit null (clear),
    // .some(.some(n)) = set.

    func testCourseIdPatchAbsentWhenKeyMissing() throws {
        XCTAssertEqual(try BeoCourseRules.parseCourseIdPatch(nil), .absent)
    }

    func testCourseIdPatchClearOnExplicitNull() throws {
        XCTAssertEqual(try BeoCourseRules.parseCourseIdPatch(.some(nil)), .clear)
    }

    func testCourseIdPatchSetOnPositiveInteger() throws {
        XCTAssertEqual(try BeoCourseRules.parseCourseIdPatch(42), .set(42))
    }

    func testCourseIdPatchThrowsOnNonPositive() {
        for bad: Int64 in [0, -1] {
            XCTAssertThrowsError(try BeoCourseRules.parseCourseIdPatch(.some(bad))) { error in
                guard case BeoWriteError.unprocessable(let msg) = error else {
                    return XCTFail("expected unprocessable, got \(error)")
                }
                XCTAssertTrue(msg.contains("positive integer"))
            }
        }
    }
}
