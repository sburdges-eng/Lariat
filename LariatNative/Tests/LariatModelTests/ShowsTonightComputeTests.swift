import XCTest
@testable import LariatModel

// Value-parity port of `tests/js/test-shows-tonight-rules.mjs` — every JS
// case has a 1:1 native test (JS coercion cases become their typed analogs).
final class ShowsTonightComputeTests: XCTestCase {

    private func show(
        id: Int64 = 1, date: String = "2026-05-11", band: String = "Test Band",
        statusJson: String = "{}"
    ) -> ShowRow {
        ShowRow(id: id, locationId: "default", bandName: band, showDate: date,
                price: 20, doorTix: "7pm", statusJson: statusJson)
    }

    private func line(
        source: String = "walkup", qty: Int = 1, face: Double? = 0,
        fees: Double? = 0, scannedAt: String? = nil
    ) -> BoxOfficeLineRow {
        BoxOfficeLineRow(
            id: 1, showId: 1, locationId: "default", source: source,
            ticketClass: nil, qty: qty, facePrice: face, fees: fees,
            externalRef: nil, scannedAt: scannedAt, notes: nil, createdAt: nil
        )
    }

    // ── resolveTonightShow ─────────────────────────────────────────────

    func testResolveReturnsRowMatchingToday() {
        let rows = [
            show(id: 1, date: "2026-05-10", band: "Yesterday"),
            show(id: 2, date: "2026-05-11", band: "Tonight"),
            show(id: 3, date: "2026-05-12", band: "Tomorrow"),
        ]
        XCTAssertEqual(ShowsTonightCompute.resolveTonightShow(rows, today: "2026-05-11")?.bandName, "Tonight")
    }

    func testResolveReturnsNilWhenNoMatch() {
        XCTAssertNil(ShowsTonightCompute.resolveTonightShow([show(date: "2026-05-10")], today: "2026-05-11"))
    }

    func testResolveReturnsNilOnEmptyOrMissingInput() {
        XCTAssertNil(ShowsTonightCompute.resolveTonightShow([], today: "2026-05-11"))
        XCTAssertNil(ShowsTonightCompute.resolveTonightShow(nil, today: "2026-05-11"))
    }

    // ── findPreviousShow ───────────────────────────────────────────────

    func testPreviousReturnsMostRecentBeforeTonight() {
        let rows = [
            show(id: 1, date: "2026-05-08", band: "A"),
            show(id: 2, date: "2026-05-09", band: "B"),
            show(id: 3, date: "2026-05-11", band: "Tonight"),
        ]
        XCTAssertEqual(ShowsTonightCompute.findPreviousShow(rows, tonightDate: "2026-05-11")?.bandName, "B")
    }

    func testPreviousWithNoTonightDateReturnsMostRecentPast() {
        let rows = [
            show(id: 1, date: "2026-05-08", band: "A"),
            show(id: 2, date: "2026-05-09", band: "B"),
        ]
        XCTAssertEqual(ShowsTonightCompute.findPreviousShow(rows, tonightDate: nil)?.bandName, "B")
    }

    func testPreviousReturnsNilWhenNothingPrecedes() {
        XCTAssertNil(ShowsTonightCompute.findPreviousShow([show(date: "2026-05-12")], tonightDate: "2026-05-11"))
    }

    func testPreviousDoesNotReturnTonightItselfStrictLessThan() {
        let rows = [
            show(id: 1, date: "2026-05-11", band: "Tonight"),
            show(id: 2, date: "2026-05-10", band: "Yesterday"),
        ]
        XCTAssertEqual(ShowsTonightCompute.findPreviousShow(rows, tonightDate: "2026-05-11")?.bandName, "Yesterday")
    }

    // ── summarizeBoxOffice ─────────────────────────────────────────────

    func testSummarizeZeroBucketsForEmptyInput() {
        let s = ShowsTonightCompute.summarizeBoxOffice([])
        XCTAssertEqual(s.totalQty, 0)
        XCTAssertEqual(s.scannedQty, 0)
        XCTAssertEqual(s.totalRevenue, 0)
        XCTAssertEqual(s.bySource[.dice]?.qty, 0)
        XCTAssertEqual(s.bySource[.walkup]?.qty, 0)
    }

    func testSummarizeSumsQtyTimesFacePlusFeesPerSource() {
        let s = ShowsTonightCompute.summarizeBoxOffice([
            line(source: "dice", qty: 50, face: 20, fees: 100),
            line(source: "walkup", qty: 10, face: 25),
            line(source: "comp", qty: 4, face: 0),
        ])
        XCTAssertEqual(s.totalQty, 64)
        XCTAssertEqual(s.bySource[.dice]?.qty, 50)
        XCTAssertEqual(s.bySource[.dice]?.revenue, 50 * 20 + 100)
        XCTAssertEqual(s.bySource[.walkup]?.revenue, 250)
        XCTAssertEqual(s.bySource[.comp]?.revenue, 0)
        XCTAssertEqual(s.totalRevenue, Double(50 * 20 + 100 + 10 * 25 + 0))
    }

    func testSummarizeCountsScannedQtyOnlyWhenScannedAtNonNil() {
        let s = ShowsTonightCompute.summarizeBoxOffice([
            line(source: "dice", qty: 30, scannedAt: "2026-05-11T20:14:00Z"),
            line(source: "dice", qty: 20, scannedAt: nil),
            line(source: "walkup", qty: 5, scannedAt: "2026-05-11T21:01:00Z"),
        ])
        XCTAssertEqual(s.totalQty, 55)
        XCTAssertEqual(s.scannedQty, 35)
    }

    func testSummarizeRoundsRevenueToCents() {
        let s = ShowsTonightCompute.summarizeBoxOffice([
            line(source: "dice", qty: 1, face: 19.999, fees: 0.001),
        ])
        XCTAssertEqual(s.totalRevenue, 20.0)
    }

    func testSummarizeIgnoresUnknownSourceSilently() {
        let s = ShowsTonightCompute.summarizeBoxOffice([line(source: "bogus", qty: 99)])
        XCTAssertEqual(s.totalQty, 0)
    }

    // ── parseStatusJson ────────────────────────────────────────────────

    func testParseStatusJsonValid() {
        XCTAssertEqual(ShowsTonightCompute.parseStatusJson(#"{"doors":"7pm"}"#),
                       ["doors": .string("7pm")])
    }

    func testParseStatusJsonEmptyOnNilOrEmpty() {
        XCTAssertEqual(ShowsTonightCompute.parseStatusJson(nil), [:])
        XCTAssertEqual(ShowsTonightCompute.parseStatusJson(""), [:])
    }

    func testParseStatusJsonEmptyOnMalformed() {
        XCTAssertEqual(ShowsTonightCompute.parseStatusJson("{not json"), [:])
    }

    func testParseStatusJsonEmptyWhenNotPlainObject() {
        XCTAssertEqual(ShowsTonightCompute.parseStatusJson("[1,2,3]"), [:])
        XCTAssertEqual(ShowsTonightCompute.parseStatusJson("\"a string\""), [:])
    }

    // ── pickShowTime ───────────────────────────────────────────────────

    func testPickShowTimeReturnsNamedField() {
        XCTAssertEqual(ShowsTonightCompute.pickShowTime(["doors": .string("7pm")], key: .doors), "7pm")
        XCTAssertEqual(ShowsTonightCompute.pickShowTime(["set1": .string("8:30pm")], key: .set1), "8:30pm")
    }

    func testPickShowTimeFallsBackDoorsToDoorTime() {
        XCTAssertEqual(ShowsTonightCompute.pickShowTime(["door_time": .string("6:30pm")], key: .doors), "6:30pm")
    }

    func testPickShowTimeNilWhenMissingBlankOrWrongType() {
        XCTAssertNil(ShowsTonightCompute.pickShowTime([:], key: .set1))
        XCTAssertNil(ShowsTonightCompute.pickShowTime(["set1": .string("  ")], key: .set1))
        XCTAssertNil(ShowsTonightCompute.pickShowTime(["set1": .number(42)], key: .set1))
    }

    // ── parseRunOfShow ─────────────────────────────────────────────────

    func testRunOfShowEmptyOnNilOrEmpty() {
        XCTAssertEqual(ShowsTonightCompute.parseRunOfShow(nil), [])
        XCTAssertEqual(ShowsTonightCompute.parseRunOfShow(""), [])
    }

    func testRunOfShowEmptyOnMalformedJson() {
        XCTAssertEqual(ShowsTonightCompute.parseRunOfShow("{not json"), [])
    }

    func testRunOfShowEmptyWhenNotArray() {
        XCTAssertEqual(ShowsTonightCompute.parseRunOfShow(#"{"foo":"bar"}"#), [])
    }

    func testRunOfShowParsesTimeLabelObjects() {
        let raw = #"[{"time":"7:00pm","label":"Doors"},{"time":"8:30pm","label":"Set 1"}]"#
        let out = ShowsTonightCompute.parseRunOfShow(raw)
        XCTAssertEqual(out.count, 2)
        XCTAssertEqual(out[0].label, "Doors")
        XCTAssertEqual(out[1].time, "8:30pm")
    }

    func testRunOfShowAcceptsAtTextAliases() {
        let out = ShowsTonightCompute.parseRunOfShow(#"[{"at":"9:45pm","text":"Set 2"}]"#)
        XCTAssertEqual(out, [TonightRunEntry(time: "9:45pm", label: "Set 2")])
    }

    func testRunOfShowAcceptsFlatStringEntries() {
        let out = ShowsTonightCompute.parseRunOfShow(#"["Lights down","Walk-on"]"#)
        XCTAssertEqual(out.count, 2)
        XCTAssertNil(out[0].time)
        XCTAssertEqual(out[0].label, "Lights down")
    }

    func testRunOfShowSkipsEntriesWithNoLabelOrNonObjects() {
        let out = ShowsTonightCompute.parseRunOfShow(#"[{"time":"7pm"},42,null,{"label":"OK"}]"#)
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].label, "OK")
    }

    // ── computeAttendance ──────────────────────────────────────────────

    func testAttendanceUnsetWhenCapacityMissingZeroOrInvalid() {
        for cap in [nil, 0, -5, Double.nan] as [Double?] {
            let a = ShowsTonightCompute.computeAttendance(scannedQty: 50, soldQty: 100, capacity: cap)
            XCTAssertEqual(a.status, .unset, "cap=\(String(describing: cap)) should be unset")
            XCTAssertNil(a.scannedPct)
            XCTAssertNil(a.soldPct)
            XCTAssertNil(a.capacity)
            XCTAssertEqual(a.scannedQty, 50)
            XCTAssertEqual(a.soldQty, 100)
        }
    }

    func testAttendanceUnderBelow50Pct() {
        let a = ShowsTonightCompute.computeAttendance(scannedQty: 40, soldQty: 60, capacity: 100)
        XCTAssertEqual(a.status, .under)
        XCTAssertEqual(a.scannedPct, 40)
        XCTAssertEqual(a.soldPct, 60)
        XCTAssertEqual(a.capacity, 100)
    }

    func testAttendanceNearAt50PctExactly() {
        let a = ShowsTonightCompute.computeAttendance(scannedQty: 50, soldQty: 80, capacity: 100)
        XCTAssertEqual(a.status, .near)
        XCTAssertEqual(a.scannedPct, 50)
    }

    func testAttendanceNearAt79Pct() {
        XCTAssertEqual(ShowsTonightCompute.computeAttendance(scannedQty: 79, soldQty: 90, capacity: 100).status, .near)
    }

    func testAttendanceAtAt80PctExactly() {
        let a = ShowsTonightCompute.computeAttendance(scannedQty: 80, soldQty: 100, capacity: 100)
        XCTAssertEqual(a.status, .at)
        XCTAssertEqual(a.scannedPct, 80)
    }

    func testAttendanceAtAt100PctFullHouse() {
        let a = ShowsTonightCompute.computeAttendance(scannedQty: 150, soldQty: 150, capacity: 150)
        XCTAssertEqual(a.status, .at)
        XCTAssertEqual(a.scannedPct, 100)
    }

    func testAttendanceOverWhenScannedExceedsCapacity() {
        let a = ShowsTonightCompute.computeAttendance(scannedQty: 160, soldQty: 160, capacity: 150)
        XCTAssertEqual(a.status, .over)
        XCTAssertGreaterThan(a.scannedPct ?? 0, 100)
    }

    func testAttendanceRoundsPctToTenth() {
        let a = ShowsTonightCompute.computeAttendance(scannedQty: 33, soldQty: 60, capacity: 100)
        XCTAssertEqual(a.scannedPct, 33)
        let b = ShowsTonightCompute.computeAttendance(scannedQty: 1, soldQty: 0, capacity: 3)  // 33.333...
        XCTAssertEqual(b.scannedPct, 33.3)
    }

    func testAttendanceClampsNegativeToZero() {
        let a = ShowsTonightCompute.computeAttendance(scannedQty: -10, soldQty: -5, capacity: 100)
        XCTAssertEqual(a.scannedQty, 0)
        XCTAssertEqual(a.soldQty, 0)
        XCTAssertEqual(a.status, .under)
    }

    func testAttendanceCoercesNilInputsToZero() {
        let a = ShowsTonightCompute.computeAttendance(scannedQty: nil, soldQty: nil, capacity: 100)
        XCTAssertEqual(a.scannedQty, 0)
        XCTAssertEqual(a.soldQty, 0)
        XCTAssertEqual(a.status, .under)
    }

    func testAttendanceFloorsFractionalCapacity() {
        XCTAssertEqual(ShowsTonightCompute.computeAttendance(scannedQty: 50, soldQty: 50, capacity: 99.9).capacity, 99)
    }

    // ── pickEffectiveCapacity ──────────────────────────────────────────

    func testEffectiveCapacityOverrideWinsWhenValid() {
        XCTAssertEqual(ShowsTonightCompute.pickEffectiveCapacity(["capacity": .number(180)], venueCapacity: 220), 180)
        XCTAssertEqual(ShowsTonightCompute.pickEffectiveCapacity(["capacity": .string("180")], venueCapacity: 220), 180)
    }

    func testEffectiveCapacityFloorsFractionalOverrides() {
        XCTAssertEqual(ShowsTonightCompute.pickEffectiveCapacity(["capacity": .number(180.7)], venueCapacity: 220), 180)
    }

    func testEffectiveCapacityFallsThroughOnZeroNegativeNonNumeric() {
        XCTAssertEqual(ShowsTonightCompute.pickEffectiveCapacity(["capacity": .number(0)], venueCapacity: 220), 220)
        XCTAssertEqual(ShowsTonightCompute.pickEffectiveCapacity(["capacity": .number(-5)], venueCapacity: 220), 220)
        XCTAssertEqual(ShowsTonightCompute.pickEffectiveCapacity(["capacity": .string("soldout")], venueCapacity: 220), 220)
    }

    func testEffectiveCapacityVenueWhenNoOverrideKey() {
        XCTAssertEqual(ShowsTonightCompute.pickEffectiveCapacity([:], venueCapacity: 220), 220)
        XCTAssertEqual(ShowsTonightCompute.pickEffectiveCapacity(nil, venueCapacity: 220), 220)
    }

    func testEffectiveCapacityNilWhenNeitherSet() {
        XCTAssertNil(ShowsTonightCompute.pickEffectiveCapacity([:], venueCapacity: nil))
        XCTAssertNil(ShowsTonightCompute.pickEffectiveCapacity(["capacity": .number(0)], venueCapacity: 0))
        XCTAssertNil(ShowsTonightCompute.pickEffectiveCapacity(["capacity": .number(-1)], venueCapacity: nil))
    }
}
