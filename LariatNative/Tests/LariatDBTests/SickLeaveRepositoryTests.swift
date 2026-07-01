import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of `app/api/sick-leave/route.js` against an in-memory
// (on-disk temp) GRDB fixture seeded with the REAL `paid_sick_leave_balances`
// schema + `audit_events`. Pins the route semantics:
//   accrual  → insert (first) / update (repeat) audit, actor_source native_mac
//   cap 422  → throws .capReached, NO row change + NO audit (rollback)
//   use      → update audit; use-over 422 → throws .notEnough, nothing written
//   400s     → .validationFailed (missing cook_id, bad year, non-positive hours,
//              malformed dated_on), nothing written
//   front-load (`hours` only) respects the 48h cap (× 30 synthesis)
//   GET      → loadBalance (single + zero-default + events), listBalances (cook_id ASC)
final class SickLeaveRepositoryTests: XCTestCase {

    private func macContext(locationId: String = "default", actor: String? = "mgr-1") -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: actor,
            actorSource: RegulatedWriteContext.nativeMacActorSource,
            locationId: locationId,
            shiftDate: "2026-07-01"
        )
    }

    // ── accrual (insert → update audit; native_mac) ────────────────────

    func testAccrualInsertsAndEmitsInsertAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickLeaveRepository(readDB: readDB, writeDB: writeDB)

        let result = try repo.accrue(
            input: SickLeaveAccrualInput(cookId: "alice", accrualYear: 2026, hoursWorked: 240, datedOn: "2026-07-01"),
            context: macContext()
        )
        XCTAssertEqual(result.kind, .accrual)
        XCTAssertEqual(result.hoursApplied, 8)          // 240 / 30
        XCTAssertEqual(result.balance.hoursAccrued, 8)

        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM paid_sick_leave_balances") ?? 0, 1)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='paid_sick_leave_balances'") ?? 0, 1)
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT action FROM audit_events LIMIT 1"), "insert")
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events LIMIT 1"), "native_mac")
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT last_accrued_on FROM paid_sick_leave_balances LIMIT 1"), "2026-07-01")
        }
    }

    func testSecondAccrualEmitsUpdateAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickLeaveRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.accrue(input: SickLeaveAccrualInput(cookId: "alice", accrualYear: 2026, hoursWorked: 30), context: macContext())
        let second = try repo.accrue(input: SickLeaveAccrualInput(cookId: "alice", accrualYear: 2026, hoursWorked: 30), context: macContext())
        XCTAssertEqual(second.balance.hoursAccrued, 2)

        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM paid_sick_leave_balances") ?? 0, 1)  // upsert, one row
            let actions = try String.fetchAll(db, sql: "SELECT action FROM audit_events ORDER BY id")
            XCTAssertEqual(actions, ["insert", "update"])
        }
    }

    // ── cap reached → 422, no row change + no audit ────────────────────

    func testCapReachedAccrualThrowsAndWritesNothing() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickLeaveRepository(readDB: readDB, writeDB: writeDB)
        // Bring the balance exactly to the 48h cap (1440 / 30 = 48).
        _ = try repo.accrue(input: SickLeaveAccrualInput(cookId: "alice", accrualYear: 2026, hoursWorked: 1440), context: macContext())

        XCTAssertThrowsError(
            try repo.accrue(input: SickLeaveAccrualInput(cookId: "alice", accrualYear: 2026, hoursWorked: 30), context: macContext())
        ) { error in
            guard let e = error as? SickLeaveWriteError, case .capReached = e else {
                return XCTFail("expected .capReached, got \(error)")
            }
        }
        try writeDB.pool.read { db in
            // Row unchanged at 48, and only the first accrual's audit exists.
            XCTAssertEqual(try Double.fetchOne(db, sql: "SELECT hours_accrued FROM paid_sick_leave_balances LIMIT 1"), 48)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 1)
        }
    }

    // ── use (update audit) + use-over (422, nothing written) ───────────

    func testUseWithinBalanceEmitsUseAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickLeaveRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.accrue(input: SickLeaveAccrualInput(cookId: "alice", accrualYear: 2026, hoursWorked: 240), context: macContext())  // 8h

        let used = try repo.use(input: SickLeaveUseInput(cookId: "alice", accrualYear: 2026, hours: 4), context: macContext())
        XCTAssertEqual(used.kind, .use)
        XCTAssertEqual(used.balance.hoursUsed, 4)
        XCTAssertEqual(used.balance.hoursAvailable, 4)

        try writeDB.pool.read { db in
            // A "use" audit row (note begins with the kind).
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE note LIKE 'use%'") ?? 0, 1)
        }
    }

    func testUseOverBalanceThrowsAndWritesNothing() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickLeaveRepository(readDB: readDB, writeDB: writeDB)
        // Fresh cook: no balance → use must throw and leave no row/audit (shell rolls back).
        XCTAssertThrowsError(
            try repo.use(input: SickLeaveUseInput(cookId: "ghost", accrualYear: 2026, hours: 8), context: macContext())
        ) { error in
            guard let e = error as? SickLeaveWriteError, case .notEnough = e else {
                return XCTFail("expected .notEnough, got \(error)")
            }
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM paid_sick_leave_balances") ?? -1, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
        }
    }

    // ── validation (400) → validationFailed, nothing written ───────────

    func testAccrualRejectsMissingCookId() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickLeaveRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.accrue(input: SickLeaveAccrualInput(cookId: "   ", accrualYear: 2026, hoursWorked: 30), context: macContext())) {
            XCTAssertTrue(isValidationFailed($0))
        }
    }

    func testAccrualRejectsYearOutOfRange() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickLeaveRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.accrue(input: SickLeaveAccrualInput(cookId: "alice", accrualYear: 1999, hoursWorked: 30), context: macContext())) {
            XCTAssertTrue(isValidationFailed($0))
        }
    }

    func testUseRejectsNonPositiveHours() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickLeaveRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.use(input: SickLeaveUseInput(cookId: "alice", accrualYear: 2026, hours: 0), context: macContext())) {
            XCTAssertTrue(isValidationFailed($0))
        }
    }

    func testAccrualRejectsMalformedDatedOn() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickLeaveRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.accrue(input: SickLeaveAccrualInput(cookId: "alice", accrualYear: 2026, hoursWorked: 30, datedOn: "2026-7-1"), context: macContext())) {
            XCTAssertTrue(isValidationFailed($0))
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM paid_sick_leave_balances") ?? -1, 0)
        }
    }

    // ── front-load respects the 48h cap (hours-only → × 30) ────────────

    func testFrontLoadRespectsCap() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickLeaveRepository(readDB: readDB, writeDB: writeDB)
        // Front-load 50h directly — drivingHoursWorked = 50 * 30 = 1500 → clipped to 48.
        let r = try repo.accrue(input: SickLeaveAccrualInput(cookId: "alice", accrualYear: 2026, hours: 50), context: macContext())
        XCTAssertEqual(r.balance.hoursAccrued, 48)
        // A second front-load → cap reached, throws, nothing further written.
        XCTAssertThrowsError(try repo.accrue(input: SickLeaveAccrualInput(cookId: "alice", accrualYear: 2026, hours: 50), context: macContext())) {
            guard let e = $0 as? SickLeaveWriteError, case .capReached = e else { return XCTFail("expected .capReached") }
        }
    }

    // ── GET — single balance (+ zero default + events) and list ────────

    func testLoadBalanceSingleZeroDefaultAndEvents() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickLeaveRepository(readDB: readDB, writeDB: writeDB)

        // Absent cook → zero-balance default, no events.
        let ghost = try await repo.loadBalance(cookId: "nobody", accrualYear: 2026)
        XCTAssertEqual(ghost.balance.hoursAvailable, 0)
        XCTAssertEqual(ghost.balance.capHours, 48)
        XCTAssertTrue(ghost.events.isEmpty)

        _ = try repo.accrue(input: SickLeaveAccrualInput(cookId: "alice", accrualYear: 2026, hoursWorked: 60), context: macContext())
        let single = try await repo.loadBalance(cookId: "alice", accrualYear: 2026)
        XCTAssertEqual(single.balance.hoursAccrued, 2)
        XCTAssertEqual(single.events.count, 1)              // the accrual audit
        XCTAssertEqual(single.events.first?.action, "insert")
    }

    func testListBalancesOrderedByCookId() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = SickLeaveRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.accrue(input: SickLeaveAccrualInput(cookId: "charlie", accrualYear: 2026, hoursWorked: 30), context: macContext())
        _ = try repo.accrue(input: SickLeaveAccrualInput(cookId: "alice", accrualYear: 2026, hoursWorked: 30), context: macContext())
        _ = try repo.accrue(input: SickLeaveAccrualInput(cookId: "bob", accrualYear: 2026, hoursWorked: 30), context: macContext())

        let list = try await repo.listBalances(accrualYear: 2026)
        XCTAssertEqual(list.map(\.cookId), ["alice", "bob", "charlie"])
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func isValidationFailed(_ error: Error) -> Bool {
        guard let e = error as? SickLeaveWriteError, case .validationFailed = e else { return false }
        return true
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedSickLeaveDatabase()
        return (try LariatDatabase(path: path), try LariatWriteDatabase(path: path), path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedSickLeaveDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-sickleave-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        // Mirror the REAL web schema from lib/db.ts (~L2820).
        try db.execute(sql: """
            CREATE TABLE paid_sick_leave_balances (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT DEFAULT 'default',
              cook_id TEXT NOT NULL,
              accrual_year INTEGER NOT NULL,
              hours_accrued REAL DEFAULT 0,
              hours_used REAL DEFAULT 0,
              cap_hours REAL DEFAULT 48,
              carryover_hours REAL DEFAULT 0,
              last_accrued_on TEXT,
              created_at TEXT DEFAULT (datetime('now')),
              updated_at TEXT DEFAULT (datetime('now')),
              UNIQUE(location_id, cook_id, accrual_year)
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
