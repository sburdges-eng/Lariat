import XCTest
@testable import LariatModel

// Value-parity port of tests/js/test-receiving-rules.mjs — receiving temp-check
// classifier (FDA §3-202.11, §3-202.15, §3-101.11, §3-501.16). Known input/output
// values lifted from the web test so the Swift rule module cannot drift.

final class ReceivingComputeTests: XCTestCase {

    private func validate(
        category: String?,
        readingF: Double? = nil,
        packageOk: Bool? = nil,
        expirationDate: String? = nil,
        receivedAt: String? = nil,
        receivedQty: Double? = nil,
        receivedUnit: String? = nil
    ) -> ReceivingReadingResult {
        ReceivingCompute.validateReceivingReading(ReceivingReadingInput(
            category: category, readingF: readingF, packageOk: packageOk,
            expirationDate: expirationDate, receivedAt: receivedAt,
            receivedQty: receivedQty, receivedUnit: receivedUnit
        ))
    }

    // ── Category registry ──────────────────────────────────────────────

    func testCategoriesCoverExpectedTruckToDoorSet() {
        let required: [ReceivingCategory] = [.refrigerated, .frozen, .shellEggs, .hotHeld, .dryGoods, .produce]
        for id in required {
            XCTAssertNotNil(ReceivingCompute.rules[id], "missing rule for \(id)")
        }
        XCTAssertGreaterThanOrEqual(ReceivingCompute.categories.count, 6)
    }

    func testEveryCategoryHasCitationWithSection() {
        for id in ReceivingCompute.categories {
            let rule = ReceivingCompute.rules[id]
            XCTAssertNotNil(rule)
            XCTAssertTrue(rule?.citation.contains("§") == true, "\(id) citation missing §")
        }
    }

    func testRefrigeratedCeilingIs41() {
        let r = ReceivingCompute.rules[.refrigerated]
        XCTAssertEqual(r?.requiredMaxF, 41)
        XCTAssertEqual(r?.requiresReading, true)
    }

    func testFrozenCeilingIs10() {
        XCTAssertEqual(ReceivingCompute.rules[.frozen]?.requiredMaxF, 10)
    }

    func testShellEggsCeilingIs45() {
        XCTAssertEqual(ReceivingCompute.rules[.shellEggs]?.requiredMaxF, 45)
    }

    func testHotHeldFloorIs135() {
        XCTAssertEqual(ReceivingCompute.rules[.hotHeld]?.requiredMinF, 135)
        XCTAssertNil(ReceivingCompute.rules[.hotHeld]?.requiredMaxF ?? nil)
    }

    func testDryGoodsAndProduceDoNotRequireReading() {
        XCTAssertEqual(ReceivingCompute.rules[.dryGoods]?.requiresReading, false)
        XCTAssertEqual(ReceivingCompute.rules[.produce]?.requiresReading, false)
    }

    func testRuleForUnknownIdIsNil() {
        XCTAssertNil(ReceivingCompute.rule(for: "not_a_category"))
        XCTAssertNil(ReceivingCompute.rule(for: nil))
    }

    // ── ok path ─────────────────────────────────────────────────────────

    func testRefrigeratedAt38IsOk() {
        let v = validate(category: "refrigerated", readingF: 38, packageOk: true)
        XCTAssertEqual(v.status, .ok)
        XCTAssertNil(v.reason)
        XCTAssertEqual(v.requiredMaxF, 41)
    }

    func testRefrigeratedAt41ExactlyIsOk() {
        XCTAssertEqual(validate(category: "refrigerated", readingF: 41, packageOk: true).status, .ok)
    }

    func testFrozenAtMinus5IsOk() {
        XCTAssertEqual(validate(category: "frozen", readingF: -5, packageOk: true).status, .ok)
    }

    func testShellEggsAt45IsOk() {
        XCTAssertEqual(validate(category: "shell_eggs", readingF: 45, packageOk: true).status, .ok)
    }

    func testHotHeldAt140IsOk() {
        XCTAssertEqual(validate(category: "hot_held", readingF: 140, packageOk: true).status, .ok)
    }

    func testDryGoodsNoReadingIsOk() {
        XCTAssertEqual(validate(category: "dry_goods", packageOk: true).status, .ok)
    }

    func testProduceNoReadingIsOk() {
        XCTAssertEqual(validate(category: "produce", packageOk: true).status, .ok)
    }

    func testOmittedPackageOkDefaultsToOk() {
        XCTAssertEqual(validate(category: "refrigerated", readingF: 38).status, .ok)
    }

    // ── accept_with_note (drift band) ───────────────────────────────────

    func testRefrigeratedAt43IsAcceptWithNote() {
        let v = validate(category: "refrigerated", readingF: 43, packageOk: true)
        XCTAssertEqual(v.status, .acceptWithNote)
        XCTAssertTrue(v.reason?.contains("drift band") == true)
        XCTAssertEqual(v.requiredMaxF, 41)
    }

    func testRefrigeratedAt45IsAcceptWithNote() {
        XCTAssertEqual(validate(category: "refrigerated", readingF: 45, packageOk: true).status, .acceptWithNote)
    }

    func testFrozenAt20IsAcceptWithNote() {
        XCTAssertEqual(validate(category: "frozen", readingF: 20, packageOk: true).status, .acceptWithNote)
    }

    func testHotHeldAt132IsAcceptWithNote() {
        XCTAssertEqual(validate(category: "hot_held", readingF: 132, packageOk: true).status, .acceptWithNote)
    }

    func testShellEggsAt48IsAcceptWithNote() {
        XCTAssertEqual(validate(category: "shell_eggs", readingF: 48, packageOk: true).status, .acceptWithNote)
    }

    // ── rejected path ───────────────────────────────────────────────────

    func testRefrigeratedAt46IsRejected() {
        let v = validate(category: "refrigerated", readingF: 46, packageOk: true)
        XCTAssertEqual(v.status, .rejected)
        XCTAssertTrue(v.reason?.contains("exceeds") == true)
    }

    func testFrozenAt30IsRejected() {
        XCTAssertEqual(validate(category: "frozen", readingF: 30, packageOk: true).status, .rejected)
    }

    func testHotHeldAt125IsRejected() {
        XCTAssertEqual(validate(category: "hot_held", readingF: 125, packageOk: true).status, .rejected)
    }

    func testPackageFalseBeatsPassingTemp() {
        let v = validate(category: "refrigerated", readingF: 38, packageOk: false)
        XCTAssertEqual(v.status, .rejected)
        XCTAssertTrue(v.reason?.contains("package") == true)
        XCTAssertTrue(v.citation?.contains("§3-202.15") == true)
    }

    func testPackageFalseRejectsDryGoods() {
        let v = validate(category: "dry_goods", packageOk: false)
        XCTAssertEqual(v.status, .rejected)
        XCTAssertTrue(v.reason?.contains("package") == true)
    }

    func testSellByInPastRejects() {
        let v = validate(category: "refrigerated", readingF: 38, packageOk: true,
                         expirationDate: "2020-01-01", receivedAt: "2026-04-21")
        XCTAssertEqual(v.status, .rejected)
        XCTAssertTrue(v.citation?.contains("§3-101.11") == true)
    }

    func testSellBySameDayAccepted() {
        let v = validate(category: "refrigerated", readingF: 38, packageOk: true,
                         expirationDate: "2026-04-21", receivedAt: "2026-04-21")
        XCTAssertEqual(v.status, .ok)
    }

    func testSellByFutureAccepted() {
        let v = validate(category: "refrigerated", readingF: 38, packageOk: true,
                         expirationDate: "2026-05-01", receivedAt: "2026-04-21")
        XCTAssertEqual(v.status, .ok)
    }

    func testRefrigeratedNoReadingRejects() {
        let v = validate(category: "refrigerated", packageOk: true)
        XCTAssertEqual(v.status, .rejected)
        XCTAssertTrue(v.reason?.contains("temperature reading") == true)
    }

    func testFrozenNoReadingRejects() {
        XCTAssertEqual(validate(category: "frozen", packageOk: true).status, .rejected)
    }

    func testAbsurdReadingRejects() {
        let v = validate(category: "refrigerated", readingF: 9999, packageOk: true)
        XCTAssertEqual(v.status, .rejected)
        XCTAssertTrue(v.reason?.contains("off the charts") == true)
    }

    func testNaNReadingIsTreatedAsNoReadingAndRejects() {
        XCTAssertEqual(validate(category: "refrigerated", readingF: .nan, packageOk: true).status, .rejected)
    }

    // ── unknown category ────────────────────────────────────────────────

    func testUnknownCategoryReturnsAcceptWithNote() {
        let v = validate(category: "specialty_bakery", packageOk: true)
        XCTAssertEqual(v.status, .acceptWithNote)
        XCTAssertTrue(v.reason?.contains("Unknown category") == true)
        XCTAssertNil(v.citation)
        XCTAssertNil(v.requiredMaxF)
        XCTAssertNil(v.closedLoopError)
    }

    func testNilCategoryFallsThroughToAcceptWithNote() {
        XCTAssertEqual(validate(category: nil, packageOk: true).status, .acceptWithNote)
    }

    func testUnknownCategoryStillSurfacesClosedLoopError() {
        let v = validate(category: "specialty_bakery", packageOk: true, receivedQty: -5, receivedUnit: "lb")
        XCTAssertEqual(v.status, .acceptWithNote)
        XCTAssertTrue(v.closedLoopError?.contains("received_qty") == true)
    }

    // ── closed-loop field checks ────────────────────────────────────────

    func testClosedLoopBothAbsentIsNoError() {
        XCTAssertNil(validate(category: "refrigerated", readingF: 38, packageOk: true).closedLoopError)
    }

    func testClosedLoopValidPairIsNoError() {
        let v = validate(category: "refrigerated", readingF: 38, packageOk: true, receivedQty: 40, receivedUnit: "lb")
        XCTAssertNil(v.closedLoopError)
    }

    func testClosedLoopNegativeQtyErrors() {
        let v = validate(category: "refrigerated", readingF: 38, packageOk: true, receivedQty: -5, receivedUnit: "lb")
        XCTAssertTrue(v.closedLoopError?.contains("greater than 0") == true)
        XCTAssertTrue(v.closedLoopError?.contains("got -5") == true)
    }

    func testClosedLoopZeroQtyErrors() {
        let v = validate(category: "refrigerated", readingF: 38, packageOk: true, receivedQty: 0, receivedUnit: "lb")
        XCTAssertTrue(v.closedLoopError?.contains("greater than 0") == true)
    }

    func testClosedLoopQtyWithoutUnitErrors() {
        let v = validate(category: "refrigerated", readingF: 38, packageOk: true, receivedQty: 40, receivedUnit: nil)
        XCTAssertTrue(v.closedLoopError?.contains("received_unit must be a non-empty") == true)
    }

    func testClosedLoopUnitWithoutQtyErrors() {
        // unit provided, qty absent → qty must be a number
        let v = validate(category: "refrigerated", readingF: 38, packageOk: true, receivedQty: nil, receivedUnit: "lb")
        XCTAssertTrue(v.closedLoopError?.contains("received_qty must be a number") == true)
    }

    func testClosedLoopUnitTooLongErrors() {
        let longUnit = String(repeating: "x", count: 33)
        let v = validate(category: "refrigerated", readingF: 38, packageOk: true, receivedQty: 1, receivedUnit: longUnit)
        XCTAssertTrue(v.closedLoopError?.contains("too long") == true)
    }

    // ── classifyDeliveries — tile aggregator ────────────────────────────

    func testEmptyDayReturnsOneGrayTilePerCategory() {
        let s = ReceivingCompute.classifyDeliveries([])
        XCTAssertEqual(s.count, ReceivingCompute.categories.count)
        for t in s {
            XCTAssertEqual(t.status, .gray)
            XCTAssertEqual(t.total, 0)
        }
    }

    func testOneAcceptedRefrigeratedTurnsTileGreenRestGray() {
        let s = ReceivingCompute.classifyDeliveries([
            ReceivingClassifyRow(category: "refrigerated", status: "accepted", createdAt: "2026-04-21 09:00:00")
        ])
        XCTAssertEqual(s.first(where: { $0.category == .refrigerated })?.status, .green)
        XCTAssertEqual(s.first(where: { $0.category == .refrigerated })?.accepted, 1)
        XCTAssertEqual(s.first(where: { $0.category == .frozen })?.status, .gray)
    }

    func testAcceptWithNoteTileIsYellow() {
        let s = ReceivingCompute.classifyDeliveries(
            [ReceivingClassifyRow(category: "refrigerated", status: "accepted_with_note", createdAt: nil)],
            expectAllCategories: false
        )
        XCTAssertEqual(s.count, 1)
        XCTAssertEqual(s[0].status, .yellow)
        XCTAssertEqual(s[0].acceptedWithNote, 1)
    }

    func testRejectedTileIsRedEvenWithAccepts() {
        let s = ReceivingCompute.classifyDeliveries([
            ReceivingClassifyRow(category: "refrigerated", status: "accepted", createdAt: "2026-04-21 08:00:00"),
            ReceivingClassifyRow(category: "refrigerated", status: "accepted", createdAt: "2026-04-21 09:00:00"),
            ReceivingClassifyRow(category: "refrigerated", status: "rejected", createdAt: "2026-04-21 10:00:00"),
        ], expectAllCategories: false)
        XCTAssertEqual(s.count, 1)
        XCTAssertEqual(s[0].status, .red)
        XCTAssertEqual(s[0].rejected, 1)
        XCTAssertEqual(s[0].accepted, 2)
    }

    func testOrphanCategoryRowsDropped() {
        let s = ReceivingCompute.classifyDeliveries([
            ReceivingClassifyRow(category: "refrigerated", status: "accepted", createdAt: nil),
            ReceivingClassifyRow(category: "legacy_retired", status: "accepted", createdAt: nil),
        ], expectAllCategories: false)
        XCTAssertEqual(s.count, 1)
        XCTAssertEqual(s[0].category, .refrigerated)
    }

    func testLastAtTracksLatestCreatedAt() {
        let s = ReceivingCompute.classifyDeliveries([
            ReceivingClassifyRow(category: "refrigerated", status: "accepted", createdAt: "2026-04-21 08:00:00"),
            ReceivingClassifyRow(category: "refrigerated", status: "accepted", createdAt: "2026-04-21 14:00:00"),
            ReceivingClassifyRow(category: "refrigerated", status: "accepted", createdAt: "2026-04-21 10:00:00"),
        ], expectAllCategories: false)
        XCTAssertEqual(s[0].lastAt, "2026-04-21 14:00:00")
    }

    // ── status helpers ──────────────────────────────────────────────────

    func testStatusRoundTripOk() {
        XCTAssertEqual(ReceivingCompute.dbStatus(for: .ok), .accepted)
        XCTAssertEqual(ReceivingCompute.libStatus(for: "accepted"), .ok)
    }

    func testStatusRoundTripAcceptWithNote() {
        XCTAssertEqual(ReceivingCompute.dbStatus(for: .acceptWithNote), .acceptedWithNote)
        XCTAssertEqual(ReceivingCompute.libStatus(for: "accepted_with_note"), .acceptWithNote)
    }

    func testStatusRoundTripRejected() {
        XCTAssertEqual(ReceivingCompute.dbStatus(for: .rejected), .rejected)
        XCTAssertEqual(ReceivingCompute.libStatus(for: "rejected"), .rejected)
    }

    // ── threshold constants pin ─────────────────────────────────────────

    func testThresholdConstants() {
        XCTAssertEqual(ReceivingCompute.rules[.refrigerated]?.requiredMaxF, 41)
        XCTAssertEqual(ReceivingCompute.rules[.refrigerated]?.driftMaxF, 45)
        XCTAssertEqual(ReceivingCompute.rules[.frozen]?.requiredMaxF, 10)
        XCTAssertEqual(ReceivingCompute.rules[.frozen]?.driftMaxF, 25)
        XCTAssertEqual(ReceivingCompute.rules[.shellEggs]?.driftMaxF, 50)
        XCTAssertEqual(ReceivingCompute.rules[.hotHeld]?.driftMinF, 130)
        XCTAssertEqual(ReceivingCompute.rules[.shellfish]?.requiredMaxF, 45)
    }
}
