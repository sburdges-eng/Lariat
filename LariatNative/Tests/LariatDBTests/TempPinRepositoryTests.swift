import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Behavior-parity port of `tests/js/test-temp-pin-routes.mjs` (issue / list /
/// revoke) against `TempPinRepository` on the real web schema. The route's
/// master-PIN cookie gate maps to the ViewModel's `ManagementWrite.requireSession`;
/// these tests assert the storage / audit / one-time-PIN invariants.
final class TempPinRepositoryTests: XCTestCase {
    private let ctx = RegulatedWriteContext.nativeMac(pinUser: nil)

    private func futureISO(minutesAhead: Double = 60) -> String {
        TempPinRules.canonicalISO(from: Date().addingTimeInterval(minutesAhead * 60))
    }

    private func pastISO(minutesAgo: Double = 60) -> String {
        TempPinRules.canonicalISO(from: Date().addingTimeInterval(-minutesAgo * 60))
    }

    // ── issue ───────────────────────────────────────────────────────────

    func testIssueMintsPinPersistsHashAndAudit() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)

        let result = try repo.issue(
            label: "Sous chef Marco", expiresAt: futureISO(), scopes: ["beo.fire_at_edit"], context: ctx
        )
        XCTAssertGreaterThan(result.id, 0)
        XCTAssertTrue(result.pin.range(of: "^[0-9]{4}$", options: .regularExpression) != nil)
        XCTAssertEqual(result.label, "Sous chef Marco")
        XCTAssertEqual(result.scopes, ["beo.fire_at_edit"])

        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT pin_hash, label FROM temp_pins WHERE id = ?", arguments: [result.id])!
            let hash: String = row["pin_hash"]
            XCTAssertNotEqual(hash, result.pin, "pin_hash should not equal raw pin")
            XCTAssertFalse(PinHash.isLegacyHash(hash), "must be the salted PBKDF2 format, not SHA-256")
            XCTAssertTrue(PinHash.verify(result.pin, hash), "stored hash verifies against the issued PIN")
            XCTAssertEqual(row["label"] as String, "Sous chef Marco")

            let audit = try Row.fetchOne(
                db, sql: "SELECT action, actor_source, payload_json FROM audit_events WHERE entity = 'temp_pin' AND entity_id = ?",
                arguments: [result.id]
            )!
            XCTAssertEqual(audit["action"] as String, "insert")
            XCTAssertEqual(audit["actor_source"] as String, RegulatedWriteContext.nativeMacActorSource)
            let payload: String = audit["payload_json"]
            XCTAssertFalse(payload.contains(result.pin), "audit payload must not carry the raw PIN")
            XCTAssertFalse(payload.contains(hash), "audit payload must not carry the hash")
        }
    }

    func testIssueRespectsPinLengthAndClampsOutOfRange() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)

        let six = try repo.issue(label: "Six", expiresAt: futureISO(), scopes: ["beo.fire_at_edit"], pinLength: 6, context: ctx)
        XCTAssertTrue(six.pin.range(of: "^[0-9]{6}$", options: .regularExpression) != nil)

        let clamped = try repo.issue(label: "Clamped", expiresAt: futureISO(), scopes: ["beo.fire_at_edit"], pinLength: 9, context: ctx)
        XCTAssertTrue(clamped.pin.range(of: "^[0-9]{4}$", options: .regularExpression) != nil, "out-of-range pin_length falls back to 4")
    }

    func testIssueRejectsUnknownScopeBeforeAnyWrite() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.issue(label: "X", expiresAt: futureISO(), scopes: ["not.real"], context: ctx)) { error in
            guard case TempPinWriteError.validation(let msg) = error else { return XCTFail() }
            XCTAssertTrue(msg.contains("unknown scope: not.real"))
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM temp_pins"), 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events"), 0)
        }
    }

    func testIssueRejectsEmptyScopes() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.issue(label: "X", expiresAt: futureISO(), scopes: [], context: ctx)) { error in
            guard case TempPinWriteError.validation(let msg) = error else { return XCTFail() }
            XCTAssertTrue(msg.contains("scopes required"))
        }
    }

    func testIssueRejectsPastExpiry() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.issue(label: "X", expiresAt: pastISO(), scopes: ["beo.fire_at_edit"], context: ctx)) { error in
            guard case TempPinWriteError.validation(let msg) = error else { return XCTFail() }
            XCTAssertTrue(msg.contains("future"))
        }
    }

    func testIssueRejectsNonCanonicalExpiry() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        for bad in ["2027-01-01T10:00:00Z", "2027-01-01 10:00:00", "2027-01-01", "soon"] {
            XCTAssertThrowsError(try repo.issue(label: "X", expiresAt: bad, scopes: ["beo.fire_at_edit"], context: ctx)) { error in
                guard case TempPinWriteError.validation(let msg) = error else { return XCTFail("\(bad)") }
                XCTAssertTrue(msg.contains("canonical ISO-8601"), "\(bad) must fail the canonical check")
            }
        }
    }

    func testIssueRequiresLabel() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        for blank in ["", "   "] {
            XCTAssertThrowsError(try repo.issue(label: blank, expiresAt: futureISO(), scopes: ["beo.fire_at_edit"], context: ctx)) { error in
                guard case TempPinWriteError.validation(let msg) = error else { return XCTFail() }
                XCTAssertTrue(msg.contains("label required"))
            }
        }
    }

    func testIssuePreservesLeadingZeros() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        let result = try repo.issue(
            label: "Zeros", expiresAt: futureISO(), scopes: ["beo.fire_at_edit"],
            context: ctx, pinGenerator: { _ in "0042" }
        )
        XCTAssertEqual(result.pin, "0042", "'0042' is a valid PIN, not '42'")
        try writeDB.pool.read { db in
            let hash = try String.fetchOne(db, sql: "SELECT pin_hash FROM temp_pins WHERE id = ?", arguments: [result.id])!
            XCTAssertFalse(PinHash.isLegacyHash(hash), "must be the salted PBKDF2 format")
            XCTAssertTrue(PinHash.verify("0042", hash), "leading-zero PIN verifies against its stored hash")
        }
    }

    // ── collision retry (UNIQUE pin_hash) ───────────────────────────────

    func testCollisionRetryMintsFreshPin() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        // Pre-seed a row holding the hash of '1234' so the first draw collides.
        try writeDB.pool.write { db in
            try db.execute(
                sql: "INSERT INTO temp_pins (location_id, pin_hash, label, scopes_json, expires_at) VALUES ('default', ?, 'Taken', '[]', ?)",
                arguments: [PinHash.sha256Hex("1234"), futureISO()]
            )
        }
        var draws: [String] = ["1234", "5678"]
        let result = try repo.issue(
            label: "Retry", expiresAt: futureISO(), scopes: ["beo.fire_at_edit"],
            context: ctx, pinGenerator: { _ in draws.removeFirst() }
        )
        XCTAssertEqual(result.pin, "5678", "collision must retry with a fresh PIN")
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM temp_pins"), 2)
        }
    }

    func testExhaustedAfterMaxCollisionRetriesRollsBackEverything() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        try writeDB.pool.write { db in
            try db.execute(
                sql: "INSERT INTO temp_pins (location_id, pin_hash, label, scopes_json, expires_at) VALUES ('default', ?, 'Taken', '[]', ?)",
                arguments: [PinHash.sha256Hex("1234"), futureISO()]
            )
        }
        XCTAssertThrowsError(try repo.issue(
            label: "Stuck", expiresAt: futureISO(), scopes: ["beo.fire_at_edit"],
            context: ctx, pinGenerator: { _ in "1234" }
        )) { error in
            XCTAssertEqual(error as? TempPinWriteError, .exhausted)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM temp_pins"), 1, "only the pre-seeded row remains")
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events"), 0, "each failed attempt's audit row rolls back")
        }
    }

    // ── list ────────────────────────────────────────────────────────────

    func testListActiveReturnsMetadataOnly() async throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.issue(label: "Active", expiresAt: futureISO(), scopes: ["beo.fire_at_edit"], context: ctx)

        let pins = try await repo.listActive(locationId: "default")
        XCTAssertEqual(pins.count, 1)
        XCTAssertEqual(pins[0].label, "Active")
        XCTAssertEqual(pins[0].scopes, ["beo.fire_at_edit"])
        XCTAssertFalse(pins[0].expiresAt.isEmpty)
        // TempPinRecord structurally has no pin/pin_hash field — invariant 4:
        // the raw PIN is unrecoverable after issuance.
    }

    func testListOmitsRevokedPins() async throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        let issued = try repo.issue(label: "WillRevoke", expiresAt: futureISO(), scopes: ["beo.fire_at_edit"], context: ctx)
        _ = try repo.revoke(id: issued.id, context: ctx)
        let pins = try await repo.listActive(locationId: "default")
        XCTAssertEqual(pins.count, 0)
    }

    func testListOmitsExpiredPins() async throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        // /issue rejects past expiries, so poke directly into the DB.
        let expired = pastISO()
        try await writeDB.pool.write { db in
            try db.execute(
                sql: "INSERT INTO temp_pins (location_id, pin_hash, label, scopes_json, expires_at) VALUES ('default', 'deadbeef', 'Expired', '[\"beo.fire_at_edit\"]', ?)",
                arguments: [expired]
            )
        }
        let pins = try await repo.listActive(locationId: "default")
        XCTAssertEqual(pins.count, 0)
    }

    func testListFailsClosedOnUnparseableExpiry() async throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        try await writeDB.pool.write { db in
            try db.execute(
                sql: "INSERT INTO temp_pins (location_id, pin_hash, label, scopes_json, expires_at) VALUES ('default', 'feedface', 'Corrupt', '[]', 'not-a-date')"
            )
        }
        let pins = try await repo.listActive(locationId: "default")
        XCTAssertEqual(pins.count, 0, "a corrupted expires_at must never list as active")
    }

    // ── revoke ──────────────────────────────────────────────────────────

    func testRevokeStampsRevokedAtAndAudits() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        let issued = try repo.issue(label: "X", expiresAt: futureISO(), scopes: ["beo.fire_at_edit"], context: ctx)

        let revokedAt = try repo.revoke(id: issued.id, context: ctx)
        XCTAssertFalse(revokedAt.isEmpty)
        try writeDB.pool.read { db in
            let stored = try String.fetchOne(db, sql: "SELECT revoked_at FROM temp_pins WHERE id = ?", arguments: [issued.id])
            XCTAssertEqual(stored, revokedAt)
            let updates = try Int.fetchOne(
                db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity = 'temp_pin' AND entity_id = ? AND action = 'update'",
                arguments: [issued.id]
            )
            XCTAssertEqual(updates, 1, "revoke must write an update audit row")
        }
    }

    func testRevokeUnknownIdThrowsNotFound() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.revoke(id: 99999, context: ctx)) { error in
            XCTAssertEqual(error as? TempPinWriteError, .notFound)
        }
    }

    func testDoubleRevokeIsIdempotentWithoutSecondAuditRow() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        let issued = try repo.issue(label: "Twice", expiresAt: futureISO(), scopes: ["beo.fire_at_edit"], context: ctx)

        let first = try repo.revoke(id: issued.id, context: ctx)
        let second = try repo.revoke(id: issued.id, context: ctx)
        XCTAssertEqual(first, second, "replayed revoke returns the same revoked_at")
        try writeDB.pool.read { db in
            let updates = try Int.fetchOne(
                db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity = 'temp_pin' AND entity_id = ? AND action = 'update'",
                arguments: [issued.id]
            )
            XCTAssertEqual(updates, 1, "idempotent replay must not write a second audit row")
        }
    }

    // ── verifier interop (issued here → authenticates there) ────────────

    func testIssuedPinGrantsItsScopeThroughTempPinVerifier() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        let issued = try repo.issue(label: "Delegate", expiresAt: futureISO(), scopes: ["haccp.back_date"], context: ctx)

        try writeDB.pool.read { db in
            XCTAssertTrue(try TempPinVerifier().hasPinOrScope(
                pin: issued.pin, scope: "haccp.back_date", db: db, locationId: "default", env: [:]
            ))
            XCTAssertFalse(try TempPinVerifier().hasPinOrScope(
                pin: issued.pin, scope: "beo.fire_at_edit", db: db, locationId: "default", env: [:]
            ), "scope grant is exact, not blanket")
        }
    }

    func testRevokedPinFailsVerifierImmediately() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = TempPinRepository(readDB: readDB, writeDB: writeDB)
        let issued = try repo.issue(label: "Lost", expiresAt: futureISO(), scopes: ["haccp.back_date"], context: ctx)
        _ = try repo.revoke(id: issued.id, context: ctx)
        try writeDB.pool.read { db in
            XCTAssertFalse(try TempPinVerifier().hasPinOrScope(
                pin: issued.pin, scope: "haccp.back_date", db: db, locationId: "default", env: [:]
            ), "revocation takes effect on the next check")
        }
    }
}
