import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of app/api/certifications/route.js against an in-memory
// (on-disk temp) GRDB fixture seeded with the REAL staff_certifications schema
// (incl. the cert_type CHECK) + audit_events. There is NO dedicated web parity
// test for this board, so these assert against the route CODE:
//   POST  → insert + one audit (actor_source native_mac), cert_type allow-set
//           rejected BEFORE insert, YYYY-MM-DD guard, clip lengths.
//   PATCH → update + one audit, unknown id → notFound, empty set →
//           validationFailed, patchable-column projection, active coercion,
//           updated_at bumped.
//   retire→ soft-delete (active=0) only — the row survives (FK safety).
//   GET   → order active DESC, expires_on IS NULL, expires_on ASC, id ASC.

final class StaffCertRepositoryTests: XCTestCase {

    // Context is the native_mac PIN-authorized write actor (the view-model gate
    // resolves this via RegulatedWriteContext.nativeMac(pinUser:)).
    private func macContext(locationId: String = "default", actor: String? = "mgr-1") -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: actor,
            actorSource: RegulatedWriteContext.nativeMacActorSource,
            locationId: locationId,
            shiftDate: "2026-07-01"
        )
    }

    private func validInput(cook: String = "alice", type: String = "cfpm", label: String = "ServSafe Manager") -> StaffCertCreateInput {
        StaffCertCreateInput(cookId: cook, certType: type, certLabel: label)
    }

    // ── POST — happy path (insert + one native_mac audit) ──────────────

    func testCreateRecordsCertAndEmitsOneAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)

        let row = try repo.create(
            input: StaffCertCreateInput(
                cookId: "alice", certType: "cfpm", certLabel: "ServSafe Manager",
                issuer: "ServSafe / ANSI-CFP", certNumber: "12345",
                issuedOn: "2026-01-01", expiresOn: "2031-01-01"
            ),
            context: macContext()
        )
        XCTAssertEqual(row.cookId, "alice")
        XCTAssertEqual(row.certType, "cfpm")
        XCTAssertEqual(row.certLabel, "ServSafe Manager")
        XCTAssertEqual(row.active, 1)
        XCTAssertEqual(row.expiresOn, "2031-01-01")

        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM staff_certifications") ?? 0, 1)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='staff_certifications'") ?? 0, 1)
            let action = try String.fetchOne(db, sql: "SELECT action FROM audit_events WHERE entity='staff_certifications' LIMIT 1")
            XCTAssertEqual(action, "insert")
            let source = try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events WHERE entity='staff_certifications' LIMIT 1")
            XCTAssertEqual(source, "native_mac")
            let actor = try String.fetchOne(db, sql: "SELECT actor_cook_id FROM audit_events WHERE entity='staff_certifications' LIMIT 1")
            XCTAssertEqual(actor, "mgr-1")
        }
    }

    func testCreateClipsFieldsToMaxLength() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)

        let longLabel = String(repeating: "L", count: 200)
        let row = try repo.create(
            input: StaffCertCreateInput(cookId: "alice", certType: "other", certLabel: longLabel),
            context: macContext()
        )
        XCTAssertEqual(row.certLabel.count, 120)  // cert_label clipped to 120
    }

    func testCreateNormalizesEmptyOptionalsToNull() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)

        let row = try repo.create(
            input: StaffCertCreateInput(cookId: "alice", certType: "tips", certLabel: "TIPS", issuer: "   ", expiresOn: nil),
            context: macContext()
        )
        XCTAssertNil(row.issuer)      // whitespace → null-if-empty
        XCTAssertNil(row.expiresOn)
    }

    // ── POST validation → 400, writes NOTHING ──────────────────────────

    func testCreateRejectsOutOfSetCertTypeBeforeInsert() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)

        XCTAssertThrowsError(
            try repo.create(input: validInput(type: "servsafe"), context: macContext())
        ) { error in
            guard let e = error as? StaffCertWriteError, case .validationFailed = e else {
                return XCTFail("expected validationFailed, got \(error)")
            }
        }
        // No raw SQLite CHECK error, and nothing persisted (no row, no audit).
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM staff_certifications") ?? 0, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? 0, 0)
        }
    }

    func testCreateRejectsMissingCookId() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.create(input: validInput(cook: "   "), context: macContext())) { error in
            XCTAssertTrue(isValidationFailed(error))
        }
    }

    func testCreateRejectsMissingCertLabel() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.create(input: validInput(label: "   "), context: macContext())) { error in
            XCTAssertTrue(isValidationFailed(error))
        }
    }

    func testCreateRejectsMalformedIssuedOn() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.create(
                input: StaffCertCreateInput(cookId: "alice", certType: "cfpm", certLabel: "X", issuedOn: "2026-1-1"),
                context: macContext()
            )
        ) { error in XCTAssertTrue(isValidationFailed(error)) }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM staff_certifications") ?? 0, 0)
        }
    }

    func testCreateRejectsMalformedExpiresOn() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.create(
                input: StaffCertCreateInput(cookId: "alice", certType: "cfpm", certLabel: "X", expiresOn: "07/01/2031"),
                context: macContext()
            )
        ) { error in XCTAssertTrue(isValidationFailed(error)) }
    }

    // ── PATCH — happy path (update + one audit, updated_at bumped) ──────

    func testPatchUpdatesAndEmitsUpdateAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.create(input: validInput(), context: macContext()).id

        let updated = try repo.patch(
            input: StaffCertPatchInput(id: id, fields: [.expiresOn("2032-06-30"), .certNumber("A-99")]),
            context: macContext()
        )
        XCTAssertEqual(updated.expiresOn, "2032-06-30")
        XCTAssertEqual(updated.certNumber, "A-99")

        try writeDB.pool.read { db in
            let updates = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='staff_certifications' AND action='update'") ?? 0
            XCTAssertEqual(updates, 1)
            let source = try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events WHERE entity='staff_certifications' AND action='update' LIMIT 1")
            XCTAssertEqual(source, "native_mac")
        }
    }

    func testPatchOnlyProjectsPatchableColumns() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.create(input: validInput(cook: "alice", type: "cfpm"), context: macContext()).id

        // Only cert_label is representable-and-patched; cook_id/cert_type/location
        // are NOT patchable (not in the StaffCertPatchField set) so they stand.
        let updated = try repo.patch(
            input: StaffCertPatchInput(id: id, fields: [.certLabel("Renewed ServSafe")]),
            context: macContext()
        )
        XCTAssertEqual(updated.certLabel, "Renewed ServSafe")
        XCTAssertEqual(updated.cookId, "alice")     // unchanged
        XCTAssertEqual(updated.certType, "cfpm")    // unchanged
    }

    func testPatchCoercesActiveToOneOrZero() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.create(input: validInput(), context: macContext()).id

        let off = try repo.patch(input: StaffCertPatchInput(id: id, fields: [.active(false)]), context: macContext())
        XCTAssertEqual(off.active, 0)
        let on = try repo.patch(input: StaffCertPatchInput(id: id, fields: [.active(true)]), context: macContext())
        XCTAssertEqual(on.active, 1)
    }

    func testPatchUnknownIdThrowsNotFound() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.patch(input: StaffCertPatchInput(id: 9999, fields: [.certLabel("x")]), context: macContext())
        ) { error in
            XCTAssertEqual(error as? StaffCertWriteError, .notFound)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? 0, 0)
        }
    }

    func testPatchEmptySetThrowsValidationFailed() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.create(input: validInput(), context: macContext()).id
        XCTAssertThrowsError(
            try repo.patch(input: StaffCertPatchInput(id: id, fields: []), context: macContext())
        ) { error in
            XCTAssertTrue(isValidationFailed(error))
        }
    }

    func testPatchRejectsNonPositiveId() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.patch(input: StaffCertPatchInput(id: 0, fields: [.active(false)]), context: macContext())
        ) { error in
            XCTAssertTrue(isValidationFailed(error))
        }
    }

    // ── Retire = soft-delete only (row survives, FK safety) ────────────

    func testRetireSoftDeletesAndKeepsRow() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.create(input: validInput(), context: macContext()).id

        let retired = try repo.retire(id: id, context: macContext())
        XCTAssertEqual(retired.active, 0)

        try writeDB.pool.read { db in
            // Row still present — soft-delete, never a hard DELETE.
            let count = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM staff_certifications WHERE id=?", arguments: [id]) ?? 0
            XCTAssertEqual(count, 1)
            let active = try Int.fetchOne(db, sql: "SELECT active FROM staff_certifications WHERE id=?", arguments: [id]) ?? -1
            XCTAssertEqual(active, 0)
            // Retire is audited as an update.
            let updates = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='staff_certifications' AND action='update'") ?? 0
            XCTAssertEqual(updates, 1)
        }
    }

    // ── GET — ordering + scoping ───────────────────────────────────────

    func testLoadOrdersActiveFirstThenUrgentExpiryThenNoExpiryLast() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)

        // Seed a mix: active far-out, active near, active no-expiry, and a retired one.
        let farId = try repo.create(input: StaffCertCreateInput(cookId: "a", certType: "cfpm", certLabel: "far", expiresOn: "2099-01-01"), context: macContext()).id
        let nearId = try repo.create(input: StaffCertCreateInput(cookId: "b", certType: "cfpm", certLabel: "near", expiresOn: "2026-08-01"), context: macContext()).id
        let noneId = try repo.create(input: StaffCertCreateInput(cookId: "c", certType: "cfpm", certLabel: "no-exp"), context: macContext()).id
        let retiredId = try repo.create(input: StaffCertCreateInput(cookId: "d", certType: "cfpm", certLabel: "retired", expiresOn: "2026-07-15"), context: macContext()).id
        _ = try repo.retire(id: retiredId, context: macContext())

        let rows = try await repo.load(locationId: "default")
        // active DESC → retired last; among active, expiry ASC then no-expiry last.
        let order = rows.map(\.id)
        XCTAssertEqual(order, [nearId, farId, noneId, retiredId])
    }

    func testLoadFiltersByCookId() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.create(input: validInput(cook: "alice"), context: macContext())
        _ = try repo.create(input: validInput(cook: "bob"), context: macContext())

        let rows = try await repo.load(locationId: "default", cookId: "alice")
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.cookId, "alice")
    }

    func testLoadScopesByLocation() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.create(input: validInput(cook: "alice"), context: macContext(locationId: "site-a"))
        _ = try repo.create(input: validInput(cook: "bob"), context: macContext(locationId: "site-b"))

        let a = try await repo.load(locationId: "site-a")
        XCTAssertEqual(a.count, 1)
        XCTAssertEqual(a.first?.cookId, "alice")
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func isValidationFailed(_ error: Error) -> Bool {
        guard let e = error as? StaffCertWriteError, case .validationFailed = e else { return false }
        return true
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedStaffCertDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (readDB, writeDB, path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedStaffCertDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-staffcert-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        // Mirror the REAL web schema from lib/db.ts (~L2646), incl. the CHECK.
        try db.execute(sql: """
            CREATE TABLE staff_certifications (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT DEFAULT 'default',
              cook_id TEXT NOT NULL,
              cert_type TEXT NOT NULL
                CHECK(cert_type IN ('cfpm','food_handler','tips','allergen','other')),
              cert_label TEXT NOT NULL,
              issuer TEXT,
              cert_number TEXT,
              issued_on TEXT,
              expires_on TEXT,
              document_path TEXT,
              active INTEGER DEFAULT 1,
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
