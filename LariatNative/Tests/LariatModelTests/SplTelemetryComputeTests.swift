import XCTest
@testable import LariatModel

// Value-parity port of `tests/js/test-spl-telemetry-rules.mjs`. JS-coercion
// cases ("malformed entries", string db_value) have no typed analog — the
// native input is `[SplReadingRow]` with `Double` values by construction.
final class SplTelemetryComputeTests: XCTestCase {

    private func reading(_ db: Double, _ takenAt: String = "2026-05-13T20:00:00Z") -> SplReadingRow {
        SplReadingRow(
            id: 0, showId: 1, locationId: "default", sceneId: nil,
            dbValue: db, takenAt: takenAt, takenByCookId: nil, notes: nil
        )
    }

    // ── summarizeSpl ───────────────────────────────────────────────────

    func testZeroedSummaryOnEmptyInput() {
        let s = SplTelemetryCompute.summarizeSpl([], limit: 100)
        XCTAssertEqual(s.count, 0)
        XCTAssertNil(s.latest)
        XCTAssertNil(s.peak)
        XCTAssertNil(s.avgLastN)
        XCTAssertEqual(s.overLimitCount, 0)
        XCTAssertNil(s.since)
        XCTAssertEqual(s.limitDb, 100)
    }

    func testHandlesNilInput() {
        XCTAssertEqual(SplTelemetryCompute.summarizeSpl(nil, limit: nil).count, 0)
    }

    func testRollsUpCountLatestPeakAvgOverLimit() {
        let s = SplTelemetryCompute.summarizeSpl(
            [reading(90, "t1"), reading(102, "t2"), reading(95, "t3"), reading(110, "t4")],
            limit: 100
        )
        XCTAssertEqual(s.count, 4)
        XCTAssertEqual(s.latest, 110)
        XCTAssertEqual(s.peak, 110)
        XCTAssertEqual(s.avgLastN, 99.3)   // (90+102+95+110)/4 = 99.25 → 99.3
        XCTAssertEqual(s.overLimitCount, 2) // 102 and 110
        XCTAssertEqual(s.since, "t1")
    }

    func testOverLimitZeroWhenLimitNilOrInvalid() {
        let s = SplTelemetryCompute.summarizeSpl([reading(120), reading(130)], limit: nil)
        XCTAssertEqual(s.overLimitCount, 0)
        XCTAssertNil(s.limitDb)
        let z = SplTelemetryCompute.summarizeSpl([reading(120)], limit: 0)
        XCTAssertEqual(z.overLimitCount, 0)
        XCTAssertNil(z.limitDb)
    }

    // ── sparklinePath ──────────────────────────────────────────────────

    func testEmptyDAndSentinelPeakIdxOnEmptyInput() {
        let p = SplTelemetryCompute.sparklinePath([], limit: 100)
        XCTAssertEqual(p.d, "")
        XCTAssertEqual(p.peakIdx, -1)
        XCTAssertNil(p.thresholdY)
    }

    func testBuildsMLPathForMultipleReadings() {
        let p = SplTelemetryCompute.sparklinePath(
            [reading(80), reading(90), reading(100)], limit: nil,
            opts: SparklineOpts(width: 100, height: 40, padding: 0)
        )
        // 3 readings → "M..,..L..,..L..,.."
        XCTAssertNotNil(p.d.range(
            of: #"^M[\d.]+,[\d.]+L[\d.]+,[\d.]+L[\d.]+,[\d.]+$"#,
            options: .regularExpression
        ))
        XCTAssertEqual(p.peakIdx, 2)
    }

    func testSingleReadingNoDivideByZero() {
        let p = SplTelemetryCompute.sparklinePath(
            [reading(95)], limit: 100,
            opts: SparklineOpts(width: 160, height: 40, padding: 2)
        )
        XCTAssertEqual(p.peakIdx, 0)
        XCTAssertNotNil(p.d.range(of: #"^M[\d.]+,[\d.]+$"#, options: .regularExpression))
    }

    func testAllEqualReadingsSynthesize4dBWindow() {
        let p = SplTelemetryCompute.sparklinePath(
            [reading(100), reading(100), reading(100)], limit: 100,
            opts: SparklineOpts(width: 100, height: 40, padding: 0)
        )
        XCTAssertEqual(p.peakIdx, 0)
        XCTAssertEqual(p.yMax - p.yMin, 4)
        XCTAssertNotNil(p.thresholdY)
    }

    func testThresholdYNilWhenLimitOutsideYRange() {
        // Data 80–90 ⇒ yMin ~78, yMax ~92; limit 200 is outside.
        let p = SplTelemetryCompute.sparklinePath([reading(80), reading(85), reading(90)], limit: 200)
        XCTAssertNil(p.thresholdY)
    }

    func testPeakIdxAtMaxPosition() {
        let p = SplTelemetryCompute.sparklinePath([reading(80), reading(120), reading(95)], limit: nil)
        XCTAssertEqual(p.peakIdx, 1)
    }

    // ── splThresholdStatus ─────────────────────────────────────────────

    func testUnsetWhenValueNotFinite() {
        XCTAssertEqual(SplTelemetryCompute.splThresholdStatus(nil, limit: 100), .unset)
        XCTAssertEqual(SplTelemetryCompute.splThresholdStatus(.nan, limit: 100), .unset)
    }

    func testGreenWhenNoOrZeroLimit() {
        XCTAssertEqual(SplTelemetryCompute.splThresholdStatus(120, limit: nil), .green)
        XCTAssertEqual(SplTelemetryCompute.splThresholdStatus(120, limit: 0), .green)
    }

    func testGreenBelow90PctOfLimit() {
        XCTAssertEqual(SplTelemetryCompute.splThresholdStatus(89.999, limit: 100), .green)
    }

    func testAmberInside90To100Band() {
        XCTAssertEqual(SplTelemetryCompute.splThresholdStatus(90, limit: 100), .amber)
        XCTAssertEqual(SplTelemetryCompute.splThresholdStatus(99.9, limit: 100), .amber)
        XCTAssertEqual(SplTelemetryCompute.splThresholdStatus(100, limit: 100), .amber)
    }

    func testRedAboveLimit() {
        XCTAssertEqual(SplTelemetryCompute.splThresholdStatus(100.1, limit: 100), .red)
        XCTAssertEqual(SplTelemetryCompute.splThresholdStatus(150, limit: 100), .red)
    }

    // ── completeness + records (from lib code; stage web test file is empty) ──

    private func scene(_ name: String, spl: Double? = nil) -> SoundSceneRow {
        SoundSceneRow(
            id: 1, showId: 1, locationId: "default", sceneName: name,
            plot: .empty, splLimitDb: spl, notes: nil, savedByCookId: nil,
            savedAt: "2026-05-13T20:00:00Z"
        )
    }

    func testSoundCompletenessScoresZeroForEmptyList() {
        XCTAssertEqual(SoundCompleteness.from(scenes: []).score, 0)
    }

    func testSoundCompletenessOneThirdWithOneSceneNoSpl() {
        let c = SoundCompleteness.from(scenes: [scene("a")])
        XCTAssertTrue(c.hasAnyScene)
        XCTAssertEqual(c.sceneCount, 1)
        XCTAssertFalse(c.hasSplLimit)
        XCTAssertEqual(c.score, 1.0 / 3.0, accuracy: 1e-9)
    }

    func testSoundCompletenessFullWithTwoScenesAndSpl() {
        XCTAssertEqual(SoundCompleteness.from(scenes: [scene("a", spl: 95), scene("b")]).score, 1)
    }

    func testSoundPlotParseFallsBackToEmptyOnCorruptJson() {
        let p = SoundPlot.parse("{not valid json")
        XCTAssertEqual(p.channels, [])
        XCTAssertEqual(p.monitors, [])
    }

    func testSoundPlotRoundTrips() {
        let plot = SoundPlot(
            channels: [SoundChannelEntry(id: "kick", label: "Kick", sourceType: "mic")],
            monitors: [SoundMonitorMix(id: "M1", type: "wedge", channels: ["kick"])]
        )
        let round = SoundPlot.parse(plot.toJSON())
        XCTAssertEqual(round, plot)
    }

    func testStageCompletenessZeroWithoutSetup() {
        let c = StageCompleteness.from(setup: nil)
        XCTAssertFalse(c.hasSetup)
        XCTAssertEqual(c.score, 0)
    }

    func testStageCompletenessCountsFourFlags() {
        let setup = StageSetupRow(
            id: 1, showId: 1, locationId: "default",
            roomConfig: "cabaret_160",
            runOfShow: [RunOfShowEntry(t: "5:30 PM", what: "Doors", who: "Door")],
            hospitalityRiderJson: #"{"beverage":["water"]}"#,
            techRiderJson: "{}",
            notes: nil, createdAt: "", updatedAt: ""
        )
        let c = StageCompleteness.from(setup: setup)
        XCTAssertTrue(c.hasSetup)
        XCTAssertTrue(c.hasRoomConfig)
        XCTAssertTrue(c.hasRunOfShow)
        XCTAssertTrue(c.hasHospitalityRider)
        XCTAssertFalse(c.hasTechRider)
        XCTAssertEqual(c.score, 0.75)
    }

    func testKnownRoomConfigsPortedVerbatim() {
        XCTAssertEqual(StageRoomCatalog.knownRoomConfigs.map(\.key), [
            "listening_room_220", "cabaret_160", "half_house_180",
            "dance_floor_240", "private_dining_60", "open_jam_140",
        ])
        XCTAssertEqual(StageRoomCatalog.knownRoomConfigs.map(\.capacity),
                       [220, 160, 180, 240, 60, 140])
        let cabaret = StageRoomCatalog.config(for: "cabaret_160")
        XCTAssertEqual(cabaret?.changeoverStaff, 5)
        XCTAssertEqual(cabaret?.changeoverMinutes, 40)
        XCTAssertEqual(cabaret?.bestFor, "Jazz · soul · dinner shows")
        XCTAssertFalse(StageRoomCatalog.isKnownRoomConfig("stadium_50000"))
    }

    func testRunOfShowStageShapeParsesAndSkipsNonObjects() {
        let raw = #"[{"t":"5:30 PM","what":"Doors","who":"Door · Box · Bar"},"stray",42]"#
        let out = RunOfShowEntry.parseList(raw)
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].what, "Doors")
        XCTAssertEqual(RunOfShowEntry.parseList("{bad"), [])
        XCTAssertEqual(RunOfShowEntry.parseList(nil), [])
    }
}
