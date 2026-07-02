import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Repository-parity port of tests/js/test-sds-api.mjs — route-level behavior for
// /api/sds against a real in-memory GRDB fixture DB (never a mock). Exercises the
// POST happy path (row + audit written in one tx), validator 400s surfaced as
// SdsWriteError.validationFailed, and the GET listing (active only, product_name ASC).

final class SdsRepositoryTests: XCTestCase {

    // ── POST — happy path ─────────────────────────────────────────────

    func testRegisterWritesRowAndAuditInOneTransaction() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = SdsRepository(readDB: readDB, writeDB: writeDB)
        let row = try repo.register(
            input: SdsInput(
                productName: "Quat Sanitizer 256",
                manufacturer: "Ecolab",
                hazardClass: "corrosive",
                storageLocation: "Chemical closet — line",
                url: "https://example.com/sds/quat256.pdf",
                lastReviewed: "2026-04-01",
                cookId: "alice"
            ),
            context: RegulatedWriteContext.nativeCook(cookId: "alice")
        )
        XCTAssertEqual(row.productName, "Quat Sanitizer 256")
        XCTAssertEqual(row.hazardClass, "corrosive")
        XCTAssertEqual(row.active, 1)

        try writeDB.pool.read { db in
            let sdsCount = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM sds_registry") ?? 0
            XCTAssertEqual(sdsCount, 1)
            let auditCount = try Int.fetchOne(
                db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='sds_registry'"
            ) ?? 0
            XCTAssertEqual(auditCount, 1)
            let action = try String.fetchOne(
                db, sql: "SELECT action FROM audit_events WHERE entity='sds_registry'"
            )
            XCTAssertEqual(action, "insert")
            let actorCook = try String.fetchOne(
                db, sql: "SELECT actor_cook_id FROM audit_events WHERE entity='sds_registry'"
            )
            XCTAssertEqual(actorCook, "alice")
            let actorSource = try String.fetchOne(
                db, sql: "SELECT actor_source FROM audit_events WHERE entity='sds_registry'"
            )
            XCTAssertEqual(actorSource, RegulatedWriteContext.nativeCookActorSource)
        }
    }

    func testDefaultsActiveAndLastReviewedWhenOmitted() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = SdsRepository(readDB: readDB, writeDB: writeDB)
        let row = try repo.register(
            input: SdsInput(productName: "Degreaser X"),
            context: RegulatedWriteContext.nativeCook(cookId: nil)
        )
        XCTAssertEqual(row.active, 1)
        XCTAssertNotNil(row.lastReviewed)
        XCTAssertFalse(row.lastReviewed!.isEmpty)
    }

    func testActiveFalseInsertsInactiveRow() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = SdsRepository(readDB: readDB, writeDB: writeDB)
        let row = try repo.register(
            input: SdsInput(productName: "Retired Chem", active: false),
            context: RegulatedWriteContext.nativeCook(cookId: nil)
        )
        XCTAssertEqual(row.active, 0)
    }

    // ── POST — validation (web 400) ───────────────────────────────────

    func testMissingProductNameRejectedAndNoRowWritten() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = SdsRepository(readDB: readDB, writeDB: writeDB)
        assertValidationFailure(
            { try repo.register(input: SdsInput(manufacturer: "Ecolab"),
                                context: RegulatedWriteContext.nativeCook(cookId: nil)) },
            contains: "product_name is required"
        )
        try assertNoRows(writeDB)
    }

    func testWhitespaceProductNameRejected() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = SdsRepository(readDB: readDB, writeDB: writeDB)
        assertValidationFailure(
            { try repo.register(input: SdsInput(productName: "   "),
                                context: RegulatedWriteContext.nativeCook(cookId: nil)) }
        )
        try assertNoRows(writeDB)
    }

    func testNonGhsHazardClassRejected() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = SdsRepository(readDB: readDB, writeDB: writeDB)
        assertValidationFailure(
            { try repo.register(input: SdsInput(productName: "Mystery Goo", hazardClass: "spooky"),
                                context: RegulatedWriteContext.nativeCook(cookId: nil)) }
        )
        try assertNoRows(writeDB)
    }

    func testNonHttpUrlRejected() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = SdsRepository(readDB: readDB, writeDB: writeDB)
        assertValidationFailure(
            { try repo.register(input: SdsInput(productName: "Mystery Goo", url: "file:///tmp/sheet.pdf"),
                                context: RegulatedWriteContext.nativeCook(cookId: nil)) }
        )
        try assertNoRows(writeDB)
    }

    func testNonIsoLastReviewedRejected() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = SdsRepository(readDB: readDB, writeDB: writeDB)
        assertValidationFailure(
            { try repo.register(input: SdsInput(productName: "Mystery Goo", lastReviewed: "04/01/2026"),
                                context: RegulatedWriteContext.nativeCook(cookId: nil)) }
        )
        try assertNoRows(writeDB)
    }

    // ── GET ───────────────────────────────────────────────────────────

    func testLoadListsActiveOnlyOrderedByProductName() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = SdsRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: nil)
        _ = try repo.register(input: SdsInput(productName: "Zebra Cleaner"), context: ctx)
        _ = try repo.register(input: SdsInput(productName: "Apple Wash"), context: ctx)
        _ = try repo.register(input: SdsInput(productName: "Retired Chem", active: false), context: ctx)

        let snap = try await repo.load(locationId: "default")
        XCTAssertEqual(snap.rows.count, 2)
        XCTAssertEqual(snap.rows[0].productName, "Apple Wash")
        XCTAssertEqual(snap.rows[1].productName, "Zebra Cleaner")
    }

    func testLoadScopesToLocation() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = SdsRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.register(
            input: SdsInput(productName: "Site-A Chem"),
            context: RegulatedWriteContext.nativeCook(cookId: nil, locationId: "site-a")
        )
        _ = try repo.register(
            input: SdsInput(productName: "Site-B Chem"),
            context: RegulatedWriteContext.nativeCook(cookId: nil, locationId: "site-b")
        )

        let siteA = try await repo.load(locationId: "site-a")
        XCTAssertEqual(siteA.rows.count, 1)
        XCTAssertEqual(siteA.rows[0].productName, "Site-A Chem")
    }

    // ── helpers ───────────────────────────────────────────────────────

    private func assertValidationFailure(
        _ block: () throws -> Void,
        contains needle: String? = nil,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertThrowsError(try block(), file: file, line: line) { error in
            guard case .validationFailed(let msg)? = error as? SdsWriteError else {
                XCTFail("expected SdsWriteError.validationFailed, got \(error)", file: file, line: line)
                return
            }
            if let needle {
                XCTAssertTrue(msg.contains(needle), "expected \(msg) to contain \(needle)", file: file, line: line)
            }
        }
    }

    private func assertNoRows(_ writeDB: LariatWriteDatabase) throws {
        try writeDB.pool.read { db in
            let sds = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM sds_registry") ?? -1
            XCTAssertEqual(sds, 0)
            let audit = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1
            XCTAssertEqual(audit, 0)
        }
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lariat-sds-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("lariat.db").path
        // DatabasePool establishes WAL mode so the read-only LariatDatabase pool can open it.
        let seed = try DatabasePool(path: path)
        try seed.write { db in
            try db.execute(sql: """
                CREATE TABLE sds_registry (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT DEFAULT 'default',
                  product_name TEXT NOT NULL,
                  manufacturer TEXT,
                  hazard_class TEXT,
                  storage_location TEXT,
                  pdf_path TEXT,
                  url TEXT,
                  last_reviewed TEXT,
                  active INTEGER DEFAULT 1,
                  notes TEXT,
                  created_at TEXT DEFAULT (datetime('now'))
                );
                CREATE INDEX idx_sds_active ON sds_registry(location_id, active);
                CREATE TABLE audit_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  shift_date TEXT,
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
                """)
        }
        return (try LariatDatabase(path: path), try LariatWriteDatabase(path: path), path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}
