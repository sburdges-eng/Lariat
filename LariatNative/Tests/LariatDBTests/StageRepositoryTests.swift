import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Stage-setup repository tests. NOTE: the web oracle file
// `tests/js/test-stage-repo.mjs` is EMPTY (0 bytes) — these cases are
// authored directly from `lib/stageRepo.ts` + `/api/shows/[id]/stage`
// (documented divergence: native adds the coverage the web never had).
final class StageRepositoryTests: XCTestCase {

    private func makeFixture() throws -> (ShowsFixture, StageRepository) {
        let fx = try ShowsFixture.make()
        try fx.insertShow(id: 1, band: "Test Band", date: "2026-05-01", sourceRow: 1)
        try fx.insertShow(id: 2, locationId: "satellite", band: "Test Band 2", date: "2026-05-02", sourceRow: 2)
        let repo = StageRepository(
            readDB: fx.readDB, writeDB: fx.writeDB,
            locationId: "default", auditLogger: fx.auditLogger
        )
        return (fx, repo)
    }

    private func input(
        showId: Int64 = 1, room: String = "cabaret_160",
        ros: [RunOfShowEntry] = [], notes: String? = nil, actor: String? = nil
    ) -> StageRepository.UpsertInput {
        StageRepository.UpsertInput(
            showId: showId, roomConfig: room, runOfShow: ros,
            hospitalityRiderJson: #"{"beverage":["water"]}"#,
            techRiderJson: "{}", notes: notes, actorCookId: actor
        )
    }

    func testGetSetupNilWhenNoneExists() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let setup = try await repo.getSetup(showId: 1)
        XCTAssertNil(setup)
    }

    func testUpsertCreatesThenUpdatesSingleRow() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let first = try repo.upsertSetup(input(
            ros: [RunOfShowEntry(t: "5:30 PM", what: "Doors", who: "Door · Box · Bar")]
        ))
        XCTAssertTrue(first.created)
        XCTAssertEqual(first.setup.roomConfig, "cabaret_160")
        XCTAssertEqual(first.setup.runOfShow.count, 1)

        let second = try repo.upsertSetup(input(room: "dance_floor_240"))
        XCTAssertFalse(second.created)
        XCTAssertEqual(second.setup.roomConfig, "dance_floor_240")

        let count = try await fx.writeDB.pool.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM stage_setups") ?? -1
        }
        XCTAssertEqual(count, 1, "UPSERT must keep one row per (show, location)")
    }

    func testUpsertRejectsUnknownRoomConfigBeforeWriting() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        XCTAssertThrowsError(try repo.upsertSetup(input(room: "stadium_50000"))) { err in
            XCTAssertEqual(err as? ShowsWriteError,
                           .validationFailed("unknown room_config: stadium_50000"))
        }
        let count = try fx.writeDB.pool.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM stage_setups") ?? -1
        }
        XCTAssertEqual(count, 0)
        XCTAssertEqual(fx.fileAuditEntries().count, 0)
    }

    func testUpsertRejectsNonPositiveShowId() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        XCTAssertThrowsError(try repo.upsertSetup(input(showId: 0))) { err in
            XCTAssertTrue("\(err.localizedDescription)".contains("show_id"))
        }
    }

    func testUpsertWritesCreatedThenUpdatedAuditEntries() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.upsertSetup(input(actor: "mgr-1"))
        try repo.upsertSetup(input(room: "open_jam_140", actor: "mgr-2"))
        let entries = fx.fileAuditEntries()
        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(entries[0]["action"] as? String, "stage_setup_created")
        XCTAssertEqual(entries[0]["actor_cook_id"] as? String, "mgr-1")
        XCTAssertEqual(entries[1]["action"] as? String, "stage_setup_updated")
        XCTAssertEqual(entries[1]["room_config"] as? String, "open_jam_140")
    }

    func testUpsertScopedByLocation() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.upsertSetup(input())
        let satRepo = StageRepository(
            readDB: fx.readDB, writeDB: fx.writeDB,
            locationId: "satellite", auditLogger: fx.auditLogger
        )
        let cross = try await satRepo.getSetup(showId: 1)
        XCTAssertNil(cross, "default-location setup must not leak to satellite")
        try satRepo.upsertSetup(input(showId: 2))
        let sat = try await satRepo.getSetup(showId: 2)
        XCTAssertEqual(sat?.locationId, "satellite")
    }

    func testRunOfShowAndRidersRoundTrip() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.upsertSetup(input(
            ros: [
                RunOfShowEntry(t: "5:30 PM", what: "Doors", who: "Door · Box · Bar"),
                RunOfShowEntry(t: "8:00 PM", what: "SET 1", who: "Band"),
            ],
            notes: "risers back third"
        ))
        let setup = try await repo.getSetup(showId: 1)
        XCTAssertEqual(setup?.runOfShow.count, 2)
        XCTAssertEqual(setup?.runOfShow[1].what, "SET 1")
        XCTAssertEqual(StageSetupRow.riderKeyCount(setup?.hospitalityRiderJson), 1)
        XCTAssertEqual(StageSetupRow.riderKeyCount(setup?.techRiderJson), 0)
        XCTAssertEqual(setup?.notes, "risers back third")
        let completeness = StageCompleteness.from(setup: setup)
        XCTAssertEqual(completeness.score, 0.75)   // room + ros + hospitality, no tech
    }

    func testMalformedRiderJsonDegradesToEmptyObject() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        // Route parity: non-object rider bodies coerce to {} before the repo.
        try repo.upsertSetup(StageRepository.UpsertInput(
            showId: 1, roomConfig: "cabaret_160",
            hospitalityRiderJson: "{broken", techRiderJson: "[1,2]"
        ))
        let stored = try fx.writeDB.pool.read { db in
            try Row.fetchOne(db, sql: "SELECT hospitality_rider_json, tech_rider_json FROM stage_setups")
        }
        XCTAssertEqual(stored?["hospitality_rider_json"] as String?, "{}")
        XCTAssertEqual(stored?["tech_rider_json"] as String?, "{}")
    }

    func testUpsertRollsBackWhenAuditFails() throws {
        let (fx, _) = try makeFixture()
        defer { fx.cleanup() }
        let dir = (fx.path as NSString).deletingLastPathComponent
        let repo = StageRepository(
            readDB: fx.readDB, writeDB: fx.writeDB,
            locationId: "default", auditLogger: ShowsAuditLogger(auditPath: dir)
        )
        XCTAssertThrowsError(try repo.upsertSetup(input()))
        let count = try fx.writeDB.pool.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM stage_setups") ?? -1
        }
        XCTAssertEqual(count, 0, "audit failure must roll back the upsert")
    }
}
