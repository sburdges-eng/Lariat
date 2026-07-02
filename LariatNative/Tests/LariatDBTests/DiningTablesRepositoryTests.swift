import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Ports every oracle case in `tests/js/test-dining-tables-api.mjs`
/// (POST/GET/PATCH/DELETE of /api/dining-tables), plus the floor page's
/// open-reservations read (authored against `app/floor/page.jsx`).
final class DiningTablesRepositoryTests: XCTestCase {

    // ── POST /api/dining-tables ──────────────────────────────────────────

    func testCreateWritesRowAndInsertAudit() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }

        let id = try repo.create(
            input: DiningTableCreateInput(id: "T2", name: "Patio 2", capacity: 6, cookId: "alice"),
            context: ctx()
        )
        XCTAssertEqual(id, "T2")

        try writeDB.pool.read { db in
            let row = try Row.fetchOne(
                db, sql: "SELECT * FROM dining_tables WHERE id=? AND location_id=?",
                arguments: ["T2", "default"]
            )
            XCTAssertNotNil(row)
            XCTAssertEqual(row?["name"], "Patio 2")
            XCTAssertEqual(row?["capacity"], 6)
            XCTAssertEqual(row?["status"], "open")
            XCTAssertEqual(row?["x"], 0.0)
            XCTAssertEqual(row?["y"], 0.0)
            XCTAssertEqual(row?["w"], 1.0)
            XCTAssertEqual(row?["h"], 1.0)

            let a = try Row.fetchOne(
                db,
                sql: """
                  SELECT * FROM audit_events
                   WHERE entity='dining_tables' AND action='insert'
                   ORDER BY id DESC LIMIT 1
                  """
            )
            XCTAssertNotNil(a, "expected insert audit event")
            XCTAssertEqual(a?["entity_id"], 0)
            let payload = try payloadJSON(a)
            XCTAssertEqual(payload["id"] as? String, "T2")
            XCTAssertEqual(payload["name"] as? String, "Patio 2")
            XCTAssertEqual(payload["capacity"] as? Int, 6)
            XCTAssertEqual(payload["status"] as? String, "open")
        }
    }

    func testCreateRespectsCustomGeometryAndStatus() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }

        _ = try repo.create(
            input: DiningTableCreateInput(
                id: "T9", name: "Bar 9", x: 10, y: 5.5, w: 2, h: 3, status: "closed"
            ),
            context: ctx()
        )
        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM dining_tables WHERE id='T9'")
            XCTAssertEqual(row?["x"], 10.0)
            XCTAssertEqual(row?["y"], 5.5)
            XCTAssertEqual(row?["w"], 2.0)
            XCTAssertEqual(row?["h"], 3.0)
            XCTAssertEqual(row?["status"], "closed")
        }
    }

    func testCreateRejectsMissingOrBlankId() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanup(path: path) }

        XCTAssertThrowsError(
            try repo.create(input: DiningTableCreateInput(id: nil, name: "X"), context: ctx())
        ) { XCTAssertEqual($0 as? DiningTableWriteError, .idRequired) }
        XCTAssertThrowsError(
            try repo.create(input: DiningTableCreateInput(id: "   ", name: "X"), context: ctx())
        ) { XCTAssertEqual($0 as? DiningTableWriteError, .idRequired) }
    }

    func testCreateRejectsMissingOrBlankName() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanup(path: path) }

        XCTAssertThrowsError(
            try repo.create(input: DiningTableCreateInput(id: "T1", name: nil), context: ctx())
        ) { XCTAssertEqual($0 as? DiningTableWriteError, .nameRequired) }
        XCTAssertThrowsError(
            try repo.create(input: DiningTableCreateInput(id: "T1", name: "   "), context: ctx())
        ) { XCTAssertEqual($0 as? DiningTableWriteError, .nameRequired) }
    }

    func testCreateRejectsCapacityZeroAndFiftyOne() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanup(path: path) }

        XCTAssertThrowsError(
            try repo.create(input: DiningTableCreateInput(id: "T1", name: "X", capacity: 0), context: ctx())
        ) { XCTAssertEqual($0 as? DiningTableWriteError, .capacityOutOfRange) }
        XCTAssertThrowsError(
            try repo.create(input: DiningTableCreateInput(id: "T1", name: "X", capacity: 51), context: ctx())
        ) { XCTAssertEqual($0 as? DiningTableWriteError, .capacityOutOfRange) }
    }

    func testCreateRejectsBadStatus() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanup(path: path) }

        XCTAssertThrowsError(
            try repo.create(
                input: DiningTableCreateInput(id: "T1", name: "X", status: "on_fire"), context: ctx()
            )
        ) { XCTAssertEqual($0 as? DiningTableWriteError, .badStatus) }
    }

    func testCreateDuplicateThrows409AndOtherLocationSucceeds() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanup(path: path) }

        _ = try repo.create(input: DiningTableCreateInput(id: "T1", name: "first"), context: ctx())
        XCTAssertThrowsError(
            try repo.create(input: DiningTableCreateInput(id: "T1", name: "second"), context: ctx())
        ) { XCTAssertEqual($0 as? DiningTableWriteError, .idAlreadyInUse) }
        // Same id at a different location is fine (composite PK).
        XCTAssertNoThrow(
            try repo.create(
                input: DiningTableCreateInput(id: "T1", name: "first elsewhere"),
                context: ctx(locationId: "kitchen-b")
            )
        )
    }

    // ── GET /api/dining-tables ───────────────────────────────────────────

    func testListOrdersLexicographically() async throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanup(path: path) }

        _ = try repo.create(input: DiningTableCreateInput(id: "T2", name: "b"), context: ctx())
        _ = try repo.create(input: DiningTableCreateInput(id: "T10", name: "c"), context: ctx())
        _ = try repo.create(input: DiningTableCreateInput(id: "T1", name: "a"), context: ctx())

        let rows = try await repo.list(locationId: "default")
        // Lexicographic ASC on TEXT column: T1, T10, T2.
        XCTAssertEqual(rows.map(\.id), ["T1", "T10", "T2"])
    }

    func testListScopesByLocation() async throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanup(path: path) }

        _ = try repo.create(input: DiningTableCreateInput(id: "T1", name: "A"), context: ctx(locationId: "kitchen-a"))
        _ = try repo.create(input: DiningTableCreateInput(id: "T1", name: "B"), context: ctx(locationId: "kitchen-b"))

        let a = try await repo.list(locationId: "kitchen-a")
        XCTAssertEqual(a.count, 1)
        XCTAssertEqual(a.first?.name, "A")
        let b = try await repo.list(locationId: "kitchen-b")
        XCTAssertEqual(b.count, 1)
        XCTAssertEqual(b.first?.name, "B")
    }

    // ── PATCH /api/dining-tables/:id ─────────────────────────────────────

    func testStatusTransitionWritesAuditWithFromTo() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }

        _ = try repo.create(input: DiningTableCreateInput(id: "T1", name: "Window 1", capacity: 4), context: ctx())
        try repo.update(id: "T1", patch: DiningTablePatch(status: "seated", cookId: "alice"), context: ctx())

        try writeDB.pool.read { db in
            let status = try String.fetchOne(db, sql: "SELECT status FROM dining_tables WHERE id='T1'")
            XCTAssertEqual(status, "seated")
            let a = try Row.fetchOne(
                db,
                sql: """
                  SELECT * FROM audit_events
                   WHERE entity='dining_tables' AND action='update'
                   ORDER BY id DESC LIMIT 1
                  """
            )
            XCTAssertNotNil(a)
            let payload = try payloadJSON(a)
            XCTAssertEqual(payload["id"] as? String, "T1")
            XCTAssertEqual(payload["from_status"] as? String, "open")
            XCTAssertEqual(payload["to_status"] as? String, "seated")
        }
    }

    func testPatchRejectsBadStatusAndLeavesRowUnchanged() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }

        _ = try repo.create(input: DiningTableCreateInput(id: "T1", name: "Window 1"), context: ctx())
        XCTAssertThrowsError(
            try repo.update(id: "T1", patch: DiningTablePatch(status: "on_fire"), context: ctx())
        ) { XCTAssertEqual($0 as? DiningTableWriteError, .badStatus) }

        try writeDB.pool.read { db in
            let status = try String.fetchOne(db, sql: "SELECT status FROM dining_tables WHERE id='T1'")
            XCTAssertEqual(status, "open")
        }
    }

    func testRenameUpdatesNameAndAuditStatusUnchanged() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }

        _ = try repo.create(input: DiningTableCreateInput(id: "T1", name: "old"), context: ctx())
        try repo.update(id: "T1", patch: DiningTablePatch(name: "new name"), context: ctx())

        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM dining_tables WHERE id='T1'")
            XCTAssertEqual(row?["name"], "new name")
            XCTAssertEqual(row?["status"], "open")
            let a = try Row.fetchOne(
                db,
                sql: """
                  SELECT * FROM audit_events
                   WHERE entity='dining_tables' AND action='update'
                   ORDER BY id DESC LIMIT 1
                  """
            )
            let payload = try payloadJSON(a)
            XCTAssertEqual(payload["from_status"] as? String, "open")
            XCTAssertEqual(payload["to_status"] as? String, "open")
        }
    }

    func testPatchNoChangeThrows() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanup(path: path) }

        _ = try repo.create(input: DiningTableCreateInput(id: "T1", name: "Window 1"), context: ctx())
        XCTAssertThrowsError(
            try repo.update(id: "T1", patch: DiningTablePatch(cookId: "alice"), context: ctx())
        ) { XCTAssertEqual($0 as? DiningTableWriteError, .noChange) }
    }

    func testPatchOtherLocationThrowsNotFound() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanup(path: path) }

        _ = try repo.create(input: DiningTableCreateInput(id: "T1", name: "A"), context: ctx(locationId: "kitchen-a"))
        XCTAssertThrowsError(
            try repo.update(id: "T1", patch: DiningTablePatch(status: "seated"), context: ctx(locationId: "kitchen-b"))
        ) { XCTAssertEqual($0 as? DiningTableWriteError, .notFound) }
    }

    func testCombinedStatusAndNameUpdatesBoth() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }

        _ = try repo.create(input: DiningTableCreateInput(id: "T1", name: "old"), context: ctx())
        try repo.update(id: "T1", patch: DiningTablePatch(status: "dirty", name: "renamed"), context: ctx())

        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM dining_tables WHERE id='T1'")
            XCTAssertEqual(row?["status"], "dirty")
            XCTAssertEqual(row?["name"], "renamed")
        }
    }

    func testCapacityUpdateValid() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }

        _ = try repo.create(input: DiningTableCreateInput(id: "T1", name: "X", capacity: 4), context: ctx())
        try repo.update(id: "T1", patch: DiningTablePatch(capacity: 8), context: ctx())
        try writeDB.pool.read { db in
            let cap = try Int.fetchOne(db, sql: "SELECT capacity FROM dining_tables WHERE id='T1'")
            XCTAssertEqual(cap, 8)
        }
    }

    func testCapacityUpdateOutOfRangeThrows() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanup(path: path) }

        _ = try repo.create(input: DiningTableCreateInput(id: "T1", name: "X", capacity: 4), context: ctx())
        XCTAssertThrowsError(
            try repo.update(id: "T1", patch: DiningTablePatch(capacity: 0), context: ctx())
        ) { XCTAssertEqual($0 as? DiningTableWriteError, .capacityOutOfRange) }
    }

    // ── DELETE /api/dining-tables/:id ────────────────────────────────────

    func testDeleteRemovesRowAndWritesDeleteAudit() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }

        _ = try repo.create(input: DiningTableCreateInput(id: "T1", name: "Window 1"), context: ctx())
        try repo.delete(id: "T1", context: ctx())

        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM dining_tables WHERE id='T1'")
            XCTAssertNil(row)
            let a = try Row.fetchOne(
                db,
                sql: """
                  SELECT * FROM audit_events
                   WHERE entity='dining_tables' AND action='delete'
                   ORDER BY id DESC LIMIT 1
                  """
            )
            XCTAssertNotNil(a)
            let payload = try payloadJSON(a)
            XCTAssertEqual(payload["id"] as? String, "T1")
        }
    }

    func testDeleteMissingRowThrowsNotFound() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanup(path: path) }

        XCTAssertThrowsError(
            try repo.delete(id: "NOPE", context: ctx())
        ) { XCTAssertEqual($0 as? DiningTableWriteError, .notFound) }
    }

    func testDeleteOtherLocationThrowsNotFoundAndRowSurvives() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }

        _ = try repo.create(input: DiningTableCreateInput(id: "T1", name: "A"), context: ctx(locationId: "kitchen-a"))
        XCTAssertThrowsError(
            try repo.delete(id: "T1", context: ctx(locationId: "kitchen-b"))
        ) { XCTAssertEqual($0 as? DiningTableWriteError, .notFound) }
        try writeDB.pool.read { db in
            let row = try Row.fetchOne(
                db, sql: "SELECT * FROM dining_tables WHERE id='T1' AND location_id='kitchen-a'"
            )
            XCTAssertNotNil(row, "row at kitchen-a must survive")
        }
    }

    // ── floor page: open reservations today (app/floor/page.jsx) ─────────

    func testOpenReservationsTodayReturnsBookedOnly() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }

        try await writeDB.pool.write { db in
            try db.execute(sql: """
                INSERT INTO reservations (party_name, party_size, reservation_at, status, location_id) VALUES
                  ('Booked A', 2, '2026-07-02 19:00', 'booked', 'default'),
                  ('Booked B', 4, '2026-07-02 18:00', 'booked', 'default'),
                  ('Seated',   2, '2026-07-02 17:00', 'seated', 'default'),
                  ('Tomorrow', 2, '2026-07-03 19:00', 'booked', 'default'),
                  ('OtherLoc', 2, '2026-07-02 19:00', 'booked', 'kitchen-b');
                """)
        }
        let rows = try await repo.openReservationsToday(locationId: "default", today: "2026-07-02")
        // Booked-only, today-only, ORDER BY reservation_at ASC.
        XCTAssertEqual(rows.map(\.partyName), ["Booked B", "Booked A"])
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private func ctx(locationId: String = "default") -> RegulatedWriteContext {
        RegulatedWriteContext.nativeCook(cookId: "alice", locationId: locationId)
    }

    private func payloadJSON(_ row: Row?) throws -> [String: Any] {
        let raw: String = row?["payload_json"] ?? "{}"
        let obj = try JSONSerialization.jsonObject(with: Data(raw.utf8))
        return obj as? [String: Any] ?? [:]
    }

    private func makeRepo() throws -> (DiningTablesRepository, LariatWriteDatabase, String) {
        let path = try seedFloorDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (DiningTablesRepository(readDB: readDB, writeDB: writeDB), writeDB, path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

/// Web schema (lib/db.ts) for the tables this board touches.
func seedFloorDatabase() throws -> String {
    let dir = NSTemporaryDirectory() + "lariat-floor-" + UUID().uuidString
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let path = (dir as NSString).appendingPathComponent("lariat.db")
    let pool = try DatabasePool(path: path)
    try pool.write { db in
        try db.execute(sql: """
            CREATE TABLE dining_tables (
              id TEXT NOT NULL,
              name TEXT NOT NULL,
              capacity INTEGER NOT NULL DEFAULT 2,
              x REAL NOT NULL DEFAULT 0,
              y REAL NOT NULL DEFAULT 0,
              w REAL NOT NULL DEFAULT 1,
              h REAL NOT NULL DEFAULT 1,
              status TEXT NOT NULL DEFAULT 'open'
                CHECK(status IN ('open','seated','dirty','closed')),
              notes TEXT,
              location_id TEXT NOT NULL DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now')),
              updated_at TEXT DEFAULT (datetime('now')),
              PRIMARY KEY (location_id, id)
            );
            CREATE TABLE reservations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              party_name TEXT NOT NULL,
              party_size INTEGER NOT NULL,
              reservation_at TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'booked'
                CHECK(status IN ('booked','seated','completed','cancelled','no_show')),
              table_id TEXT,
              phone TEXT,
              email TEXT,
              notes TEXT,
              source TEXT DEFAULT 'manual',
              source_ref TEXT,
              seated_at TEXT,
              completed_at TEXT,
              cook_id TEXT,
              location_id TEXT NOT NULL DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now')),
              updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE audit_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              actor_cook_id TEXT,
              actor_source TEXT NOT NULL,
              entity TEXT NOT NULL,
              entity_id INTEGER,
              action TEXT NOT NULL,
              replaces_id INTEGER,
              payload_json TEXT,
              note TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            """)
    }
    return path
}
