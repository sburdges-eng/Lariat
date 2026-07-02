import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class LineCheckRepositoryTests: XCTestCase {

    private func testCatalog() -> StationCatalog {
        StationCatalog(
            stations: [
                KitchenStation(id: "grill_saute", name: "Grill / Sauté", line: "hot", lineCheckKey: "grille_saute"),
            ],
            lineCheckTemplates: [
                "grille_saute": ["Cornbread", "Mayo"],
            ],
            recipes: []
        )
    }

    func testPostEntryAndSignoffWithAudit() async throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        let today = ShiftDate.todayISO()
        let context = RegulatedWriteContext.nativeCook(cookId: "alice")

        _ = try repo.postEntry(
            LineCheckPostInput(
                shiftDate: today,
                stationId: "grill_saute",
                item: "Cornbread",
                status: .pass,
                cookId: "alice"
            ),
            context: context
        )
        _ = try repo.postEntry(
            LineCheckPostInput(
                shiftDate: today,
                stationId: "grill_saute",
                item: "Mayo",
                status: .fail,
                cookId: "alice",
                note: "Remade batch"
            ),
            context: context
        )

        let checklist = try await repo.loadChecklist(stationId: "grill_saute", date: today)
        XCTAssertEqual(checklist.items["Cornbread"]?.status, .pass)
        XCTAssertEqual(checklist.items["Mayo"]?.status, .fail)
        XCTAssertEqual(checklist.items["Mayo"]?.note, "Remade batch")

        _ = try repo.signoff(stationId: "grill_saute", context: context)
        let after = try await repo.loadChecklist(stationId: "grill_saute", date: today)
        XCTAssertNotNil(after.signoff)

        try await writeDB.pool.read { db in
            let inserts = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM audit_events WHERE entity='line_check_entries' AND action='insert'"
            )
            let signoffs = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM audit_events WHERE entity='station_signoffs' AND action='insert'"
            )
            XCTAssertEqual(inserts, 2)
            XCTAssertEqual(signoffs, 1)
        }
    }

    func testSignoffBlocksUnnotedFails() async throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        let today = ShiftDate.todayISO()
        let context = RegulatedWriteContext.nativeCook(cookId: "bob")

        _ = try repo.postEntry(
            LineCheckPostInput(
                shiftDate: today,
                stationId: "grill_saute",
                item: "Cornbread",
                status: .pass,
                cookId: "bob"
            ),
            context: context
        )
        _ = try repo.postEntry(
            LineCheckPostInput(
                shiftDate: today,
                stationId: "grill_saute",
                item: "Mayo",
                status: .fail,
                cookId: "bob"
            ),
            context: context
        )

        XCTAssertThrowsError(try repo.signoff(stationId: "grill_saute", context: context)) { error in
            XCTAssertEqual(error as? LineCheckWriteError, .unnotedFails(items: ["Mayo"]))
        }
    }

    func testLatestRowWins() async throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        let today = ShiftDate.todayISO()
        let context = RegulatedWriteContext.nativeCook(cookId: "carol")

        _ = try repo.postEntry(
            LineCheckPostInput(
                shiftDate: today, stationId: "grill_saute", item: "Mayo",
                status: .fail, cookId: "carol"
            ),
            context: context
        )
        _ = try repo.postEntry(
            LineCheckPostInput(
                shiftDate: today, stationId: "grill_saute", item: "Mayo",
                status: .pass, cookId: "carol"
            ),
            context: context
        )

        let checklist = try await repo.loadChecklist(stationId: "grill_saute", date: today)
        XCTAssertEqual(checklist.items["Mayo"]?.status, .pass)
        XCTAssertEqual(checklist.progress?.flagged, 0)
    }

    func testLoadStationList() async throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        let rows = try await repo.loadStationList()
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.station.id, "grill_saute")
    }

    // ── L5 + L6 signoff-gate suite (parity: tests/js/test-signoff-gates-api.mjs) ──
    //
    // The web oracle fixes SHIFT = '2026-05-05' and LOC = 'default'. `makeContext`
    // pins the same values so the gate location-scoping / clearance dates line up.

    private func makeContext(cookId: String) -> RegulatedWriteContext {
        RegulatedWriteContext.nativeCook(
            cookId: cookId,
            locationId: "default",
            shiftDate: "2026-05-05"
        )
    }

    private func signoffCount(_ writeDB: LariatWriteDatabase) throws -> Int {
        try writeDB.pool.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM station_signoffs") ?? 0
        }
    }

    private func insertMinorFlag(
        _ writeDB: LariatWriteDatabase,
        cookId: String,
        location: String = "default",
        effectiveTo: String? = nil
    ) throws {
        try writeDB.pool.write { db in
            try db.execute(
                sql: "INSERT INTO staff_flags (location_id, cook_id, flag, effective_from, effective_to) VALUES (?, ?, 'minor', '2026-01-01', ?)",
                arguments: [location, cookId, effectiveTo]
            )
        }
    }

    private func insertSickReport(
        _ writeDB: LariatWriteDatabase,
        cookId: String,
        action: String,
        location: String = "default",
        returnAt: String? = nil
    ) throws {
        try writeDB.pool.write { db in
            try db.execute(
                sql: """
                  INSERT INTO sick_worker_reports
                    (shift_date, location_id, cook_id, reported_by_pic_id, symptoms, action, started_at, return_at)
                  VALUES ('2026-05-05', ?, ?, 'pic-1', 'vomiting', ?, '2026-05-05T08:00:00Z', ?)
                  """,
                arguments: [location, cookId, action, returnAt]
            )
        }
    }

    // ── L5 — minor on prohibited station ──

    func testSignoffBlocksMinorOnProhibitedStation() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)

        try insertMinorFlag(writeDB, cookId: "cook-teen")
        XCTAssertThrowsError(try repo.signoff(stationId: "slicer", context: makeContext(cookId: "cook-teen"))) { err in
            guard case LineCheckWriteError.minorProhibited(let citation, let station) = err else {
                return XCTFail("expected .minorProhibited, got \(err)")
            }
            XCTAssertEqual(station, "slicer")
            XCTAssertTrue(citation.contains("YEOA"))
        }
        XCTAssertEqual(try signoffCount(writeDB), 0)
    }

    func testSignoffBlocksMinorOnPrepPrefix() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)

        try insertMinorFlag(writeDB, cookId: "cook-teen")
        XCTAssertThrowsError(try repo.signoff(stationId: "prep-cold", context: makeContext(cookId: "cook-teen")))
        XCTAssertEqual(try signoffCount(writeDB), 0)
    }

    func testSignoffAllowsMinorOnLine() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)

        try insertMinorFlag(writeDB, cookId: "cook-teen")
        _ = try repo.signoff(stationId: "line", context: makeContext(cookId: "cook-teen"))
        XCTAssertEqual(try signoffCount(writeDB), 1)
    }

    func testSignoffAllowsNonMinorOnProhibited() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)

        _ = try repo.signoff(stationId: "slicer", context: makeContext(cookId: "cook-adult"))
        XCTAssertEqual(try signoffCount(writeDB), 1)
    }

    func testSignoffAllowsInactiveMinorFlag() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)

        try insertMinorFlag(writeDB, cookId: "cook-grown", effectiveTo: "2025-01-01")
        _ = try repo.signoff(stationId: "slicer", context: makeContext(cookId: "cook-grown"))
        XCTAssertEqual(try signoffCount(writeDB), 1)
    }

    func testSignoffMinorFlagIsLocationScoped() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)

        try insertMinorFlag(writeDB, cookId: "cook-teen", location: "other-site")
        _ = try repo.signoff(stationId: "slicer", context: makeContext(cookId: "cook-teen"))  // loc default
        XCTAssertEqual(try signoffCount(writeDB), 1)
    }

    // ── L6 — sick-worker exclusion ──

    func testSignoffBlocksSickExcluded() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)

        try insertSickReport(writeDB, cookId: "cook-sick", action: "excluded")
        XCTAssertThrowsError(try repo.signoff(stationId: "line", context: makeContext(cookId: "cook-sick"))) { err in
            guard case LineCheckWriteError.sickExcluded(let citation) = err else {
                return XCTFail("expected .sickExcluded, got \(err)")
            }
            XCTAssertTrue(citation.contains("2-201.12"))
        }
        XCTAssertEqual(try signoffCount(writeDB), 0)
    }

    func testSignoffBlocksSickRestricted() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)

        try insertSickReport(writeDB, cookId: "cook-restricted", action: "restricted")
        XCTAssertThrowsError(try repo.signoff(stationId: "line", context: makeContext(cookId: "cook-restricted")))
        XCTAssertEqual(try signoffCount(writeDB), 0)
    }

    func testSignoffAllowsSickMonitor() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)

        try insertSickReport(writeDB, cookId: "cook-monitor", action: "monitor")
        _ = try repo.signoff(stationId: "line", context: makeContext(cookId: "cook-monitor"))
        XCTAssertEqual(try signoffCount(writeDB), 1)
    }

    func testSignoffAllowsSickAfterClearance() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)

        try insertSickReport(writeDB, cookId: "cook-was-sick", action: "excluded", returnAt: "2026-05-04T14:00:00Z")
        _ = try repo.signoff(stationId: "line", context: makeContext(cookId: "cook-was-sick"))
        XCTAssertEqual(try signoffCount(writeDB), 1)
    }

    func testSignoffSickIsLocationScoped() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)

        try insertSickReport(writeDB, cookId: "cook-sick", action: "excluded", location: "other-site")
        _ = try repo.signoff(stationId: "line", context: makeContext(cookId: "cook-sick"))  // loc default
        XCTAssertEqual(try signoffCount(writeDB), 1)
    }

    // ── Combined / ordering ──

    func testL5FiresBeforeL6() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)

        try insertMinorFlag(writeDB, cookId: "cook-both")
        try insertSickReport(writeDB, cookId: "cook-both", action: "excluded")
        XCTAssertThrowsError(try repo.signoff(stationId: "slicer", context: makeContext(cookId: "cook-both"))) { err in
            guard case LineCheckWriteError.minorProhibited = err else {
                return XCTFail("expected .minorProhibited (L5 before L6), got \(err)")
            }
        }
        XCTAssertEqual(try signoffCount(writeDB), 0)
    }

    func testSickOnProhibitedNonMinorGivesL6() throws {
        let (readDB, writeDB, catalog, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)

        try insertSickReport(writeDB, cookId: "cook-adult-sick", action: "excluded")
        XCTAssertThrowsError(try repo.signoff(stationId: "slicer", context: makeContext(cookId: "cook-adult-sick"))) { err in
            guard case LineCheckWriteError.sickExcluded = err else {
                return XCTFail("expected .sickExcluded, got \(err)")
            }
        }
        XCTAssertEqual(try signoffCount(writeDB), 0)
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, StationCatalog, String) {
        let path = try seedLineCheckDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (readDB, writeDB, testCatalog(), path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedLineCheckDatabase() throws -> String {
    let dir = NSTemporaryDirectory() + "lariat-linecheck-" + UUID().uuidString
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let path = (dir as NSString).appendingPathComponent("lariat.db")
    let pool = try DatabasePool(path: path)
    try pool.write { db in
        try db.execute(sql: """
            CREATE TABLE line_check_entries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              station_id TEXT NOT NULL,
              item TEXT NOT NULL,
              status TEXT NOT NULL,
              par TEXT,
              have TEXT,
              need TEXT,
              note TEXT,
              cook_id TEXT,
              glove_change_attested INTEGER,
              location_id TEXT NOT NULL DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE station_signoffs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              station_id TEXT NOT NULL,
              cook_id TEXT NOT NULL,
              signoff_type TEXT NOT NULL DEFAULT 'self',
              location_id TEXT NOT NULL DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE audit_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              actor_cook_id TEXT,
              actor_source TEXT NOT NULL,
              entity TEXT NOT NULL,
              entity_id INTEGER,
              action TEXT NOT NULL
                CHECK(action IN ('insert','update','delete','correction','view')),
              replaces_id INTEGER,
              payload_json TEXT,
              note TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE staff_flags (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT NOT NULL,
              cook_id TEXT NOT NULL,
              flag TEXT NOT NULL,
              effective_from TEXT,
              effective_to TEXT
            );
            CREATE TABLE sick_worker_reports (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT,
              location_id TEXT NOT NULL,
              cook_id TEXT NOT NULL,
              reported_by_pic_id TEXT,
              symptoms TEXT,
              diagnosed_illness TEXT,
              action TEXT NOT NULL,
              started_at TEXT,
              return_at TEXT,
              clearance_source TEXT,
              note TEXT
            );
            """)
    }
    return path
}
