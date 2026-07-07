import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of tests/js/test-prep-tasks-api.mjs against a real GRDB
// fixture seeded with the prep_tasks + audit_events schema from lib/db.ts.
// Covers POST (create + audit, blank reject), PATCH (claim/start/done lifecycle,
// cross-location 404), and DELETE (delete + audit). actor_source diverges to
// native_cook (web uses cook_ui) per the native write-discipline contract.

final class PrepRepositoryTests: XCTestCase {

    // MARK: - POST /api/prep-tasks

    func testCreateWritesTaskAndAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)

        let row = try repo.create(
            input: PrepTaskCreateInput(
                task: "Dice tomatoes", shiftDate: "2099-05-28", stationId: "prep",
                qty: "2 qt", priority: 1, assignedCookId: "maria",
                source: "manual", cookId: "maria"
            ),
            context: .nativeCook(cookId: "maria", locationId: "default")
        )
        XCTAssertGreaterThan(row.id, 0)
        XCTAssertEqual(row.task, "Dice tomatoes")
        XCTAssertEqual(row.qty, "2 qt")
        XCTAssertEqual(row.assignedCookId, "maria")
        XCTAssertEqual(row.status, "todo")
        XCTAssertEqual(row.priority, 1)

        try writeDB.pool.read { db in
            XCTAssertEqual(countAudit(db, "insert"), 1)
            let source = try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events WHERE entity='prep_tasks' LIMIT 1")
            XCTAssertEqual(source, "native_cook")
        }
    }

    func testCreateRejectsBlankTaskWritesNothing() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)

        XCTAssertThrowsError(
            try repo.create(
                input: PrepTaskCreateInput(task: "   ", shiftDate: "2099-05-28"),
                context: .nativeCook(cookId: nil)
            )
        ) { error in
            XCTAssertEqual(error as? PrepTaskWriteError, .taskRequired)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM prep_tasks") ?? -1, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
        }
    }

    func testCreateClampsPriorityAndDefaultsSource() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)

        let row = try repo.create(
            input: PrepTaskCreateInput(task: "Slice onions", priority: 9),
            context: .nativeCook(cookId: nil)
        )
        XCTAssertEqual(row.priority, 2)         // clamped to rush
        XCTAssertEqual(row.source, "manual")    // default source
    }

    // MARK: - PATCH /api/prep-tasks/:id

    func testClaimStartCompleteInPlace() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.create(
            input: PrepTaskCreateInput(task: "Make ranch", shiftDate: "2099-05-28"),
            context: .nativeCook(cookId: nil)
        ).id

        let ctx = RegulatedWriteContext.nativeCook(cookId: "ana", locationId: "default")

        let claimed = try repo.patch(id: id, input: .claimBy("ana"), context: ctx)
        XCTAssertEqual(claimed.assignedCookId, "ana")
        XCTAssertEqual(claimed.status, "todo")

        let started = try repo.patch(id: id, input: .status("in_progress", cookId: "ana"), context: ctx)
        XCTAssertEqual(started.status, "in_progress")
        XCTAssertNotNil(started.startedAt)

        let done = try repo.patch(id: id, input: .status("done", cookId: "ana"), context: ctx)
        XCTAssertEqual(done.status, "done")
        XCTAssertEqual(done.doneBy, "ana")
        XCTAssertNotNil(done.doneAt)

        try writeDB.pool.read { db in
            XCTAssertEqual(countAudit(db, "update"), 3)
        }
    }

    func testReleaseClearsClaim() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: "ana", locationId: "default")
        let id = try repo.create(
            input: PrepTaskCreateInput(task: "Portion", assignedCookId: "ana"),
            context: ctx
        ).id

        let released = try repo.patch(id: id, input: .releaseClaim(cookId: "ana"), context: ctx)
        XCTAssertNil(released.assignedCookId)
    }

    func testClaimAndReleaseTogetherRejected() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: "ana", locationId: "default")
        let id = try repo.create(input: PrepTaskCreateInput(task: "x"), context: ctx).id

        XCTAssertThrowsError(
            try repo.patch(id: id, input: PrepTaskPatchInput(claim: true, release: true, cookId: "ana"), context: ctx)
        ) { error in
            XCTAssertEqual(error as? PrepTaskWriteError, .claimAndRelease)
        }
    }

    func testClaimWithoutCookRejected() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: nil, locationId: "default")
        let id = try repo.create(input: PrepTaskCreateInput(task: "x"), context: ctx).id

        XCTAssertThrowsError(
            try repo.patch(id: id, input: PrepTaskPatchInput(claim: true, cookId: nil), context: ctx)
        ) { error in
            XCTAssertEqual(error as? PrepTaskWriteError, .cookRequired)
        }
    }

    func testBadStatusRejected() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: "ana", locationId: "default")
        let id = try repo.create(input: PrepTaskCreateInput(task: "x"), context: ctx).id

        XCTAssertThrowsError(
            try repo.patch(id: id, input: .status("banana", cookId: "ana"), context: ctx)
        ) { error in
            XCTAssertEqual(error as? PrepTaskWriteError, .badStatus)
        }
    }

    func testEmptyPatchRejected() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: "ana", locationId: "default")
        let id = try repo.create(input: PrepTaskCreateInput(task: "x"), context: ctx).id

        XCTAssertThrowsError(
            try repo.patch(id: id, input: PrepTaskPatchInput(cookId: "ana"), context: ctx)
        ) { error in
            XCTAssertEqual(error as? PrepTaskWriteError, .nothingToSave)
        }
    }

    func testReopenClearsStartedAndDone() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: "ana", locationId: "default")
        let id = try repo.create(input: PrepTaskCreateInput(task: "x"), context: ctx).id
        _ = try repo.patch(id: id, input: .status("done", cookId: "ana"), context: ctx)

        let reopened = try repo.patch(id: id, input: .status("todo", cookId: "ana"), context: ctx)
        XCTAssertEqual(reopened.status, "todo")
        XCTAssertNil(reopened.startedAt)
        XCTAssertNil(reopened.doneAt)
        XCTAssertNil(reopened.doneBy)
    }

    func testPatchCrossLocation404NoMutation() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        let barCtx = RegulatedWriteContext.nativeCook(cookId: "ana", locationId: "bar")
        let id = try repo.create(
            input: PrepTaskCreateInput(task: "Cut limes", shiftDate: "2099-05-28"),
            context: barCtx
        ).id

        let kitchenCtx = RegulatedWriteContext.nativeCook(cookId: "ana", locationId: "kitchen")
        XCTAssertThrowsError(
            try repo.patch(id: id, input: .status("done", cookId: "ana"), context: kitchenCtx)
        ) { error in
            XCTAssertEqual(error as? PrepTaskWriteError, .notFound)
        }
        try writeDB.pool.read { db in
            let status = try String.fetchOne(db, sql: "SELECT status FROM prep_tasks WHERE id=?", arguments: [id])
            XCTAssertEqual(status, "todo")
            XCTAssertEqual(countAudit(db, "update"), 0)
        }
    }

    // MARK: - DELETE /api/prep-tasks/:id

    func testDeleteInLocationAudits() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: "km", locationId: "default")
        let id = try repo.create(
            input: PrepTaskCreateInput(task: "Portion sauce", shiftDate: "2099-05-28"),
            context: ctx
        ).id

        try repo.delete(id: id, context: ctx)
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM prep_tasks WHERE id=?", arguments: [id]) ?? -1, 0)
            XCTAssertEqual(countAudit(db, "delete"), 1)
        }
    }

    func testDeleteCrossLocation404() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.create(
            input: PrepTaskCreateInput(task: "keep me"),
            context: .nativeCook(cookId: nil, locationId: "bar")
        ).id

        XCTAssertThrowsError(
            try repo.delete(id: id, context: .nativeCook(cookId: nil, locationId: "kitchen"))
        ) { error in
            XCTAssertEqual(error as? PrepTaskWriteError, .notFound)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM prep_tasks WHERE id=?", arguments: [id]) ?? -1, 1)
        }
    }

    // MARK: - load() board snapshot

    func testLoadGroupsOpenAndBinsClosed() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: nil, locationId: "default")

        _ = try repo.create(input: PrepTaskCreateInput(task: "open at prep", shiftDate: "2099-05-28", stationId: "prep"), context: ctx)
        let doneId = try repo.create(input: PrepTaskCreateInput(task: "finish me", shiftDate: "2099-05-28", stationId: "prep"), context: ctx).id
        _ = try repo.patch(id: doneId, input: .status("done", cookId: nil), context: ctx)

        let stations = [KitchenStation(id: "prep", name: "Prep", line: nil, lineCheckKey: nil)]
        let snap = try await repo.load(date: "2099-05-28", locationId: "default", stations: stations)
        XCTAssertEqual(snap.openGroups.count, 1)
        XCTAssertEqual(snap.openGroups.first?.stationName, "Prep")
        XCTAssertEqual(snap.openGroups.first?.tasks.map(\.task), ["open at prep"])
        XCTAssertEqual(snap.closed.map(\.task), ["finish me"])
        XCTAssertEqual(snap.counts.todo, 1)
        XCTAssertEqual(snap.counts.done, 1)
    }

    func testLoadScopedToLocation() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.create(input: PrepTaskCreateInput(task: "default task", shiftDate: "2099-05-28"), context: .nativeCook(cookId: nil, locationId: "default"))
        _ = try repo.create(input: PrepTaskCreateInput(task: "bar task", shiftDate: "2099-05-28"), context: .nativeCook(cookId: nil, locationId: "bar"))

        let snap = try await repo.load(date: "2099-05-28", locationId: "bar", stations: [])
        let allTasks = snap.openGroups.flatMap(\.tasks) + snap.closed
        XCTAssertEqual(allTasks.map(\.task), ["bar task"])
    }

    // MARK: - audit payload shape (C1 verify-41 T12)

    /// The named rule "update audit carries {before, after}, delete carries the
    /// before row" (web PATCH route `payload:{before,after}` / DELETE
    /// `payload:before`) was implemented but no test read `payload_json`. Pin it.
    func testPatchUpdateAuditCarriesBeforeAfterPayload() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: "ana", locationId: "default")
        let id = try repo.create(input: PrepTaskCreateInput(task: "Make ranch", shiftDate: "2099-05-28"), context: .nativeCook(cookId: nil)).id
        _ = try repo.patch(id: id, input: .claimBy("ana"), context: ctx)
        _ = try repo.patch(id: id, input: .status("in_progress", cookId: "ana"), context: ctx)

        try writeDB.pool.read { db in
            let json = try String.fetchOne(db, sql: "SELECT payload_json FROM audit_events WHERE entity='prep_tasks' AND action='update' ORDER BY id DESC LIMIT 1")
            let obj = try XCTUnwrap(Self.parse(json))
            let before = try XCTUnwrap(obj["before"] as? [String: Any], "update payload must carry a before object")
            let after = try XCTUnwrap(obj["after"] as? [String: Any], "update payload must carry an after object")
            XCTAssertEqual(before["status"] as? String, "todo")
            XCTAssertEqual(after["status"] as? String, "in_progress")
        }
    }

    func testDeleteAuditCarriesBareBeforeRowPayload() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: "ana", locationId: "default")
        let id = try repo.create(input: PrepTaskCreateInput(task: "Portion greens", shiftDate: "2099-05-28"), context: ctx).id
        try repo.delete(id: id, context: ctx)

        try writeDB.pool.read { db in
            let json = try String.fetchOne(db, sql: "SELECT payload_json FROM audit_events WHERE entity='prep_tasks' AND action='delete' ORDER BY id DESC LIMIT 1")
            let obj = try XCTUnwrap(Self.parse(json))
            // The delete payload is the bare before-row, NOT a {before,after} wrapper.
            XCTAssertNil(obj["before"], "delete payload must be the bare row, not before/after")
            XCTAssertEqual(obj["task"] as? String, "Portion greens")
            XCTAssertEqual((obj["id"] as? NSNumber)?.int64Value, id)
        }
    }

    private static func parse(_ json: String?) -> [String: Any]? {
        guard let json, let data = json.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    // MARK: - helpers

    private func countAudit(_ db: Database, _ action: String) -> Int {
        (try? Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='prep_tasks' AND action=?", arguments: [action])) ?? -1
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedPrepDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (readDB, writeDB, path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedPrepDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-prep-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        // prep_tasks + audit_events verbatim from lib/db.ts (schema read as-is).
        try db.execute(sql: """
            CREATE TABLE prep_tasks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              station_id TEXT,
              task TEXT NOT NULL,
              qty TEXT,
              recipe_slug TEXT,
              notes TEXT,
              priority INTEGER DEFAULT 0,
              assigned_cook_id TEXT,
              status TEXT NOT NULL DEFAULT 'todo'
                CHECK(status IN ('todo','in_progress','done','skipped')),
              started_at TEXT,
              done_at TEXT,
              done_by TEXT,
              source TEXT DEFAULT 'manual',
              source_ref TEXT,
              sort_order INTEGER DEFAULT 0,
              location_id TEXT NOT NULL DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now')),
              updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE audit_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              entity TEXT NOT NULL,
              entity_id INTEGER,
              action TEXT NOT NULL,
              actor_cook_id TEXT,
              actor_source TEXT NOT NULL,
              replaces_id INTEGER,
              payload_json TEXT,
              note TEXT,
              shift_date TEXT,
              location_id TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            """)
    }
    return path
}
