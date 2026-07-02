import XCTest
@testable import LariatModel

/// Parity for the pure T8 layer — port of the "pure math" + formatting + reasons
/// blocks of tests/js/test-t8-cooking-shrinkage.mjs, plus the waste-window helpers.
final class InventoryShrinkageComputeTests: XCTestCase {
    typealias S = InventoryShrinkage

    // ── applyShrinkage ──────────────────────────────────────────────────

    func testAcceptanceCase() {
        let r = S.applyShrinkage(cookedQty: 8, lossFactor: 0.25, unit: "oz")
        XCTAssertTrue(r.applied)
        XCTAssertEqual(r.lossFactor, 0.25)
        XCTAssertEqual(r.reason, .applied)
        XCTAssertEqual(r.rawQty, 10.6667, accuracy: 0.001)
    }

    func testNullLossFactor() {
        let r = S.applyShrinkage(cookedQty: 8, lossFactor: nil, unit: "oz")
        XCTAssertFalse(r.applied)
        XCTAssertEqual(r.rawQty, 8)
        XCTAssertEqual(r.reason, .noLossFactor)
    }

    func testLossFactorBoundaries() {
        for lf in [0.0, 1.0, -0.1, 1.5] {
            let r = S.applyShrinkage(cookedQty: 8, lossFactor: lf, unit: "oz")
            XCTAssertFalse(r.applied, "lf=\(lf) should not apply")
            XCTAssertEqual(r.rawQty, 8)
            XCTAssertEqual(r.reason, .outOfRange, "lf=\(lf)")
        }
    }

    func testInvalidCookedQty() {
        XCTAssertEqual(S.applyShrinkage(cookedQty: 0, lossFactor: 0.25, unit: "oz").reason, .invalidQty)
        XCTAssertEqual(S.applyShrinkage(cookedQty: -5, lossFactor: 0.25, unit: "oz").reason, .invalidQty)
        XCTAssertEqual(S.applyShrinkage(cookedQty: .infinity, lossFactor: 0.25, unit: "oz").reason, .invalidQty)
        XCTAssertEqual(S.applyShrinkage(cookedQty: .nan, lossFactor: 0.25, unit: "oz").reason, .invalidQty)
    }

    func testHalfLossFactorDoublesRaw() {
        let r = S.applyShrinkage(cookedQty: 10, lossFactor: 0.5, unit: "g")
        XCTAssertTrue(r.applied)
        XCTAssertEqual(r.rawQty, 20, accuracy: 1e-9)
    }

    // ── formatDepletionDelta ─────────────────────────────────────────────

    func testFormatDepletionDelta() {
        XCTAssertEqual(S.formatDepletionDelta(rawQty: 10.6667, unit: "oz"), "-10.667 oz")
        XCTAssertEqual(S.formatDepletionDelta(rawQty: -10.6667, unit: "oz"), "-10.667 oz")   // already negative
        XCTAssertEqual(S.formatDepletionDelta(rawQty: 8, unit: "oz"), "-8 oz")               // strips trailing zeros
        XCTAssertEqual(S.formatDepletionDelta(rawQty: 8, unit: nil), "-8")
        XCTAssertEqual(S.formatDepletionDelta(rawQty: 8, unit: ""), "-8")
        XCTAssertEqual(S.formatDepletionDelta(rawQty: 10.5, unit: "lb"), "-10.5 lb")
    }

    // ── formatShrinkageNote ──────────────────────────────────────────────

    func testFormatShrinkageNoteApplied() {
        let note = S.formatShrinkageNote(S.ShrinkageMath(
            cookedQty: 8, unit: "oz", rawQty: 10.6667, applied: true, lossFactor: 0.25, reason: .applied
        ))
        XCTAssertTrue(note.contains("T8"))
        XCTAssertTrue(note.contains("cooked=8 oz"))
        XCTAssertTrue(note.contains("1-0.25"))
        XCTAssertTrue(note.contains("raw=10.667 oz"))
        XCTAssertTrue(note.contains("shrinkage_applied"))
    }

    func testFormatShrinkageNoteNotApplied() {
        let note = S.formatShrinkageNote(S.ShrinkageMath(
            cookedQty: 8, unit: "oz", rawQty: 8, applied: false, lossFactor: nil, reason: .noLossFactor
        ))
        XCTAssertTrue(note.contains("no shrinkage"))
        XCTAssertTrue(note.contains("no_loss_factor"))
    }

    // ── reason strings (public contract) ──────────────────────────────────

    func testReasonRawValues() {
        XCTAssertEqual(S.ShrinkageReason.applied.rawValue, "shrinkage_applied")
        XCTAssertEqual(S.ShrinkageReason.noLossFactor.rawValue, "no_loss_factor")
        XCTAssertEqual(S.ShrinkageReason.outOfRange.rawValue, "loss_factor_out_of_range")
        XCTAssertEqual(S.ShrinkageReason.noBomLine.rawValue, "no_bom_line")
        XCTAssertEqual(S.ShrinkageReason.invalidQty.rawValue, "invalid_cooked_qty")
    }

    // ── waste window helpers ──────────────────────────────────────────────

    func testClampDays() {
        XCTAssertEqual(InventoryWaste.clampDays(nil), 7)      // default
        XCTAssertEqual(InventoryWaste.clampDays(0), 7)        // not > 0
        XCTAssertEqual(InventoryWaste.clampDays(-1), 7)
        XCTAssertEqual(InventoryWaste.clampDays(91), 7)       // > 90
        XCTAssertEqual(InventoryWaste.clampDays(90.5), 7)     // > 90 before floor
        XCTAssertEqual(InventoryWaste.clampDays(1), 1)
        XCTAssertEqual(InventoryWaste.clampDays(7.9), 7)      // floor
        XCTAssertEqual(InventoryWaste.clampDays(30), 30)
        XCTAssertEqual(InventoryWaste.clampDays(90), 90)
    }

    func testSinceDate() {
        XCTAssertEqual(InventoryWaste.sinceDate(today: "2026-07-02", days: 1), "2026-07-02")   // days-1 = 0
        XCTAssertEqual(InventoryWaste.sinceDate(today: "2026-07-02", days: 7), "2026-06-26")   // -6, crosses month
        XCTAssertEqual(InventoryWaste.sinceDate(today: "2026-07-02", days: 30), "2026-06-03")  // -29
        XCTAssertEqual(InventoryWaste.sinceDate(today: "2026-01-01", days: 2), "2025-12-31")   // crosses year
    }
}
