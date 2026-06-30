import XCTest
@testable import LariatModel

// Value-parity port of tests/js/test-cooling-rules.mjs — two-stage cooling
// classifier (FDA §3-501.14). Known input/output values lifted from the web
// test so the Swift classifier cannot drift from the JS rule module.

final class CoolingComputeTests: XCTestCase {

    // ── validateCoolingStart ───────────────────────────────────────────

    func testStartAcceptsCleanStartWithReading() {
        let r = CoolingCompute.validateCoolingStart(item: "Chili", startedAt: "2026-04-20T14:00:00Z", startReadingF: 180)
        XCTAssertTrue(r.ok)
    }

    func testStartAcceptsNoReading() {
        let r = CoolingCompute.validateCoolingStart(item: "Chili", startedAt: "2026-04-20T14:00:00Z", startReadingF: nil)
        XCTAssertTrue(r.ok)
    }

    func testStartRejectsEmptyItem() {
        let r = CoolingCompute.validateCoolingStart(item: "", startedAt: "2026-04-20T14:00:00Z", startReadingF: 180)
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "item", options: .caseInsensitive) != nil)
    }

    func testStartRejectsWhitespaceOnlyItem() {
        let r = CoolingCompute.validateCoolingStart(item: "   ", startedAt: "2026-04-20T14:00:00Z", startReadingF: 180)
        XCTAssertFalse(r.ok)
    }

    func testStartRejectsMalformedStartedAt() {
        let r = CoolingCompute.validateCoolingStart(item: "Chili", startedAt: "not a date", startReadingF: 180)
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "ISO", options: .caseInsensitive) != nil)
    }

    func testStartRejectsEmptyStartedAt() {
        let r = CoolingCompute.validateCoolingStart(item: "Chili", startedAt: "", startReadingF: 180)
        XCTAssertFalse(r.ok)
    }

    func testStartRejectsAbsurdReading() {
        let r = CoolingCompute.validateCoolingStart(item: "Chili", startedAt: "2026-04-20T14:00:00Z", startReadingF: 9999)
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "probe", options: .caseInsensitive) != nil
                      || r.reason?.range(of: "charts", options: .caseInsensitive) != nil)
    }

    func testStartRejectsNaNReading() {
        let r = CoolingCompute.validateCoolingStart(item: "Chili", startedAt: "2026-04-20T14:00:00Z", startReadingF: .nan)
        XCTAssertFalse(r.ok)
    }

    // ── classifyCoolingStage — stage 1 in progress ─────────────────────

    private let openStage1Started = "2026-04-20T14:00:00Z"
    // openStage2: stage 1 closed at +90min @ 68°F
    private let openStage2Stage1At = "2026-04-20T15:30:00Z"

    func testStage1InRangeWithin2hClosesStage1InProgress() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: nil, status: "in_progress",
            readingF: CoolingCompute.stage1CeilingF - 2,   // 68
            at: "2026-04-20T15:00:00Z")                    // +60min
        guard case let .decided(stage, status, breach, minutes) = r else { return XCTFail("expected decision") }
        XCTAssertEqual(stage, 1)
        XCTAssertEqual(status, .inProgress)
        XCTAssertNil(breach)
        XCTAssertEqual(minutes, 60)
    }

    func testStage1Exactly70ClosesStage1() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: nil, status: "in_progress",
            readingF: CoolingCompute.stage1CeilingF, at: "2026-04-20T15:00:00Z")
        guard case let .decided(stage, status, _, _) = r else { return XCTFail("expected decision") }
        XCTAssertEqual(stage, 1)
        XCTAssertEqual(status, .inProgress)
    }

    func testStage1_70point5NotCloseEnough() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: nil, status: "in_progress",
            readingF: 70.5, at: "2026-04-20T15:00:00Z")
        guard case let .decided(_, status, breach, _) = r else { return XCTFail("expected decision") }
        XCTAssertEqual(status, .inProgress)
        XCTAssertNil(breach)
    }

    func testStage1StillWarmPast2hBreaches() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: nil, status: "in_progress",
            readingF: 90, at: "2026-04-20T16:30:00Z")   // +150min
        guard case let .decided(_, status, breach, _) = r else { return XCTFail("expected decision") }
        XCTAssertEqual(status, .breach)
        XCTAssertEqual(breach, .stage1Over2h)
    }

    func testStage1ColdButLatePast2hStillBreaches() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: nil, status: "in_progress",
            readingF: 65, at: "2026-04-20T16:30:00Z")   // +150min
        guard case let .decided(_, status, breach, _) = r else { return XCTFail("expected decision") }
        XCTAssertEqual(status, .breach)
        XCTAssertEqual(breach, .stage1Over2h)
    }

    func testStage1Exactly120minNotYetBreach() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: nil, status: "in_progress",
            readingF: 70, at: "2026-04-20T16:00:00Z")   // +120min exactly
        guard case let .decided(_, status, breach, minutes) = r else { return XCTFail("expected decision") }
        XCTAssertEqual(minutes, Double(CoolingCompute.stage1MaxMinutes))
        XCTAssertEqual(status, .inProgress)
        XCTAssertNil(breach)
    }

    func testStage1_121minIsBreach() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: nil, status: "in_progress",
            readingF: 70, at: "2026-04-20T16:01:00Z")   // +121min
        guard case let .decided(_, status, breach, _) = r else { return XCTFail("expected decision") }
        XCTAssertEqual(status, .breach)
        XCTAssertEqual(breach, .stage1Over2h)
    }

    func testStage1NegativeElapsedIsValidationError() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: nil, status: "in_progress",
            readingF: 65, at: "2026-04-20T13:00:00Z")   // before started_at
        guard case .invalid = r else { return XCTFail("expected invalid") }
    }

    func testStage1BadReadingIsValidationError() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: nil, status: "in_progress",
            readingF: .nan, at: "2026-04-20T15:00:00Z")
        guard case .invalid = r else { return XCTFail("expected invalid") }
    }

    func testStage1NonISOTimestampRejected() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: nil, status: "in_progress",
            readingF: 65, at: "yesterday")
        guard case .invalid = r else { return XCTFail("expected invalid") }
    }

    // ── classifyCoolingStage — stage 2 in progress ─────────────────────

    func testStage2In41Within4hClosesOK() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: openStage2Stage1At, status: "in_progress",
            readingF: CoolingCompute.stage2CeilingF,   // 41
            at: "2026-04-20T19:00:00Z")                // stage1_at + 3h30m
        guard case let .decided(stage, status, breach, _) = r else { return XCTFail("expected decision") }
        XCTAssertEqual(stage, 2)
        XCTAssertEqual(status, .ok)
        XCTAssertNil(breach)
    }

    func testStage2_41point1DoesNotClose() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: openStage2Stage1At, status: "in_progress",
            readingF: 41.1, at: "2026-04-20T17:00:00Z")
        guard case let .decided(_, status, _, _) = r else { return XCTFail("expected decision") }
        XCTAssertEqual(status, .inProgress)
    }

    func testStage2StillWarmPast4hBreaches() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: openStage2Stage1At, status: "in_progress",
            readingF: 60, at: "2026-04-20T20:00:00Z")   // stage1_at + 4h30m
        guard case let .decided(_, status, breach, _) = r else { return XCTFail("expected decision") }
        XCTAssertEqual(status, .breach)
        XCTAssertEqual(breach, .stage2Over4h)
    }

    func testStage2ColdButLateBreaches() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: openStage2Stage1At, status: "in_progress",
            readingF: 38, at: "2026-04-20T20:00:00Z")
        guard case let .decided(_, status, breach, _) = r else { return XCTFail("expected decision") }
        XCTAssertEqual(status, .breach)
        XCTAssertEqual(breach, .stage2Over4h)
    }

    func testStage2Exactly240minNotYetBreach() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: openStage2Stage1At, status: "in_progress",
            readingF: 41, at: "2026-04-20T19:30:00Z")   // stage1_at + 4h exactly
        guard case let .decided(_, status, _, minutes) = r else { return XCTFail("expected decision") }
        XCTAssertEqual(minutes, Double(CoolingCompute.stage2MaxMinutes))
        XCTAssertEqual(status, .ok)
    }

    func testStage2ReadingBeforeStage1Rejected() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: openStage2Stage1At, status: "in_progress",
            readingF: 40, at: "2026-04-20T15:00:00Z")
        guard case .invalid = r else { return XCTFail("expected invalid") }
    }

    // ── classifyCoolingStage — already-closed rows ─────────────────────

    func testClosedBatchRejectsNewReading() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: openStage2Stage1At, status: "ok",
            readingF: 40, at: "2026-04-20T19:30:00Z")
        guard case let .invalid(reason) = r else { return XCTFail("expected invalid") }
        XCTAssertTrue(reason.range(of: "closed", options: .caseInsensitive) != nil)
    }

    func testBreachedBatchRejectsNewReading() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: openStage2Stage1At, status: "breach",
            readingF: 40, at: "2026-04-20T19:30:00Z")
        guard case .invalid = r else { return XCTFail("expected invalid") }
    }

    func testDiscardedBatchRejectsNewReading() {
        let r = CoolingCompute.classifyCoolingStage(
            startedAt: openStage1Started, stage1At: openStage2Stage1At, status: "discarded",
            readingF: 40, at: "2026-04-20T19:30:00Z")
        guard case .invalid = r else { return XCTFail("expected invalid") }
    }

    // ── scanOpenBatches ─────────────────────────────────────────────────

    private let scanNowMs = CoolingCompute.parseIsoMs("2026-04-20T16:00:00Z")!

    func testScanStage1Started1hAgoHas60minRemaining() {
        let rows = [CoolingScanRow(id: 1, item: "Chili", startedAt: "2026-04-20T15:00:00Z", stage1At: nil, status: "in_progress")]
        let out = CoolingCompute.scanOpenBatches(rows, nowMs: scanNowMs)
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].stage, 1)
        XCTAssertEqual(out[0].minutesRemaining, 60)
        XCTAssertFalse(out[0].breached)
    }

    func testScanStage1Past2hBreached() {
        let rows = [CoolingScanRow(id: 2, item: "Chili", startedAt: "2026-04-20T13:30:00Z", stage1At: nil, status: "in_progress")]
        let out = CoolingCompute.scanOpenBatches(rows, nowMs: scanNowMs)
        XCTAssertTrue(out[0].breached)
        XCTAssertLessThan(out[0].minutesRemaining, 0)
    }

    func testScanStage2ShowsStage2Budget() {
        let rows = [CoolingScanRow(id: 3, item: "Chili", startedAt: "2026-04-20T13:00:00Z", stage1At: "2026-04-20T14:00:00Z", status: "in_progress")]
        let out = CoolingCompute.scanOpenBatches(rows, nowMs: scanNowMs)
        XCTAssertEqual(out[0].stage, 2)
        XCTAssertEqual(out[0].minutesRemaining, Double(CoolingCompute.stage2MaxMinutes - 120))
        XCTAssertFalse(out[0].breached)
    }

    func testScanSkipsRowsNotInProgress() {
        let rows = [
            CoolingScanRow(id: 1, item: "Chili", startedAt: "2026-04-20T15:00:00Z", stage1At: nil, status: "ok"),
            CoolingScanRow(id: 2, item: "Rice", startedAt: "2026-04-20T15:00:00Z", stage1At: nil, status: "breach"),
            CoolingScanRow(id: 3, item: "Beans", startedAt: "2026-04-20T15:00:00Z", stage1At: nil, status: "discarded"),
        ]
        XCTAssertEqual(CoolingCompute.scanOpenBatches(rows, nowMs: scanNowMs).count, 0)
    }

    func testScanSkipsUnparseableStartedAt() {
        let rows = [CoolingScanRow(id: 1, item: "Chili", startedAt: "junk", stage1At: nil, status: "in_progress")]
        XCTAssertEqual(CoolingCompute.scanOpenBatches(rows, nowMs: scanNowMs).count, 0)
    }

    func testScanEmptyInputReturnsEmpty() {
        let empty: [CoolingScanRow] = []
        XCTAssertEqual(CoolingCompute.scanOpenBatches(empty, nowMs: scanNowMs).count, 0)
    }

    // ── threshold constants pin ─────────────────────────────────────────

    func testThresholdConstants() {
        XCTAssertEqual(CoolingCompute.stage1CeilingF, 70)
        XCTAssertEqual(CoolingCompute.stage2CeilingF, 41)
        XCTAssertEqual(CoolingCompute.stage1MaxMinutes, 120)
        XCTAssertEqual(CoolingCompute.stage2MaxMinutes, 240)
        XCTAssertEqual(CoolingCompute.totalMaxMinutes, 360)
    }
}
