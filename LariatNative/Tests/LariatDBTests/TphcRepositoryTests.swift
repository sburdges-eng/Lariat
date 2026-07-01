import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of tests/js/test-tphc-api.mjs + test-tphc-patch-idor.mjs
// against an in-memory (on-disk temp) GRDB fixture seeded with the real
// tphc_entries + audit_events schema. Exercises POST (start + audit, cutoff
// math, validation 400), PATCH (discard + audit update, 404 unknown, 409
// double-discard, 404 cross-location IDOR guard with no mutation), and load().

final class TphcRepositoryTests: XCTestCase {
    private let t0 = "2026-04-20T10:00:00.000Z"
    private let hotCutoff = "2026-04-20T14:00:00.000Z"    // +4h
    private let coldCutoff = "2026-04-20T16:00:00.000Z"   // +6h

    // ── POST happy paths ────────────────────────────────────────────────

    func testStartHotPersistsCutoffPlus4hAndEmitsOneAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)

        let row = try repo.start(
            input: TphcStartInput(item: "taco bar proteins", startedAt: t0, kind: "hot_time_only", cookId: "alice"),
            context: .nativeCook(cookId: "alice")
        )
        XCTAssertEqual(row.item, "taco bar proteins")
        XCTAssertEqual(row.startedAt, t0)
        XCTAssertEqual(row.cutoffAt, hotCutoff)
        XCTAssertNil(row.discardedAt)

        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM tphc_entries") ?? 0, 1)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='tphc_entries' AND action='insert'") ?? 0, 1)
            let audit = try Row.fetchOne(db, sql: "SELECT * FROM audit_events WHERE entity='tphc_entries' AND action='insert' LIMIT 1")
            XCTAssertEqual(audit?["actor_cook_id"], "alice")
            XCTAssertEqual(audit?["actor_source"], "native_cook")
            XCTAssertEqual(Int64.fromDatabaseValue(audit!["entity_id"]), row.id)
            let note: String? = audit?["note"]
            XCTAssertTrue(note?.contains("hot_time_only") == true)
            XCTAssertTrue(note?.contains(hotCutoff) == true)
        }
    }

    func testStartColdPersistsCutoffPlus6h() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)

        let row = try repo.start(
            input: TphcStartInput(item: "sliced tomato mise", startedAt: t0, kind: "cold_time_only", cookId: "bob"),
            context: .nativeCook(cookId: "bob")
        )
        XCTAssertEqual(row.cutoffAt, coldCutoff)
    }

    func testBatchRefAndStationRoundTrip() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)

        let row = try repo.start(
            input: TphcStartInput(item: "carnitas", startedAt: t0, kind: "hot_time_only",
                                  stationId: "hot_hold_1", batchRef: "BATCH-2026-04-20-A", cookId: "alice"),
            context: .nativeCook(cookId: "alice")
        )
        XCTAssertEqual(row.batchRef, "BATCH-2026-04-20-A")
        XCTAssertEqual(row.stationId, "hot_hold_1")
    }

    func testShiftDateHonorsExplicitValue() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)

        let row = try repo.start(
            input: TphcStartInput(item: "queso", startedAt: t0, kind: "hot_time_only", shiftDate: "2026-04-19"),
            context: .nativeCook(cookId: nil)
        )
        XCTAssertEqual(row.shiftDate, "2026-04-19")
    }

    // ── POST validation (web 400) ───────────────────────────────────────

    func testStartRejectsEmptyItemWritesNothing() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)

        XCTAssertThrowsError(
            try repo.start(input: TphcStartInput(item: "", startedAt: t0, kind: "hot_time_only"), context: .nativeCook(cookId: nil))
        ) { error in
            guard case TphcWriteError.validationFailed = (error as? TphcWriteError) ?? .persistenceFailed else {
                return XCTFail("expected validationFailed")
            }
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM tphc_entries") ?? 0, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? 0, 0)
        }
    }

    func testStartRejectsNonISOStartedAt() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.start(input: TphcStartInput(item: "taco bar", startedAt: "yesterday", kind: "hot_time_only"), context: .nativeCook(cookId: nil))
        )
    }

    func testStartRejectsUnknownKind() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.start(input: TphcStartInput(item: "taco bar", startedAt: t0, kind: "warm_time_only"), context: .nativeCook(cookId: nil))
        ) { error in
            guard case TphcWriteError.validationFailed(let msg) = (error as? TphcWriteError) ?? .persistenceFailed else {
                return XCTFail("expected validationFailed")
            }
            XCTAssertTrue(msg.contains("kind must be one of"))
        }
    }

    // ── PATCH discard flow ──────────────────────────────────────────────

    func testDiscardSetsDiscardedAtAndEmitsUpdateAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)

        for reason in TphcDiscardReason.allCases.map(\.rawValue) {
            let id = try repo.start(input: TphcStartInput(item: "taco bar", startedAt: t0, kind: "hot_time_only"), context: .nativeCook(cookId: nil)).id
            try writeDB.pool.write { db in try db.execute(sql: "DELETE FROM audit_events") }

            let updated = try repo.discard(
                input: TphcDiscardInput(id: id, discardReason: reason, cookId: "alice"),
                context: .nativeCook(cookId: nil)
            )
            XCTAssertEqual(updated.discardReason, reason)
            XCTAssertNotNil(updated.discardedAt)

            try writeDB.pool.read { db in
                let updates = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='tphc_entries' AND action='update'") ?? 0
                XCTAssertEqual(updates, 1)
                let note = try String.fetchOne(db, sql: "SELECT note FROM audit_events WHERE entity='tphc_entries' AND action='update' LIMIT 1")
                XCTAssertEqual(note, "discarded: \(reason)")
                let entityId = try Int64.fetchOne(db, sql: "SELECT entity_id FROM audit_events WHERE entity='tphc_entries' AND action='update' LIMIT 1")
                XCTAssertEqual(entityId, id)
            }
        }
    }

    func testDiscardRejectsMissingReason() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.start(input: TphcStartInput(item: "taco bar", startedAt: t0, kind: "hot_time_only"), context: .nativeCook(cookId: nil)).id
        XCTAssertThrowsError(
            try repo.discard(input: TphcDiscardInput(id: id, discardReason: ""), context: .nativeCook(cookId: nil))
        ) { error in
            guard case TphcWriteError.validationFailed(let msg) = (error as? TphcWriteError) ?? .persistenceFailed else {
                return XCTFail("expected validationFailed")
            }
            XCTAssertTrue(msg.contains("discard_reason must be one of"))
        }
    }

    func testDiscardRejectsUnknownReason() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.start(input: TphcStartInput(item: "taco bar", startedAt: t0, kind: "hot_time_only"), context: .nativeCook(cookId: nil)).id
        XCTAssertThrowsError(
            try repo.discard(input: TphcDiscardInput(id: id, discardReason: "bored_of_it"), context: .nativeCook(cookId: nil))
        )
    }

    func testDiscardRejectsZeroOrNegativeId() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.discard(input: TphcDiscardInput(id: 0, discardReason: "consumed"), context: .nativeCook(cookId: nil))
        ) { error in
            guard case TphcWriteError.validationFailed = (error as? TphcWriteError) ?? .persistenceFailed else {
                return XCTFail("expected validationFailed")
            }
        }
    }

    func testDiscardUnknownIdThrowsNotFound() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.discard(input: TphcDiscardInput(id: 9999, discardReason: "consumed"), context: .nativeCook(cookId: nil))
        ) { error in
            XCTAssertEqual(error as? TphcWriteError, .notFound)
        }
    }

    func testDoubleDiscardThrowsAlreadyDiscardedAndDoesNotChangeReason() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.start(input: TphcStartInput(item: "taco bar", startedAt: t0, kind: "hot_time_only"), context: .nativeCook(cookId: nil)).id

        _ = try repo.discard(input: TphcDiscardInput(id: id, discardReason: "consumed"), context: .nativeCook(cookId: nil))

        XCTAssertThrowsError(
            try repo.discard(input: TphcDiscardInput(id: id, discardReason: "quality"), context: .nativeCook(cookId: nil))
        ) { error in
            guard case TphcWriteError.alreadyDiscarded(let entry) = (error as? TphcWriteError) ?? .persistenceFailed else {
                return XCTFail("expected alreadyDiscarded")
            }
            XCTAssertEqual(entry.discardReason, "consumed")
        }

        try writeDB.pool.read { db in
            let reason = try String.fetchOne(db, sql: "SELECT discard_reason FROM tphc_entries WHERE id=?", arguments: [id])
            XCTAssertEqual(reason, "consumed")
        }
    }

    // ── PATCH cross-location IDOR guard → notFound, no mutation ─────────
    //
    // Mirrors tests/js/test-tphc-patch-idor.mjs: a cook scoped to site-b must
    // not be able to discard a site-a batch by guessing the numeric id. 404
    // (notFound), NOT 403 — existence at another site must not leak.

    func testCrossLocationDiscardRejectedAsNotFoundNoMutation() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)

        // Start a batch at site-a.
        let id = try repo.start(
            input: TphcStartInput(item: "taco bar", startedAt: t0, kind: "hot_time_only"),
            context: .nativeCook(cookId: nil, locationId: "site-a")
        ).id

        // site-b cook tries to discard the site-a batch.
        XCTAssertThrowsError(
            try repo.discard(
                input: TphcDiscardInput(id: id, discardReason: "consumed", cookId: "mallory"),
                context: .nativeCook(cookId: "mallory", locationId: "site-b")
            )
        ) { error in
            XCTAssertEqual(error as? TphcWriteError, .notFound)
        }

        // Row at site-a was NOT mutated, and no update audit event emitted.
        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM tphc_entries WHERE id=?", arguments: [id])
            XCTAssertNil(row?["discarded_at"] as String?)
            XCTAssertNil(row?["discard_reason"] as String?)
            XCTAssertEqual(row?["location_id"], "site-a")
            let updates = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='tphc_entries' AND action='update'") ?? 0
            XCTAssertEqual(updates, 0)
        }
    }

    func testCrossLocationMatchAllowsDiscard() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.start(
            input: TphcStartInput(item: "taco bar", startedAt: t0, kind: "hot_time_only"),
            context: .nativeCook(cookId: nil, locationId: "site-a")
        ).id

        let updated = try repo.discard(
            input: TphcDiscardInput(id: id, discardReason: "consumed", cookId: "alice"),
            context: .nativeCook(cookId: "alice", locationId: "site-a")
        )
        XCTAssertEqual(updated.discardReason, "consumed")
        XCTAssertNotNil(updated.discardedAt)

        try writeDB.pool.read { db in
            let updates = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='tphc_entries' AND action='update'") ?? 0
            XCTAssertEqual(updates, 1)
        }
    }

    func testDefaultLocationCompatDiscard() throws {
        // POST without location_id (→ 'default'), PATCH without a location (→ 'default') → allowed.
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.start(
            input: TphcStartInput(item: "taco bar", startedAt: t0, kind: "hot_time_only"),
            context: .nativeCook(cookId: nil, locationId: "default")
        ).id
        let updated = try repo.discard(
            input: TphcDiscardInput(id: id, discardReason: "consumed"),
            context: .nativeCook(cookId: nil, locationId: "default")
        )
        XCTAssertEqual(updated.locationId, "default")
        XCTAssertEqual(updated.discardReason, "consumed")
    }

    // ── load() board snapshot ───────────────────────────────────────────

    func testLoadListsActiveExcludesDiscardedAndScopesByLocation() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)

        // Two batches at default: discard one.
        let a = try repo.start(input: TphcStartInput(item: "a", startedAt: t0, kind: "hot_time_only", shiftDate: "2026-04-20"), context: .nativeCook(cookId: nil, locationId: "default", shiftDate: "2026-04-20"))
        _ = try repo.start(input: TphcStartInput(item: "b", startedAt: t0, kind: "cold_time_only", shiftDate: "2026-04-20"), context: .nativeCook(cookId: nil, locationId: "default", shiftDate: "2026-04-20"))
        _ = try repo.discard(input: TphcDiscardInput(id: a.id, discardReason: "consumed"), context: .nativeCook(cookId: nil, locationId: "default"))
        // One batch at south location — must not appear in default snapshot.
        _ = try repo.start(input: TphcStartInput(item: "south", startedAt: t0, kind: "hot_time_only"), context: .nativeCook(cookId: nil, locationId: "lariat-south"))

        let snap = try await repo.load(date: "2026-04-20", locationId: "default", now: "2026-04-20T11:00:00.000Z")
        XCTAssertEqual(snap.active.count, 1)
        XCTAssertEqual(snap.active.first?.item, "b")
        XCTAssertEqual(snap.scan.count, 1)
        XCTAssertEqual(snap.scan.first?.status, .ok)
        XCTAssertEqual(snap.recent.count, 1)
        XCTAssertEqual(snap.recent.first?.item, "a")
    }

    func testLoadScanClassifiesWarningAndExpired() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.start(input: TphcStartInput(item: "hot", startedAt: t0, kind: "hot_time_only"), context: .nativeCook(cookId: nil, locationId: "default"))
        _ = try repo.start(input: TphcStartInput(item: "cold", startedAt: t0, kind: "cold_time_only"), context: .nativeCook(cookId: nil, locationId: "default"))

        // now = 13:45Z → hot cutoff 14:00 → 15m left (warning); cold cutoff 16:00 → 135m (ok).
        var snap = try await repo.load(locationId: "default", now: "2026-04-20T13:45:00.000Z")
        let hot1 = snap.scan.first { $0.item == "hot" }
        let cold1 = snap.scan.first { $0.item == "cold" }
        XCTAssertEqual(hot1?.status, .warning)
        XCTAssertEqual(hot1?.minutesUntilCutoff, 15)
        XCTAssertEqual(cold1?.status, .ok)

        // now = 15:00Z → hot expired (-60m), cold ok (60m). Sort: most-past-due first.
        snap = try await repo.load(locationId: "default", now: "2026-04-20T15:00:00.000Z")
        XCTAssertEqual(snap.scan.first?.item, "hot")
        XCTAssertEqual(snap.scan.first?.status, .expired)
        XCTAssertEqual(snap.scan.first { $0.item == "cold" }?.status, .ok)
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedTphcDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (readDB, writeDB, path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedTphcDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-tphc-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        // tphc_entries schema copied verbatim from lib/db.ts (no migration).
        try db.execute(sql: """
            CREATE TABLE tphc_entries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              station_id TEXT,
              item TEXT NOT NULL,
              batch_ref TEXT,
              started_at TEXT NOT NULL,
              cutoff_at TEXT NOT NULL,
              discarded_at TEXT,
              discard_reason TEXT,
              cook_id TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX idx_tphc_open
              ON tphc_entries(location_id, cutoff_at)
              WHERE discarded_at IS NULL;
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
