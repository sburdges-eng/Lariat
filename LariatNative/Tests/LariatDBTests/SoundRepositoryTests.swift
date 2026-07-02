import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of `tests/js/test-sound-repo.mjs` (scenes CRUD + SPL
// telemetry + file-stream audit) plus the validation cases of
// `tests/js/test-sound-spl-api.mjs`. The JSONL audit line is written INSIDE
// the write transaction — parity with `logAuditAction` inside
// `db.transaction` in `lib/soundRepo.ts`.
final class SoundRepositoryTests: XCTestCase {

    private func makeFixture() throws -> (ShowsFixture, SoundRepository) {
        let fx = try ShowsFixture.make()
        try fx.insertShow(id: 1, band: "Test Band", date: "2026-05-01", sourceRow: 1)
        try fx.insertShow(id: 2, locationId: "satellite", band: "Test Band 2", date: "2026-05-02", sourceRow: 2)
        let repo = SoundRepository(
            readDB: fx.readDB, writeDB: fx.writeDB,
            locationId: "default", auditLogger: fx.auditLogger
        )
        return (fx, repo)
    }

    private func satelliteRepo(_ fx: ShowsFixture) -> SoundRepository {
        SoundRepository(readDB: fx.readDB, writeDB: fx.writeDB,
                        locationId: "satellite", auditLogger: fx.auditLogger)
    }

    private func samplePlot() -> SoundPlot {
        SoundPlot(
            channels: [
                SoundChannelEntry(id: "kick", label: "Kick", sourceType: "mic"),
                SoundChannelEntry(id: "vox-ld", label: "Lead vocal", sourceType: "mic"),
            ],
            monitors: [SoundMonitorMix(id: "M1", type: "wedge", channels: ["kick", "vox-ld"])]
        )
    }

    // ── listScenes ─────────────────────────────────────────────────────

    func testListEmptyWhenNoScenes() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let scenes = try await repo.listScenes(showId: 1)
        XCTAssertEqual(scenes, [])
    }

    func testListNewestFirstWithPlotRoundTrip() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.createScene(.init(showId: 1, sceneName: "soundcheck", plot: samplePlot()))
        try repo.createScene(.init(showId: 1, sceneName: "set 1", plot: samplePlot()))
        let list = try await repo.listScenes(showId: 1)
        XCTAssertEqual(list.count, 2)
        XCTAssertEqual(list[0].sceneName, "set 1")
        XCTAssertEqual(list[0].plot.channels.count, 2)
        XCTAssertEqual(list[1].sceneName, "soundcheck")
    }

    func testListRespectsLocationScoping() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.createScene(.init(showId: 1, sceneName: "main", plot: samplePlot()))
        try satelliteRepo(fx).createScene(.init(showId: 2, sceneName: "sat", plot: samplePlot()))
        let defaultScenes = try await repo.listScenes(showId: 1)
        let satScenes = try await satelliteRepo(fx).listScenes(showId: 2)
        let crossed = try await satelliteRepo(fx).listScenes(showId: 1)
        XCTAssertEqual(defaultScenes.count, 1)
        XCTAssertEqual(satScenes.count, 1)
        XCTAssertEqual(crossed.count, 0)
    }

    // ── latestScene ────────────────────────────────────────────────────

    func testLatestNilWhenNoScenes() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let latest = try await repo.latestScene(showId: 1)
        XCTAssertNil(latest)
    }

    func testLatestReturnsMostRecentlySaved() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.createScene(.init(showId: 1, sceneName: "soundcheck", plot: samplePlot()))
        try repo.createScene(.init(showId: 1, sceneName: "set 1", plot: samplePlot()))
        let latest = try await repo.latestScene(showId: 1)
        XCTAssertEqual(latest?.sceneName, "set 1")
    }

    func testLatestNoCrossLocationBleed() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.createScene(.init(showId: 1, sceneName: "default-only", plot: samplePlot()))
        try satelliteRepo(fx).createScene(.init(showId: 2, sceneName: "satellite-only", plot: samplePlot()))
        let a = try await repo.latestScene(showId: 1)
        let b = try await satelliteRepo(fx).latestScene(showId: 2)
        let c = try await satelliteRepo(fx).latestScene(showId: 1)
        let d = try await repo.latestScene(showId: 2)
        XCTAssertEqual(a?.sceneName, "default-only")
        XCTAssertEqual(b?.sceneName, "satellite-only")
        XCTAssertNil(c)
        XCTAssertNil(d)
    }

    func testLatestFallsBackToEmptyPlotOnCorruptJson() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try fx.seed { db in
            try db.execute(sql: """
                INSERT INTO sound_scenes (show_id, location_id, scene_name, plot_json, saved_at)
                VALUES (1, 'default', 'corrupt', '{not valid json', datetime('now'))
                """)
        }
        let latest = try await repo.latestScene(showId: 1)
        XCTAssertNotNil(latest)
        XCTAssertEqual(latest?.sceneName, "corrupt")
        XCTAssertEqual(latest?.plot.channels, [])
        XCTAssertEqual(latest?.plot.monitors, [])
    }

    // ── createScene ────────────────────────────────────────────────────

    func testCreateWritesRowPlusAuditEntry() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let scene = try repo.createScene(.init(
            showId: 1, sceneName: "set 1", plot: samplePlot(),
            splLimitDb: 95, savedByCookId: "engineer_dan"
        ))
        XCTAssertEqual(scene.sceneName, "set 1")
        XCTAssertEqual(scene.splLimitDb, 95)
        let entries = fx.fileAuditEntries()
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0]["action"] as? String, "sound_scene_created")
        XCTAssertEqual(entries[0]["saved_by_cook_id"] as? String, "engineer_dan")
    }

    func testCreateRejectsEmptySceneName() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        XCTAssertThrowsError(try repo.createScene(.init(showId: 1, sceneName: "", plot: samplePlot()))) { err in
            XCTAssertTrue("\(err.localizedDescription)".contains("scene_name"))
        }
    }

    func testCreateRejectsNonPositiveShowId() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        XCTAssertThrowsError(try repo.createScene(.init(showId: 0, sceneName: "x", plot: samplePlot()))) { err in
            XCTAssertTrue("\(err.localizedDescription)".contains("show_id"))
        }
    }

    // ── updateScene ────────────────────────────────────────────────────

    func testUpdatePatchesNamePlotAndWritesAudit() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let created = try repo.createScene(.init(showId: 1, sceneName: "draft", plot: samplePlot()))
        let updated = try repo.updateScene(id: created.id, patch: .init(
            sceneName: "final",
            plot: SoundPlot(channels: [SoundChannelEntry(id: "kick", label: "Kick", sourceType: "mic")]),
            setSplLimitDb: true, splLimitDb: 100
        ))
        XCTAssertEqual(updated.sceneName, "final")
        XCTAssertEqual(updated.plot.channels.count, 1)
        XCTAssertEqual(updated.splLimitDb, 100)
        let entries = fx.fileAuditEntries()
        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(entries[1]["action"] as? String, "sound_scene_updated")
        XCTAssertEqual(entries[1]["scene_id"] as? Int64, created.id)
    }

    func testUpdateThrowsNotFoundWhenIdMissing() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        XCTAssertThrowsError(try repo.updateScene(id: 9999, patch: .init(sceneName: "x"))) { err in
            XCTAssertEqual(err as? ShowsWriteError, .notFound)
        }
    }

    func testUpdateThrowsNotFoundOnLocationMismatch() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let s = try repo.createScene(.init(showId: 1, sceneName: "main", plot: samplePlot()))
        XCTAssertThrowsError(try satelliteRepo(fx).updateScene(id: s.id, patch: .init(sceneName: "hijack"))) { err in
            XCTAssertEqual(err as? ShowsWriteError, .notFound)
        }
    }

    func testUpdateRejectsEmptySceneNameInPatch() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let s = try repo.createScene(.init(showId: 1, sceneName: "main", plot: samplePlot()))
        XCTAssertThrowsError(try repo.updateScene(id: s.id, patch: .init(sceneName: "   "))) { err in
            XCTAssertTrue("\(err.localizedDescription)".contains("scene_name"))
        }
    }

    func testUpdateRejectsEmptyPatch() throws {
        // Route parity: "No patch fields supplied" → 400.
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let s = try repo.createScene(.init(showId: 1, sceneName: "main", plot: samplePlot()))
        XCTAssertThrowsError(try repo.updateScene(id: s.id, patch: .init())) { err in
            XCTAssertEqual(err as? ShowsWriteError, .validationFailed("No patch fields supplied"))
        }
    }

    func testUpdatePreservesUnchangedFieldsOnPartialPatch() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let s = try repo.createScene(.init(
            showId: 1, sceneName: "main", plot: samplePlot(),
            splLimitDb: 95, notes: "keep me"
        ))
        let upd = try repo.updateScene(id: s.id, patch: .init(setSplLimitDb: true, splLimitDb: 100))
        XCTAssertEqual(upd.sceneName, "main")
        XCTAssertEqual(upd.notes, "keep me")
        XCTAssertEqual(upd.splLimitDb, 100)
    }

    // ── deleteScene ────────────────────────────────────────────────────

    func testDeleteRemovesRowAndWritesAudit() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let s = try repo.createScene(.init(showId: 1, sceneName: "oops", plot: samplePlot()))
        XCTAssertTrue(try repo.deleteScene(id: s.id))
        let remaining = try await repo.listScenes(showId: 1)
        XCTAssertEqual(remaining.count, 0)
        let entries = fx.fileAuditEntries()
        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(entries[1]["action"] as? String, "sound_scene_deleted")
        XCTAssertEqual(entries[1]["scene_id"] as? Int64, s.id)
    }

    func testDeleteThrowsNotFoundOnLocationMismatch() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let s = try repo.createScene(.init(showId: 1, sceneName: "main", plot: samplePlot()))
        XCTAssertThrowsError(try satelliteRepo(fx).deleteScene(id: s.id)) { err in
            XCTAssertEqual(err as? ShowsWriteError, .notFound)
        }
    }

    // ── appendSplReading ───────────────────────────────────────────────

    func testAppendInsertsRowPlusSingleAuditEntry() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let row = try repo.appendSplReading(.init(showId: 1, dbValue: 95.4, takenByCookId: "cook-1"))
        XCTAssertEqual(row.showId, 1)
        XCTAssertEqual(row.dbValue, 95.4)
        XCTAssertGreaterThan(row.id, 0)
        let entries = fx.fileAuditEntries()
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0]["action"] as? String, "spl_reading_added")
        XCTAssertEqual(entries[0]["show_id"] as? Int64, 1)
        XCTAssertEqual(entries[0]["db_value"] as? Double, 95.4)
    }

    func testAppendRejectsDbValueOutOf30To160() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        for bad in [5.0, 200.0, Double.nan] {
            XCTAssertThrowsError(try repo.appendSplReading(.init(showId: 1, dbValue: bad))) { err in
                XCTAssertTrue("\(err.localizedDescription)".contains("db_value"), "\(bad)")
            }
        }
        let rows = try await repo.listSplReadings(showId: 1)
        XCTAssertEqual(rows.count, 0, "nothing should have been written")
    }

    func testAppendRejectsNonPositiveShowId() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        XCTAssertThrowsError(try repo.appendSplReading(.init(showId: 0, dbValue: 90))) { err in
            XCTAssertTrue("\(err.localizedDescription)".contains("show_id"))
        }
    }

    func testAppendPersistsPositiveSceneIdAndCoercesInvalidToNil() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let scene = try repo.createScene(.init(showId: 1, sceneName: "soundcheck", plot: samplePlot()))
        let r1 = try repo.appendSplReading(.init(showId: 1, sceneId: scene.id, dbValue: 90))
        XCTAssertEqual(r1.sceneId, scene.id)
        let r2 = try repo.appendSplReading(.init(showId: 1, sceneId: -1, dbValue: 92))
        XCTAssertNil(r2.sceneId)
    }

    // ── listSplReadings ────────────────────────────────────────────────

    func testListReadingsOldestToNewestBoundedByLimit() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        for (i, v) in [80.0, 85, 90, 95, 100].enumerated() {
            try repo.appendSplReading(.init(showId: 1, dbValue: v))
            // Distinct taken_at not guaranteed by datetime('now') in a tight
            // loop — id DESC tiebreak covers ordering (web relies on it too).
            _ = i
        }
        let rows = try await repo.listSplReadings(showId: 1, limit: 3)
        // limit picks the 3 most recent (DESC then reverse) → 90, 95, 100
        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(rows[0].dbValue, 90)
        XCTAssertEqual(rows[2].dbValue, 100)
    }

    func testListReadingsRespectsLocationScoping() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.appendSplReading(.init(showId: 1, dbValue: 90))
        try satelliteRepo(fx).appendSplReading(.init(showId: 2, dbValue: 100))
        let a = try await repo.listSplReadings(showId: 1)
        let b = try await satelliteRepo(fx).listSplReadings(showId: 1)
        let c = try await satelliteRepo(fx).listSplReadings(showId: 2)
        XCTAssertEqual(a.count, 1)
        XCTAssertEqual(b.count, 0)
        XCTAssertEqual(c.count, 1)
    }

    // ── transactional audit (native analog of the web rollback pin) ────

    func testCreateSceneRollsBackWhenAuditFails() async throws {
        // Point the logger at an unwritable path (a directory) so the JSONL
        // append throws INSIDE the tx — the scene INSERT must roll back.
        let (fx, _) = try makeFixture()
        defer { fx.cleanup() }
        let dir = (fx.path as NSString).deletingLastPathComponent
        let badLogger = ShowsAuditLogger(auditPath: dir)   // path IS a directory
        let repo = SoundRepository(
            readDB: fx.readDB, writeDB: fx.writeDB,
            locationId: "default", auditLogger: badLogger
        )
        XCTAssertThrowsError(try repo.createScene(.init(showId: 1, sceneName: "doomed", plot: samplePlot())))
        let count = try await fx.writeDB.pool.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM sound_scenes") ?? -1
        }
        XCTAssertEqual(count, 0, "audit failure must roll back the scene insert")
    }
}
