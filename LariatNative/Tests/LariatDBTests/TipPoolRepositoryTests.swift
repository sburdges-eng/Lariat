import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of `app/api/tip-pool/route.js` against an in-memory
// (on-disk temp) GRDB fixture seeded with the REAL `tip_pool_distributions`
// (incl. the kind CHECK) + `staff_flags` + `audit_events` schemas. Pins:
//   add       → insert + one audit (actor_source native_mac)
//   validation→ .validationFailed (unknown kind, missing pool_ref/cook_id,
//               negative amount, bad shift_date), nothing written
//   §3.4 gate → active manager/owner flag (or excluded role) + tip_pool →
//               .poolIneligible, NO row + NO audit; service_charge/direct_tip
//               are NEVER gated; an EXPIRED flag does not block
//   GET       → rows + summarizePool + pool_ref filter
final class TipPoolRepositoryTests: XCTestCase {

    private let day = "2026-07-01"

    private func macContext(locationId: String = "default", actor: String? = "mgr-1") -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: actor,
            actorSource: RegulatedWriteContext.nativeMacActorSource,
            locationId: locationId,
            shiftDate: day
        )
    }

    private func input(cook: String = "alice", kind: String = "tip_pool", cents: Int = 2000, role: String? = nil, pool: String? = "lunch", date: String? = "2026-07-01") -> TipDistributionInput {
        TipDistributionInput(shiftDate: date, poolRef: pool, cookId: cook, role: role, kind: kind, amountCents: cents, note: nil)
    }

    // ── add (persist + native_mac audit) ───────────────────────────────

    func testAddPersistsAndEmitsInsertAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TipPoolRepository(readDB: readDB, writeDB: writeDB)

        let result = try repo.add(input: input(cents: 2500), context: macContext())
        XCTAssertEqual(result.entry.amountCents, 2500)
        XCTAssertEqual(result.entry.kind, .tip_pool)

        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM tip_pool_distributions") ?? 0, 1)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='tip_pool_distributions'") ?? 0, 1)
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT action FROM audit_events LIMIT 1"), "insert")
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events LIMIT 1"), "native_mac")
        }
    }

    func testServiceChargeAndDirectTipPersist() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TipPoolRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.add(input: input(kind: "service_charge"), context: macContext())
        _ = try repo.add(input: input(kind: "direct_tip"), context: macContext())
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM tip_pool_distributions") ?? 0, 2)
        }
    }

    // ── validation → nothing written ────────────────────────────────────

    func testAddRejectsUnknownKind() throws {
        try assertRejected(input(kind: "gratuity"))
    }
    func testAddRejectsMissingPoolRef() throws {
        try assertRejected(input(pool: "   "))
    }
    func testAddRejectsMissingCookId() throws {
        try assertRejected(input(cook: "   "))
    }
    func testAddRejectsNegativeAmount() throws {
        try assertRejected(input(cents: -1))
    }
    func testAddRejectsBadShiftDate() throws {
        try assertRejected(input(date: "2026-7-1"))
    }

    private func assertRejected(_ badInput: TipDistributionInput) throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TipPoolRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.add(input: badInput, context: macContext())) { error in
            guard let e = error as? TipPoolWriteError, case .validationFailed = e else {
                return XCTFail("expected .validationFailed, got \(error)")
            }
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM tip_pool_distributions") ?? -1, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
        }
    }

    // ── COMPS §3.4 eligibility (only gates tip_pool) ────────────────────

    func testTipPoolBlockedForActiveManagerFlag() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        try insertFlag(writeDB, cookId: "boss", flag: "manager")   // active (effective_to NULL)
        let repo = TipPoolRepository(readDB: readDB, writeDB: writeDB)

        XCTAssertThrowsError(try repo.add(input: input(cook: "boss", kind: "tip_pool"), context: macContext())) { error in
            guard let e = error as? TipPoolWriteError, case .poolIneligible(let citation) = e else {
                return XCTFail("expected .poolIneligible, got \(error)")
            }
            XCTAssertTrue(citation.contains("3.4"))
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM tip_pool_distributions") ?? -1, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
        }
    }

    func testServiceChargeAllowedForManagerFlag() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        try insertFlag(writeDB, cookId: "boss", flag: "manager")
        let repo = TipPoolRepository(readDB: readDB, writeDB: writeDB)
        // service_charge is NEVER gated — a manager may receive it.
        _ = try repo.add(input: input(cook: "boss", kind: "service_charge"), context: macContext())
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM tip_pool_distributions") ?? 0, 1)
        }
    }

    func testExpiredManagerFlagAllowsTipPool() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        try insertFlag(writeDB, cookId: "exboss", flag: "manager", effectiveTo: "2025-01-01")  // expired
        let repo = TipPoolRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.add(input: input(cook: "exboss", kind: "tip_pool"), context: macContext())
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM tip_pool_distributions") ?? 0, 1)
        }
    }

    func testExcludedRoleBlocksTipPool() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TipPoolRepository(readDB: readDB, writeDB: writeDB)
        // No flag, but the on-shift role is a manager → excluded.
        XCTAssertThrowsError(try repo.add(input: input(cook: "cook7", kind: "tip_pool", role: "Manager"), context: macContext())) { error in
            guard let e = error as? TipPoolWriteError, case .poolIneligible = e else {
                return XCTFail("expected .poolIneligible, got \(error)")
            }
        }
    }

    // ── GET — rows + summary + pool_ref filter ──────────────────────────

    func testLoadPoolRowsSummaryAndPoolRefFilter() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TipPoolRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.add(input: input(cook: "alice", kind: "tip_pool", cents: 4000, pool: "lunch"), context: macContext())
        _ = try repo.add(input: input(cook: "alice", kind: "service_charge", cents: 2500, pool: "lunch"), context: macContext())
        _ = try repo.add(input: input(cook: "bob", kind: "tip_pool", cents: 1000, pool: "dinner"), context: macContext())

        let all = try await repo.loadPool(date: day)
        XCTAssertEqual(all.rows.count, 3)
        XCTAssertEqual(all.summary.totalCents, 7500)
        XCTAssertEqual(all.summary.byCook["alice"], 6500)
        XCTAssertEqual(all.summary.byKind[.tip_pool], 5000)
        XCTAssertEqual(all.summary.byKind[.service_charge], 2500)
        XCTAssertEqual(all.comps.tipCreditCents, 302)

        let lunch = try await repo.loadPool(date: day, poolRef: "lunch")
        XCTAssertEqual(lunch.rows.count, 2)
        XCTAssertEqual(lunch.summary.totalCents, 6500)
    }

    func testLoadPoolEmptyReturnsZeroedByKind() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = TipPoolRepository(readDB: readDB, writeDB: writeDB)
        let pool = try await repo.loadPool(date: day)
        XCTAssertTrue(pool.rows.isEmpty)
        XCTAssertEqual(pool.summary.totalCents, 0)
        XCTAssertEqual(pool.summary.byKind[.tip_pool], 0)   // explicit zero, not absent
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func insertFlag(_ writeDB: LariatWriteDatabase, cookId: String, flag: String, location: String = "default", effectiveTo: String? = nil) throws {
        try writeDB.pool.write { db in
            try db.execute(
                sql: "INSERT INTO staff_flags (location_id, cook_id, flag, effective_from, effective_to) VALUES (?, ?, ?, '2026-01-01', ?)",
                arguments: [location, cookId, flag, effectiveTo]
            )
        }
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedTipPoolDatabase()
        return (try LariatDatabase(path: path), try LariatWriteDatabase(path: path), path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedTipPoolDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-tippool-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        // Mirror the REAL web schema from lib/db.ts (~L2839), incl. the kind CHECK.
        try db.execute(sql: """
            CREATE TABLE tip_pool_distributions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              pool_ref TEXT NOT NULL,
              cook_id TEXT NOT NULL,
              role TEXT,
              kind TEXT NOT NULL CHECK(kind IN ('tip_pool','service_charge','direct_tip')),
              amount_cents INTEGER NOT NULL,
              note TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE staff_flags (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT DEFAULT 'default',
              cook_id TEXT NOT NULL,
              flag TEXT NOT NULL,
              effective_from TEXT NOT NULL,
              effective_to TEXT,
              note TEXT,
              created_at TEXT DEFAULT (datetime('now'))
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
