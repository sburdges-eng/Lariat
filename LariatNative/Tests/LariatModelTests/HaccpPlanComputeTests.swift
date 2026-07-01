import XCTest
@testable import LariatModel

// Value-parity tests for HaccpPlanCompute — the pure port of `buildHaccpPlan`
// in lib/haccpPlan.ts. No web test file exists; known inputs/outputs are
// derived directly from the JS aggregation logic + the rule-module citations
// so the Swift assembly cannot drift.

final class HaccpPlanComputeTests: XCTestCase {

    // Helper: a bundle with all sections empty (defaults path).
    private func emptyBundle(location: String = "default") -> HaccpPlanBundle {
        HaccpPlanBundle(
            locationId: location,
            tempCounts: [],
            coolingRow: nil,
            moduleCounts: [:],
            sdsActive: 0,
            tempLogCorrective: [],
            lineCheckCorrective: [],
            calibrationWindow: [],
            allCalibrations: []
        )
    }

    // ── Window date math (isoMinusDays) ────────────────────────────────────

    func testWindowStartIs30DaysBefore() {
        // 2026-07-05 minus 30 days = 2026-06-05 (UTC date arithmetic).
        XCTAssertEqual(HaccpPlanCompute.isoMinusDays("2026-07-05", 30), "2026-06-05")
    }

    func testWindowStartCrossesMonthBoundary() {
        // 2026-03-15 minus 30 days = 2026-02-13.
        XCTAssertEqual(HaccpPlanCompute.isoMinusDays("2026-03-15", 30), "2026-02-13")
    }

    func testPlanCarriesWindowFields() {
        let plan = HaccpPlanCompute.build(bundle: emptyBundle(), today: "2026-07-05", generatedAt: "2026-07-05T12:00:00.000Z")
        XCTAssertEqual(plan.planDate, "2026-07-05")
        XCTAssertEqual(plan.windowStart, "2026-06-05")
        XCTAssertEqual(plan.windowDays, 30)
        XCTAssertEqual(plan.generatedAt, "2026-07-05T12:00:00.000Z")
        XCTAssertEqual(plan.locationId, "default")
    }

    // ── Assembled citation strings ─────────────────────────────────────────

    func testCoolingCitationMatchesWebWording() {
        XCTAssertEqual(
            HaccpPlanCompute.coolingCitation,
            "FDA §3-501.14 — two-stage cooling: 135→70°F within 2 h, then to 41°F within 4 h more"
        )
    }

    func testCalibrationCitationMatchesRuleModule() {
        XCTAssertEqual(
            HaccpPlanCompute.calibrationCitation,
            "FDA §4-502.11 — temp measuring device accurate within ±2°F"
        )
    }

    func testTphcCitationMatchesWebWording() {
        XCTAssertEqual(
            HaccpPlanCompute.tphcCitation,
            "FDA §3-501.19 — time as a public health control: hot 4 h / cold 6 h caps"
        )
    }

    func testCorrectiveActionCitation() {
        XCTAssertEqual(HaccpPlanCompute.correctiveActionCitation, "FDA 2022 §8-405.11")
    }

    // ── CCP inventory ──────────────────────────────────────────────────────

    func testCcpsCoverAllRegistryPoints() {
        let plan = HaccpPlanCompute.build(bundle: emptyBundle(), today: "2026-07-05", generatedAt: "gen")
        // One CCP per TempLogCompute point (13 registered points).
        XCTAssertEqual(plan.ccps.count, TempLogCompute.points.count)
        XCTAssertEqual(plan.ccps.count, 13)
        // First point mirrors receiving_cold with its citation + null counts.
        let first = plan.ccps[0]
        XCTAssertEqual(first.pointId, "receiving_cold")
        XCTAssertEqual(first.ccpId, "CCP-1")
        XCTAssertEqual(first.requiredMaxF, 41)
        XCTAssertNil(first.requiredMinF)
        XCTAssertEqual(first.citation, "FDA §3-202.11 — refrigerated PHF/TCS received at ≤ 41°F")
        XCTAssertEqual(first.logs30d, 0)
        XCTAssertEqual(first.corrective30d, 0)
    }

    func testCcpCountsMergedByPointId() {
        var bundle = emptyBundle()
        bundle = HaccpPlanBundle(
            locationId: bundle.locationId,
            tempCounts: [
                HaccpTempCountRow.make(pointId: "walk_in_cooler", logs: 12, corrective: 3),
                HaccpTempCountRow.make(pointId: "hot_hold", logs: 5, corrective: 0),
            ],
            coolingRow: nil, moduleCounts: [:], sdsActive: 0,
            tempLogCorrective: [], lineCheckCorrective: [],
            calibrationWindow: [], allCalibrations: []
        )
        let plan = HaccpPlanCompute.build(bundle: bundle, today: "2026-07-05", generatedAt: "gen")
        let walkIn = plan.ccps.first { $0.pointId == "walk_in_cooler" }
        XCTAssertEqual(walkIn?.logs30d, 12)
        XCTAssertEqual(walkIn?.corrective30d, 3)
        let hotHold = plan.ccps.first { $0.pointId == "hot_hold" }
        XCTAssertEqual(hotHold?.logs30d, 5)
        XCTAssertEqual(hotHold?.corrective30d, 0)
        // A point with no count row stays at zero.
        let freezer = plan.ccps.first { $0.pointId == "freezer" }
        XCTAssertEqual(freezer?.logs30d, 0)
    }

    // ── Cooling (CCP-8) summary ────────────────────────────────────────────

    func testCoolingSummaryDefaultsToZeroWhenNoRow() {
        let plan = HaccpPlanCompute.build(bundle: emptyBundle(), today: "2026-07-05", generatedAt: "gen")
        XCTAssertEqual(plan.cooling.ccpId, "CCP-8")
        XCTAssertEqual(plan.cooling.citation, HaccpPlanCompute.coolingCitation)
        XCTAssertEqual(plan.cooling.batches30d, 0)
        XCTAssertEqual(plan.cooling.breaches30d, 0)
        XCTAssertEqual(plan.cooling.openNow, 0)
    }

    func testCoolingSummaryReadsRowWithNullBreaches() {
        // SUM(...) is NULL when no matching rows — mirror `Number(x) || 0`.
        let bundle = HaccpPlanBundle(
            locationId: "default",
            tempCounts: [],
            coolingRow: HaccpCoolingRow.make(batches: 8, breaches: nil, openNow: 2),
            moduleCounts: [:], sdsActive: 0,
            tempLogCorrective: [], lineCheckCorrective: [],
            calibrationWindow: [], allCalibrations: []
        )
        let plan = HaccpPlanCompute.build(bundle: bundle, today: "2026-07-05", generatedAt: "gen")
        XCTAssertEqual(plan.cooling.batches30d, 8)
        XCTAssertEqual(plan.cooling.breaches30d, 0)
        XCTAssertEqual(plan.cooling.openNow, 2)
    }

    // ── Rule-module inventory ──────────────────────────────────────────────

    func testRuleModulesOrderAndActiveFlags() {
        let bundle = HaccpPlanBundle(
            locationId: "default",
            tempCounts: [],
            coolingRow: nil,
            moduleCounts: [
                "receiving": 4,
                "date_marking": 0,
                "tphc": 2,
                "sanitizer": 0,
                "cleaning": 9,
                "sick_worker": 1,
                "pest_control": 0,
            ],
            sdsActive: 7,
            tempLogCorrective: [], lineCheckCorrective: [],
            calibrationWindow: [], allCalibrations: []
        )
        let plan = HaccpPlanCompute.build(bundle: bundle, today: "2026-07-05", generatedAt: "gen")
        let ids = plan.ruleModules.map(\.id)
        XCTAssertEqual(ids, ["receiving", "date_marking", "tphc", "sanitizer", "cleaning", "sick_worker", "pest_control", "sds"])

        let byId = Dictionary(uniqueKeysWithValues: plan.ruleModules.map { ($0.id, $0) })
        XCTAssertEqual(byId["receiving"]?.records, 4)
        XCTAssertEqual(byId["receiving"]?.active, true)
        XCTAssertEqual(byId["receiving"]?.evidenceLabel, "entries in last 30 days")
        XCTAssertEqual(byId["date_marking"]?.records, 0)
        XCTAssertEqual(byId["date_marking"]?.active, false)
        XCTAssertEqual(byId["date_marking"]?.evidenceLabel, "batches marked in last 30 days")
        XCTAssertEqual(byId["cleaning"]?.evidenceLabel, "completions in last 30 days")
        XCTAssertEqual(byId["sick_worker"]?.evidenceLabel, "reports in last 30 days")
        // SDS counts active sheets, not window entries.
        XCTAssertEqual(byId["sds"]?.records, 7)
        XCTAssertEqual(byId["sds"]?.active, true)
        XCTAssertEqual(byId["sds"]?.evidenceLabel, "active sheets on file")
        XCTAssertEqual(byId["tphc"]?.citation, HaccpPlanCompute.tphcCitation)
    }

    // ── Corrective-action merge + sort ─────────────────────────────────────

    func testCorrectiveMergeSortsNewestFirstAcrossSources() {
        let temp = [
            HaccpTempLogCorrectiveRow.make(id: 10, shiftDate: "2026-07-01", pointId: "walk_in_cooler",
                                           correctiveAction: "Moved to reach-in", cookId: "alice",
                                           createdAt: "2026-07-01 09:00:00"),
        ]
        let line = [
            HaccpLineCheckCorrectiveRow.make(id: 20, shiftDate: "2026-07-02", stationId: "grill",
                                             item: "Ribeye", note: "Refired", cookId: "bob",
                                             createdAt: "2026-07-02 18:30:00"),
        ]
        let out = HaccpPlanCompute.mergeCorrectiveActions(tempLogRows: temp, lineCheckRows: line)
        XCTAssertEqual(out.count, 2)
        // Newest created_at first: the line-check row (2026-07-02) leads.
        XCTAssertEqual(out[0].source, .lineCheck)
        XCTAssertEqual(out[0].subject, "grill: Ribeye")
        XCTAssertEqual(out[0].note, "Refired")
        XCTAssertNil(out[1].stationId)
        XCTAssertEqual(out[1].source, .tempLog)
        // temp_log subject is the point_id, station_id null.
        XCTAssertEqual(out[1].subject, "walk_in_cooler")
        XCTAssertEqual(out[1].stationId, nil)
    }

    func testCorrectiveTieBreakBySourceThenEntryIdDesc() {
        // Same created_at → source ASC (line_check < temp_log), then entry_id DESC.
        let temp = [
            HaccpTempLogCorrectiveRow.make(id: 1, shiftDate: "2026-07-01", pointId: "freezer",
                                           correctiveAction: "note-a", cookId: nil, createdAt: "2026-07-01 10:00:00"),
            HaccpTempLogCorrectiveRow.make(id: 2, shiftDate: "2026-07-01", pointId: "freezer",
                                           correctiveAction: "note-b", cookId: nil, createdAt: "2026-07-01 10:00:00"),
        ]
        let line = [
            HaccpLineCheckCorrectiveRow.make(id: 5, shiftDate: "2026-07-01", stationId: "saute",
                                             item: "X", note: "line-note", cookId: nil, createdAt: "2026-07-01 10:00:00"),
        ]
        let out = HaccpPlanCompute.mergeCorrectiveActions(tempLogRows: temp, lineCheckRows: line)
        // line_check first (source ASC), then temp_log id=2 before id=1 (entry_id DESC).
        XCTAssertEqual(out.map { "\($0.source.rawValue)-\($0.entryId)" }, ["line_check-5", "temp_log-2", "temp_log-1"])
    }

    func testPlanCorrectiveSectionCountMatchesEntries() {
        let bundle = HaccpPlanBundle(
            locationId: "default", tempCounts: [], coolingRow: nil, moduleCounts: [:], sdsActive: 0,
            tempLogCorrective: [
                HaccpTempLogCorrectiveRow.make(id: 1, shiftDate: "2026-07-01", pointId: "hot_hold",
                                               correctiveAction: "reheated", cookId: nil, createdAt: "2026-07-01 10:00:00"),
            ],
            lineCheckCorrective: [],
            calibrationWindow: [], allCalibrations: []
        )
        let plan = HaccpPlanCompute.build(bundle: bundle, today: "2026-07-05", generatedAt: "gen")
        XCTAssertEqual(plan.correctiveActions.count, 1)
        XCTAssertEqual(plan.correctiveActions.entries.count, 1)
        XCTAssertEqual(plan.correctiveActions.citation, "FDA 2022 §8-405.11")
    }

    // ── Calibration section: records + probe classification ────────────────

    func testCalibrationRecordsMapPassedFlag() {
        let bundle = HaccpPlanBundle(
            locationId: "default", tempCounts: [], coolingRow: nil, moduleCounts: [:], sdsActive: 0,
            tempLogCorrective: [], lineCheckCorrective: [],
            calibrationWindow: [
                HaccpCalibrationWindowRow.make(id: 1, thermometerId: "THERM-001", method: "ice_point",
                                               beforeReadingF: 32.2, afterReadingF: nil, passed: 1,
                                               actionTaken: nil, cookId: "alice", calibratedAt: "2026-07-01 08:00:00"),
                HaccpCalibrationWindowRow.make(id: 2, thermometerId: "THERM-002", method: "boiling_point",
                                               beforeReadingF: 205.0, afterReadingF: nil, passed: 0,
                                               actionTaken: "recalibrated", cookId: "bob", calibratedAt: "2026-07-02 08:00:00"),
            ],
            allCalibrations: []
        )
        let plan = HaccpPlanCompute.build(bundle: bundle, today: "2026-07-05", generatedAt: "gen")
        XCTAssertEqual(plan.calibrations.frequencyDaysDefault, 30)
        XCTAssertEqual(plan.calibrations.citation, HaccpPlanCompute.calibrationCitation)
        XCTAssertEqual(plan.calibrations.records.count, 2)
        XCTAssertEqual(plan.calibrations.records[0].passed, true)
        XCTAssertEqual(plan.calibrations.records[1].passed, false)
        XCTAssertEqual(plan.calibrations.records[1].actionTaken, "recalibrated")
    }

    func testProbeClassificationStatuses() {
        // now = 2026-07-05T23:59:59Z. freq default 30 days.
        //   THERM-OK      : passed, calibrated 5 days ago  → ok (25 days remaining)
        //   THERM-DUE     : passed, calibrated 25 days ago → due_soon (5 days remaining <= 7)
        //   THERM-OVERDUE : passed, calibrated 40 days ago → overdue
        //   THERM-FAILED  : most recent reading fails      → failed
        let rows = [
            HaccpProbeCalibrationRow(thermometerId: "THERM-OK", method: "ice_point",
                                     beforeReadingF: 32.0, passed: 1, calibratedAt: "2026-06-30 08:00:00", frequencyDays: nil),
            HaccpProbeCalibrationRow(thermometerId: "THERM-DUE", method: "ice_point",
                                     beforeReadingF: 32.0, passed: 1, calibratedAt: "2026-06-10 08:00:00", frequencyDays: nil),
            HaccpProbeCalibrationRow(thermometerId: "THERM-OVERDUE", method: "ice_point",
                                     beforeReadingF: 32.0, passed: 1, calibratedAt: "2026-05-26 08:00:00", frequencyDays: nil),
            // failed: newest row is a fail even though an older pass exists.
            HaccpProbeCalibrationRow(thermometerId: "THERM-FAILED", method: "boiling_point",
                                     beforeReadingF: 190.0, passed: 0, calibratedAt: "2026-07-04 08:00:00", frequencyDays: nil),
            HaccpProbeCalibrationRow(thermometerId: "THERM-FAILED", method: "ice_point",
                                     beforeReadingF: 32.0, passed: 1, calibratedAt: "2026-07-01 08:00:00", frequencyDays: nil),
        ]
        let probes = HaccpPlanCompute.classifyProbes(rows, nowISO: "2026-07-05T23:59:59Z")
        let byId = Dictionary(uniqueKeysWithValues: probes.map { ($0.thermometerId, $0) })
        XCTAssertEqual(byId["THERM-OK"]?.status, .ok)
        XCTAssertEqual(byId["THERM-DUE"]?.status, .dueSoon)
        XCTAssertEqual(byId["THERM-OVERDUE"]?.status, .overdue)
        XCTAssertEqual(byId["THERM-FAILED"]?.status, .failed)
        // failed probe: newest fail row drives it; total counts both rows.
        XCTAssertEqual(byId["THERM-FAILED"]?.total, 2)
        XCTAssertEqual(byId["THERM-FAILED"]?.lastPassed, false)
    }

    func testProbeStableSortOrder() {
        // Sort precedence: failed → overdue → due_soon → unknown → ok.
        let rows = [
            HaccpProbeCalibrationRow(thermometerId: "Z-OK", method: "ice_point",
                                     beforeReadingF: 32.0, passed: 1, calibratedAt: "2026-06-30 08:00:00", frequencyDays: nil),
            HaccpProbeCalibrationRow(thermometerId: "A-FAIL", method: "ice_point",
                                     beforeReadingF: 40.0, passed: 0, calibratedAt: "2026-07-04 08:00:00", frequencyDays: nil),
            HaccpProbeCalibrationRow(thermometerId: "M-OVERDUE", method: "ice_point",
                                     beforeReadingF: 32.0, passed: 1, calibratedAt: "2026-05-01 08:00:00", frequencyDays: nil),
        ]
        let probes = HaccpPlanCompute.classifyProbes(rows, nowISO: "2026-07-05T23:59:59Z")
        XCTAssertEqual(probes.map(\.thermometerId), ["A-FAIL", "M-OVERDUE", "Z-OK"])
    }

    func testProbeFrequencyOverrideApplies() {
        // 14-day override: calibrated 20 days ago → overdue (not ok under 30-day default).
        let rows = [
            HaccpProbeCalibrationRow(thermometerId: "THERM-FREQ", method: "ice_point",
                                     beforeReadingF: 32.0, passed: 1, calibratedAt: "2026-06-15 08:00:00", frequencyDays: 14),
        ]
        let probes = HaccpPlanCompute.classifyProbes(rows, nowISO: "2026-07-05T23:59:59Z")
        XCTAssertEqual(probes.first?.status, .overdue)
        XCTAssertEqual(probes.first?.frequencyDays, 14)
    }

    func testEmptyPlanHasZeroCorrectiveAndProbes() {
        let plan = HaccpPlanCompute.build(bundle: emptyBundle(), today: "2026-07-05", generatedAt: "gen")
        XCTAssertTrue(plan.correctiveActions.entries.isEmpty)
        XCTAssertEqual(plan.correctiveActions.count, 0)
        XCTAssertTrue(plan.calibrations.records.isEmpty)
        XCTAssertTrue(plan.calibrations.probes.isEmpty)
        // All 8 rule modules present but inactive.
        XCTAssertEqual(plan.ruleModules.count, 8)
        XCTAssertTrue(plan.ruleModules.allSatisfy { !$0.active })
    }
}

// MARK: - Test row factory helpers (direct public inits — no GRDB, no I/O)

private extension HaccpTempCountRow {
    static func make(pointId: String, logs: Int, corrective: Int) -> HaccpTempCountRow {
        HaccpTempCountRow(pointId: pointId, logs: logs, corrective: corrective)
    }
}

private extension HaccpCoolingRow {
    static func make(batches: Int, breaches: Int?, openNow: Int?) -> HaccpCoolingRow {
        HaccpCoolingRow(batches: batches, breaches: breaches, openNow: openNow)
    }
}

private extension HaccpTempLogCorrectiveRow {
    static func make(id: Int64, shiftDate: String, pointId: String, correctiveAction: String, cookId: String?, createdAt: String) -> HaccpTempLogCorrectiveRow {
        HaccpTempLogCorrectiveRow(id: id, shiftDate: shiftDate, pointId: pointId, correctiveAction: correctiveAction, cookId: cookId, createdAt: createdAt)
    }
}

private extension HaccpLineCheckCorrectiveRow {
    static func make(id: Int64, shiftDate: String, stationId: String, item: String, note: String, cookId: String?, createdAt: String) -> HaccpLineCheckCorrectiveRow {
        HaccpLineCheckCorrectiveRow(id: id, shiftDate: shiftDate, stationId: stationId, item: item, note: note, cookId: cookId, createdAt: createdAt)
    }
}

private extension HaccpCalibrationWindowRow {
    static func make(id: Int64, thermometerId: String, method: String, beforeReadingF: Double?, afterReadingF: Double?, passed: Int, actionTaken: String?, cookId: String?, calibratedAt: String) -> HaccpCalibrationWindowRow {
        HaccpCalibrationWindowRow(id: id, thermometerId: thermometerId, method: method, beforeReadingF: beforeReadingF, afterReadingF: afterReadingF, passed: passed, actionTaken: actionTaken, cookId: cookId, calibratedAt: calibratedAt)
    }
}
