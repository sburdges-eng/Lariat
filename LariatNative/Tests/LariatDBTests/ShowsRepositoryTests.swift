import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity ports of `tests/js/test-shows-repo.mjs` (window/scoping/
// pipeline/archive), `tests/js/test-shows-tonight-api.mjs` (composed tonight
// read), and `tests/js/test-show-capacity-api.mjs` (capacity override write
// + file audit). Seeds mirror the web xlsx fixture rows (2026-05-01 … 06-01,
// whiskey/2024 archive rows) — ingest itself stays a web script surface.
final class ShowsRepositoryTests: XCTestCase {

    private func makeFixture(seedShows: Bool = true) throws -> ShowsFixture {
        let fx = try ShowsFixture.make()
        if seedShows {
            try fx.insertShow(band: "band a", date: "2026-05-01", sourceRow: 1)
            try fx.insertShow(band: "band b", date: "2026-05-08", sourceRow: 2)
            try fx.insertShow(band: "band c", date: "2026-05-15", sourceRow: 3)
            try fx.insertShow(band: "band d", date: "2026-05-22", sourceRow: 4)
            try fx.insertShow(band: "band e", date: "2026-06-01", sourceRow: 5)
            try fx.seed { db in
                try db.execute(sql: """
                    INSERT INTO shows_archive
                      (location_id, band_name, show_date, era_year, source_row, ingested_at, ingest_run_id)
                    VALUES
                      ('default', 'the whiskey sweets brunch', '2023-06-10', 2023, 1, datetime('now'), 1),
                      ('default', 'dusty rose revue',          '2024-03-01', 2024, 2, datetime('now'), 1),
                      ('default', 'silver spur set',           '2024-09-14', 2024, 3, datetime('now'), 1);
                    """)
            }
        }
        return fx
    }

    // ── upcomingShows (test-shows-repo) ────────────────────────────────

    func testUpcomingRespects35DayWindowFromFixedToday() async throws {
        let fx = try makeFixture()
        defer { fx.cleanup() }
        let repo = ShowsRepository(readDB: fx.readDB)
        // 5 weeks = 35 days → through 2026-05-30. Expect 4 rows (drops 06-01).
        let rows = try await repo.upcomingShows(today: "2026-04-25", weeks: 5)
        XCTAssertEqual(rows.count, 4)
        XCTAssertEqual(rows.map(\.showDate),
                       ["2026-05-01", "2026-05-08", "2026-05-15", "2026-05-22"])
    }

    func testUpcomingScopedByLocation() async throws {
        let fx = try makeFixture()
        defer { fx.cleanup() }
        let other = ShowsRepository(readDB: fx.readDB, locationId: "other-location")
        let rows = try await other.upcomingShows(today: "2026-04-25", weeks: 5)
        XCTAssertEqual(rows.count, 0)
    }

    // ── pipelineCounts ─────────────────────────────────────────────────

    func testPipelineCountsIncludeUpcomingPlusPastActive() async throws {
        let fx = try makeFixture()
        defer { fx.cleanup() }
        try fx.insertShow(
            band: "the settled late show", date: "2026-04-01",
            statusJson: #"{"create_dice_tickets":"y","dice_email":"tix, dos"}"#,
            sourceRow: 999
        )
        let repo = ShowsRepository(readDB: fx.readDB)
        let counts = try await repo.pipelineCounts(today: "2026-04-25", weeks: 52)
        let total = counts.values.reduce(0, +)
        let upcoming = try await repo.upcomingShows(today: "2026-04-25", weeks: 52)
        XCTAssertEqual(total, upcoming.count + 1)
        XCTAssertEqual(counts[.settled], 1)
    }

    func testPipelineCountsEveryKeyIsAKnownStage() async throws {
        let fx = try makeFixture()
        defer { fx.cleanup() }
        let counts = try await ShowsRepository(readDB: fx.readDB)
            .pipelineCounts(today: "2026-04-25", weeks: 52)
        XCTAssertEqual(Set(counts.keys), Set(PipelineStage.allCases))
    }

    // ── archive (test-shows-repo + test-shows-api) ─────────────────────

    func testArchiveSearchFiltersByBandSubstring() async throws {
        let fx = try makeFixture()
        defer { fx.cleanup() }
        let rows = try await ShowsRepository(readDB: fx.readDB).archiveSearch(q: "whiskey")
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].bandName, "the whiskey sweets brunch")
    }

    func testArchiveSearchFiltersByEraYear() async throws {
        let fx = try makeFixture()
        defer { fx.cleanup() }
        let rows = try await ShowsRepository(readDB: fx.readDB).archiveSearch(era: 2024)
        XCTAssertEqual(rows.count, 2)
        XCTAssertTrue(rows.allSatisfy { $0.eraYear == 2024 })
    }

    func testArchiveErasNewestFirst() async throws {
        let fx = try makeFixture()
        defer { fx.cleanup() }
        let eras = try await ShowsRepository(readDB: fx.readDB).archiveEras()
        XCTAssertEqual(eras, [2024, 2023])
    }

    // ── getShowById / nextUpcoming ─────────────────────────────────────

    func testGetShowByIdReturnsParsedStatusAndNilForMissing() async throws {
        let fx = try makeFixture()
        defer { fx.cleanup() }
        let repo = ShowsRepository(readDB: fx.readDB)
        let all = try await repo.upcomingShows(today: "2026-04-25", weeks: 52)
        let one = try await repo.getShowById(all[0].id)
        XCTAssertEqual(one?.id, all[0].id)
        XCTAssertNotNil(one?.status)  // parsed dictionary, not a string
        let missing = try await repo.getShowById(999_999)
        XCTAssertNil(missing)
    }

    func testNextUpcomingReturnsSoonestFutureShowOrNil() async throws {
        let fx = try makeFixture()
        defer { fx.cleanup() }
        let repo = ShowsRepository(readDB: fx.readDB)
        let n = try await repo.nextUpcoming(today: "2026-04-25")
        XCTAssertEqual(n?.showDate, "2026-05-01")
        let none = try await repo.nextUpcoming(today: "2030-01-01")
        XCTAssertNil(none)
    }

    // ── tonightSnapshot (test-shows-tonight-api) ───────────────────────

    func testTonightNothingSeededReturnsAllNil() async throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        let snap = try await ShowsRepository(readDB: fx.readDB).tonightSnapshot(date: "2026-05-11")
        XCTAssertNil(snap.show)
        XCTAssertNil(snap.stageSetup)
        XCTAssertNil(snap.latestSoundScene)
        XCTAssertNil(snap.boxOfficeSummary)
        XCTAssertNil(snap.attendance)
        XCTAssertNil(snap.previousShow)
        XCTAssertEqual(snap.runOfShow, [])
    }

    func testTonightStillReturnsPreviousShowWhenNoShowTonight() async throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        try fx.insertShow(band: "Last Week", date: "2026-05-04", price: 15)
        let snap = try await ShowsRepository(readDB: fx.readDB).tonightSnapshot(date: "2026-05-11")
        XCTAssertNil(snap.show)
        XCTAssertEqual(snap.previousShow?.bandName, "Last Week")
        XCTAssertEqual(snap.previousShow?.price, 15)
    }

    func testTonightReturnsShowAndAllSubRecords() async throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        let showId = try fx.insertShow(band: "Tonight Band", date: "2026-05-11", price: 20)
        try fx.seed { db in
            try db.execute(sql: """
                INSERT INTO stage_setups (show_id, location_id, room_config, run_of_show_json)
                VALUES (\(showId), 'default', 'cabaret_160',
                        '[{"time":"7:00pm","label":"Doors"}]');
                INSERT INTO sound_scenes (show_id, location_id, scene_name, plot_json, spl_limit_db)
                VALUES (\(showId), 'default', 'set 1', '{"channels":[],"monitors":[]}', 95);
                INSERT INTO box_office_lines (show_id, location_id, source, qty, face_price, fees, scanned_at)
                VALUES (\(showId), 'default', 'dice', 50, 20.0, 100.0, datetime('now')),
                       (\(showId), 'default', 'walkup', 10, 25.0, 0, NULL);
                """)
        }
        let snap = try await ShowsRepository(readDB: fx.readDB).tonightSnapshot(date: "2026-05-11")
        XCTAssertEqual(snap.show?.bandName, "Tonight Band")
        XCTAssertEqual(snap.stageSetup?.roomConfig, "cabaret_160")
        XCTAssertEqual(snap.latestSoundScene?.sceneName, "set 1")
        XCTAssertEqual(snap.boxOfficeSummary?.totalQty, 60)
        XCTAssertEqual(snap.boxOfficeSummary?.scannedQty, 50)
        // Tonight quirk (web parity): the raw run_of_show_json is read with
        // the {time,label} parser — the seeded entry surfaces; stage-authored
        // {t,what,who} entries would be skipped (see dedicated test below).
        XCTAssertEqual(snap.runOfShow, [TonightRunEntry(time: "7:00pm", label: "Doors")])
    }

    func testTonightSkipsStageShapeRunOfShowEntries() async throws {
        // Observed web quirk ported faithfully: the Stage board writes
        // {t,what,who} entries, but the tonight reader only accepts
        // {time,label}/{at,text}/strings — stage-authored entries vanish
        // from the tonight run-of-show list on the web too.
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        let showId = try fx.insertShow(band: "B", date: "2026-05-11")
        try fx.seed { db in
            try db.execute(sql: """
                INSERT INTO stage_setups (show_id, location_id, room_config, run_of_show_json)
                VALUES (\(showId), 'default', 'cabaret_160',
                        '[{"t":"5:30 PM","what":"Doors","who":"Door · Box · Bar"}]');
                """)
        }
        let snap = try await ShowsRepository(readDB: fx.readDB).tonightSnapshot(date: "2026-05-11")
        XCTAssertEqual(snap.stageSetup?.runOfShow.count, 1)   // stage reader sees it
        XCTAssertEqual(snap.runOfShow, [])                    // tonight reader skips it
    }

    func testTonightAttendanceUnsetWhenVenueCapacityNull() async throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        let showId = try fx.insertShow(band: "B", date: "2026-05-11")
        try fx.seed { db in
            try db.execute(sql: """
                INSERT INTO box_office_lines (show_id, location_id, source, qty)
                VALUES (\(showId), 'default', 'walkup', 10);
                """)
        }
        let snap = try await ShowsRepository(readDB: fx.readDB).tonightSnapshot(date: "2026-05-11")
        XCTAssertEqual(snap.attendance?.status, .unset)
        XCTAssertNil(snap.venueCapacity)
        XCTAssertNil(snap.effectiveCapacity)
    }

    func testTonightAttendanceStatusAgainstVenueCapacity() async throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        let showId = try fx.insertShow(band: "B", date: "2026-05-11")
        try fx.seed { db in
            try db.execute(sql: """
                UPDATE locations SET capacity = 100 WHERE id = 'default';
                INSERT INTO box_office_lines (show_id, location_id, source, qty, scanned_at)
                VALUES (\(showId), 'default', 'dice', 85, datetime('now'));
                """)
        }
        let snap = try await ShowsRepository(readDB: fx.readDB).tonightSnapshot(date: "2026-05-11")
        XCTAssertEqual(snap.venueCapacity, 100)
        XCTAssertEqual(snap.effectiveCapacity, 100)
        XCTAssertEqual(snap.attendance?.status, .at)
        XCTAssertEqual(snap.attendance?.scannedPct, 85)
    }

    func testTonightAttendanceNilWhenNoShow() async throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        try fx.seed { db in
            try db.execute(sql: "UPDATE locations SET capacity = 100 WHERE id = 'default'")
        }
        let snap = try await ShowsRepository(readDB: fx.readDB).tonightSnapshot(date: "2026-05-11")
        XCTAssertNil(snap.attendance)
    }

    func testTonightHonorsDateOverride() async throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        try fx.insertShow(band: "Weekend", date: "2026-05-09")
        let snap = try await ShowsRepository(readDB: fx.readDB).tonightSnapshot(date: "2026-05-09")
        XCTAssertEqual(snap.show?.bandName, "Weekend")
        let other = try await ShowsRepository(readDB: fx.readDB).tonightSnapshot(date: "2026-05-10")
        XCTAssertNil(other.show)
    }

    func testTonightPerShowCapacityOverrideBeatsVenue() async throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        try fx.insertShow(band: "B", date: "2026-05-11", statusJson: #"{"capacity":180}"#)
        try fx.seed { db in
            try db.execute(sql: "UPDATE locations SET capacity = 220 WHERE id = 'default'")
        }
        let snap = try await ShowsRepository(readDB: fx.readDB).tonightSnapshot(date: "2026-05-11")
        XCTAssertEqual(snap.effectiveCapacity, 180)
        XCTAssertEqual(snap.capacityOverride, 180)
        XCTAssertEqual(snap.venueCapacity, 220)
    }

    func testTonightFallsBackToVenueWhenOverrideInvalid() async throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        try fx.insertShow(band: "B", date: "2026-05-11", statusJson: #"{"capacity":0}"#)
        try fx.seed { db in
            try db.execute(sql: "UPDATE locations SET capacity = 220 WHERE id = 'default'")
        }
        let snap = try await ShowsRepository(readDB: fx.readDB).tonightSnapshot(date: "2026-05-11")
        XCTAssertEqual(snap.effectiveCapacity, 220)
        XCTAssertNil(snap.capacityOverride)
    }

    func testTonightDoesNotCrossLocations() async throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        try fx.insertShow(locationId: "satellite", band: "Sat Band", date: "2026-05-11")
        let snap = try await ShowsRepository(readDB: fx.readDB).tonightSnapshot(date: "2026-05-11")
        XCTAssertNil(snap.show)
        let sat = try await ShowsRepository(readDB: fx.readDB, locationId: "satellite")
            .tonightSnapshot(date: "2026-05-11")
        XCTAssertEqual(sat.show?.bandName, "Sat Band")
    }

    // ── setCapacityOverride (test-show-capacity-api) ───────────────────

    func testCapacityRejectsInvalidShowId() throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        let repo = ShowsRepository(readDB: fx.readDB)
        XCTAssertThrowsError(try repo.setCapacityOverride(
            showId: 0, capacity: 100, writeDB: fx.writeDB, actorCookId: nil,
            auditLogger: fx.auditLogger
        )) { err in
            XCTAssertEqual(err as? ShowsWriteError, .validationFailed("Invalid show id"))
        }
    }

    func testCapacitySetsOverrideAndWritesOneFileAuditEntry() throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        let showId = try fx.insertShow(band: "B", date: "2026-05-11")
        let repo = ShowsRepository(readDB: fx.readDB)
        let result = try repo.setCapacityOverride(
            showId: showId, capacity: 180, writeDB: fx.writeDB,
            actorCookId: "mgr-1", auditLogger: fx.auditLogger
        )
        XCTAssertEqual(result.capacity, 180)
        XCTAssertEqual(result.status["capacity"], .number(180))

        let raw = try fx.writeDB.pool.read { db in
            try String.fetchOne(db, sql: "SELECT status_json FROM shows WHERE id = ?", arguments: [showId])
        }
        XCTAssertEqual(ShowsTonightCompute.parseStatusJson(raw)["capacity"], .number(180))

        let entries = fx.fileAuditEntries()
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0]["action"] as? String, "show_capacity_set")
        XCTAssertEqual(entries[0]["capacity"] as? Int, 180)
        XCTAssertEqual(entries[0]["actor_cook_id"] as? String, "mgr-1")
    }

    func testCapacityFloorsFractionalOverrides() throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        let showId = try fx.insertShow(band: "B", date: "2026-05-11")
        let result = try ShowsRepository(readDB: fx.readDB).setCapacityOverride(
            showId: showId, capacity: 180.7, writeDB: fx.writeDB,
            actorCookId: nil, auditLogger: fx.auditLogger
        )
        XCTAssertEqual(result.capacity, 180)
    }

    func testCapacityNilClearsTheKey() throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        let showId = try fx.insertShow(band: "B", date: "2026-05-11", statusJson: #"{"capacity":180}"#)
        let repo = ShowsRepository(readDB: fx.readDB)
        let result = try repo.setCapacityOverride(
            showId: showId, capacity: nil, writeDB: fx.writeDB,
            actorCookId: nil, auditLogger: fx.auditLogger
        )
        XCTAssertNil(result.capacity)
        XCTAssertNil(result.status["capacity"])
    }

    func testCapacityZeroOrNegativeTreatedAsClear() throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        let showId = try fx.insertShow(band: "B", date: "2026-05-11", statusJson: #"{"capacity":180}"#)
        let repo = ShowsRepository(readDB: fx.readDB)
        for cap in [0.0, -25.0] {
            let result = try repo.setCapacityOverride(
                showId: showId, capacity: cap, writeDB: fx.writeDB,
                actorCookId: nil, auditLogger: fx.auditLogger
            )
            XCTAssertNil(result.capacity, "capacity \(cap) should clear")
        }
    }

    func testCapacityPreservesOtherStatusKeys() throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        let showId = try fx.insertShow(
            band: "B", date: "2026-05-11",
            statusJson: #"{"announce_date":"y","doors":"7pm"}"#
        )
        let result = try ShowsRepository(readDB: fx.readDB).setCapacityOverride(
            showId: showId, capacity: 150, writeDB: fx.writeDB,
            actorCookId: nil, auditLogger: fx.auditLogger
        )
        XCTAssertEqual(result.status["announce_date"], .string("y"))
        XCTAssertEqual(result.status["doors"], .string("7pm"))
        XCTAssertEqual(result.status["capacity"], .number(150))
    }

    func testCapacityRejectsNonFinite() throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        let showId = try fx.insertShow(band: "B", date: "2026-05-11")
        XCTAssertThrowsError(try ShowsRepository(readDB: fx.readDB).setCapacityOverride(
            showId: showId, capacity: .nan, writeDB: fx.writeDB,
            actorCookId: nil, auditLogger: fx.auditLogger
        )) { err in
            XCTAssertEqual(err as? ShowsWriteError,
                           .validationFailed("capacity must be a finite number or null"))
        }
    }

    func testCapacityRejectsAboveMax() throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        let showId = try fx.insertShow(band: "B", date: "2026-05-11")
        XCTAssertThrowsError(try ShowsRepository(readDB: fx.readDB).setCapacityOverride(
            showId: showId, capacity: 5001, writeDB: fx.writeDB,
            actorCookId: nil, auditLogger: fx.auditLogger
        )) { err in
            XCTAssertEqual(err as? ShowsWriteError,
                           .validationFailed("capacity must be <= 5000"))
        }
        XCTAssertEqual(fx.fileAuditEntries().count, 0, "rejected write must not audit")
    }

    func testCapacityNotFoundForUnknownShow() throws {
        let fx = try makeFixture(seedShows: false)
        defer { fx.cleanup() }
        XCTAssertThrowsError(try ShowsRepository(readDB: fx.readDB).setCapacityOverride(
            showId: 9999, capacity: 100, writeDB: fx.writeDB,
            actorCookId: nil, auditLogger: fx.auditLogger
        )) { err in
            XCTAssertEqual(err as? ShowsWriteError, .notFound)
        }
    }
}
