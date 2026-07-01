import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of `app/api/wage-notices/route.js` against an in-memory
// (on-disk temp) GRDB fixture seeded with the REAL `wage_notices` (incl. the
// reason/pay_basis CHECKs) + `audit_events`. Pins:
//   sign      → insert + one audit (actor_source native_mac, note "reason:pay_basis")
//   tipped    → tip_credit_cents persists
//   validation→ .validationFailed (bad reason, tip-credit-on-non-tipped, bad
//               signed_on, missing cook_id), nothing written
//   GET       → latest-per-cook board + freshness; single-cook history + refresh;
//               ghost cook → has_notice false / needs_new true; stale (>365) flagged
final class WageNoticeRepositoryTests: XCTestCase {

    private func macContext(locationId: String = "default", actor: String? = "mgr-1") -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: actor,
            actorSource: RegulatedWriteContext.nativeMacActorSource,
            locationId: locationId,
            shiftDate: "2026-07-01"
        )
    }

    private func input(
        cook: String? = "alice", reason: String? = "hire", basis: String? = "hourly",
        wage: Int? = 1500, tip: Int? = nil, signedOn: String? = "2026-01-01"
    ) -> WageNoticeSignInput {
        WageNoticeSignInput(cookId: cook, reason: reason, payBasis: basis, wageRateCents: wage, tipCreditCents: tip, signedOn: signedOn)
    }

    // ── sign (persist + native_mac audit) ──────────────────────────────

    func testSignPersistsAndEmitsInsertAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = WageNoticeRepository(readDB: readDB, writeDB: writeDB)

        let row = try repo.sign(input: input(), context: macContext())
        XCTAssertEqual(row.cookId, "alice")
        XCTAssertEqual(row.reason, .hire)
        XCTAssertEqual(row.wageRateCents, 1500)

        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM wage_notices") ?? 0, 1)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='wage_notices'") ?? 0, 1)
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT action FROM audit_events LIMIT 1"), "insert")
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events LIMIT 1"), "native_mac")
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT note FROM audit_events LIMIT 1"), "hire:hourly")
        }
    }

    func testTippedNoticePersistsTipCredit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = WageNoticeRepository(readDB: readDB, writeDB: writeDB)
        let row = try repo.sign(input: input(basis: "tipped", tip: 302), context: macContext())
        XCTAssertEqual(row.payBasis, .tipped)
        XCTAssertEqual(row.tipCreditCents, 302)
    }

    // ── validation → nothing written ────────────────────────────────────

    func testRejectsBadReason() throws { try assertRejected(input(reason: "promotion")) }
    func testRejectsTipCreditOnNonTipped() throws { try assertRejected(input(basis: "hourly", tip: 302)) }
    func testRejectsMalformedSignedOn() throws { try assertRejected(input(signedOn: "2026-1-1")) }
    func testRejectsMissingCookId() throws { try assertRejected(input(cook: "   ")) }

    private func assertRejected(_ bad: WageNoticeSignInput) throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = WageNoticeRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.sign(input: bad, context: macContext())) { error in
            guard let e = error as? WageNoticeWriteError, case .validationFailed = e else {
                return XCTFail("expected .validationFailed, got \(error)")
            }
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM wage_notices") ?? -1, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
        }
    }

    // ── GET — latest-per-cook board ─────────────────────────────────────

    func testLoadBoardLatestPerCook() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = WageNoticeRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.sign(input: input(cook: "alice", reason: "hire", wage: 1500, signedOn: "2026-01-01"), context: macContext())
        _ = try repo.sign(input: input(cook: "alice", reason: "rate_change", wage: 1600, signedOn: "2026-06-01"), context: macContext())
        _ = try repo.sign(input: input(cook: "bob", reason: "hire", wage: 1400, signedOn: "2026-05-01"), context: macContext())

        let board = try await repo.loadBoard(today: "2026-07-01")
        XCTAssertEqual(board.latestPerCook.count, 2)                 // one row per cook
        let alice = board.latestPerCook.first { $0.cookId == "alice" }!
        XCTAssertEqual(alice.wageRateCents, 1600)                    // the newer notice wins
        XCTAssertEqual(alice.signedOn, "2026-06-01")
        XCTAssertEqual(board.freshness.count, 2)
    }

    // ── GET — single-cook history + refresh + ghost + stale ─────────────

    func testLoadHistoryAndRefresh() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = WageNoticeRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.sign(input: input(cook: "alice", signedOn: "2026-01-01"), context: macContext())
        _ = try repo.sign(input: input(cook: "alice", reason: "annual", signedOn: "2026-06-01"), context: macContext())

        let h = try await repo.loadHistory(cookId: "alice", today: "2026-07-01")
        XCTAssertEqual(h.history.count, 2)
        XCTAssertEqual(h.latest?.signedOn, "2026-06-01")            // history is latest-first
        XCTAssertTrue(h.freshness.hasNotice)
        XCTAssertFalse(h.refreshRequired.required)                 // ~30 days, within window
    }

    func testGhostCookHistory() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = WageNoticeRepository(readDB: readDB, writeDB: writeDB)
        let h = try await repo.loadHistory(cookId: "nobody", today: "2026-07-01")
        XCTAssertTrue(h.history.isEmpty)
        XCTAssertNil(h.latest)
        XCTAssertFalse(h.freshness.hasNotice)
        XCTAssertTrue(h.freshness.needsNew)
        XCTAssertTrue(h.refreshRequired.required)                  // no notice → hire required
    }

    func testStaleNoticeFlaggedOver365() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = WageNoticeRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.sign(input: input(cook: "old", signedOn: "2024-01-01"), context: macContext())
        let board = try await repo.loadBoard(today: "2026-07-01")
        let fresh = board.freshness.first { $0.cookId == "old" }!
        XCTAssertTrue(fresh.needsNew)                              // way over 365 days
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedWageNoticeDatabase()
        return (try LariatDatabase(path: path), try LariatWriteDatabase(path: path), path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedWageNoticeDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-wagenotice-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        // Mirror the REAL web schema from lib/db.ts (~L2873), incl. the CHECKs.
        try db.execute(sql: """
            CREATE TABLE wage_notices (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT DEFAULT 'default',
              cook_id TEXT NOT NULL,
              reason TEXT NOT NULL CHECK(reason IN ('hire','rate_change','annual','law_change','other')),
              wage_rate_cents INTEGER NOT NULL,
              pay_basis TEXT NOT NULL CHECK(pay_basis IN ('hourly','salary','commission','tipped')),
              tip_credit_cents INTEGER,
              document_path TEXT,
              signed_on TEXT NOT NULL,
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
