import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Behavior-parity port of `tests/js/test-manager-pins.mjs` (lib + route
/// halves) against `ManagerPinRepository` on the real web schema. The PIN
/// route's cookie gate maps to the ViewModel's `ManagementWrite.requireSession`
/// — repository tests assert the storage/audit/auth-interop invariants.
final class ManagerPinRepositoryTests: XCTestCase {
    private let ctx = RegulatedWriteContext.nativeMac(pinUser: nil)

    // ── create ──────────────────────────────────────────────────────────

    func testCreateStoresHashOnlyNeverRawPin() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)

        let created = try repo.create(name: "Sean", pin: "1357", role: "owner", context: ctx)
        XCTAssertGreaterThan(created.id, 0)
        XCTAssertEqual(created.name, "Sean")
        XCTAssertEqual(created.role, "owner")
        XCTAssertTrue(created.active)

        try writeDB.pool.read { db in
            let row = try Row.fetchOne(
                db, sql: "SELECT pin_hash, name, role, is_active FROM manager_pin_users WHERE id = ?",
                arguments: [created.id]
            )!
            let hash: String = row["pin_hash"]
            XCTAssertNotEqual(hash, "1357", "raw PIN must never be stored")
            XCTAssertEqual(hash, PinHash.sha256Hex("1357"), "hash must match the shared PinHash")
            XCTAssertEqual(row["is_active"] as Int, 1)

            // Audit row in the SAME transaction; payload carries no PIN material.
            let audit = try Row.fetchOne(
                db,
                sql: "SELECT action, actor_source, payload_json FROM audit_events WHERE entity = 'manager_pin_user' AND entity_id = ?",
                arguments: [created.id]
            )!
            XCTAssertEqual(audit["action"] as String, "insert")
            XCTAssertEqual(audit["actor_source"] as String, RegulatedWriteContext.nativeMacActorSource)
            let payload: String = audit["payload_json"]
            XCTAssertFalse(payload.contains("1357"), "audit payload must not carry the raw PIN")
            XCTAssertFalse(payload.contains(hash), "audit payload must not carry the hash")
            XCTAssertTrue(payload.contains("\"name\":\"Sean\""))
        }
    }

    func testCreateDefaultsRoleToManager() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)
        let created = try repo.create(name: "Sous", pin: "1111", role: nil, context: ctx)
        XCTAssertEqual(created.role, "manager")
        // Blank role string also defaults (web normalizeRole '' → manager).
        let second = try repo.create(name: "Lead", pin: "2222", role: "  ", context: ctx)
        XCTAssertEqual(second.role, "manager")
    }

    func testCreateValidationLadderFailsBeforeAnyWriteOrAudit() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)

        let cases: [(name: String, pin: String, role: String?, contains: String)] = [
            ("   ", "1234", nil, "name required"),
            (String(repeating: "x", count: 81), "1234", nil, "name too long"),
            ("Chef", "1234", "chef", "role must be manager or owner"),
            ("Chef", "123", nil, "short"),
            ("Chef", "1234567", nil, "long"),
            ("Chef", "12a4", nil, "digits"),
        ]
        for c in cases {
            XCTAssertThrowsError(try repo.create(name: c.name, pin: c.pin, role: c.role, context: ctx)) { error in
                guard case ManagerPinWriteError.validation(let msg) = error else {
                    return XCTFail("expected validation error for \(c)")
                }
                XCTAssertTrue(msg.lowercased().contains(c.contains.lowercased()), "\(msg) should mention \(c.contains)")
            }
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM manager_pin_users"), 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events"), 0)
        }
    }

    /// Cross-component interop: a PIN created here authenticates through the
    /// EXISTING `PinVerifier` (same `PinHash`, same table).
    func testCreatedPinAuthenticatesViaPinVerifier() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)
        let created = try repo.create(name: "Sous", pin: "1357", role: "manager", context: ctx)

        let user = try writeDB.pool.read { db in
            try PinVerifier().verify(pin: "1357", db: db, locationId: "default", env: [:])
        }
        XCTAssertEqual(user.id, created.id)
        XCTAssertEqual(user.name, "Sous")
        XCTAssertEqual(user.role, "manager")
    }

    // ── update (merge semantics) ────────────────────────────────────────

    func testUpdateRehashesOnlyWhenNewPinGiven() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)
        let created = try repo.create(name: "Opener", pin: "2468", role: "manager", context: ctx)

        // Full update with a NEW PIN — old PIN stops working, new one works.
        let updated = try repo.update(
            id: created.id, name: "Closing Manager", pin: "9753", role: "owner", isActive: true, context: ctx
        )
        XCTAssertEqual(updated.name, "Closing Manager")
        XCTAssertEqual(updated.role, "owner")
        try writeDB.pool.read { db in
            XCTAssertThrowsError(try PinVerifier().verify(pin: "2468", db: db, locationId: "default", env: [:]))
            XCTAssertEqual(try PinVerifier().verify(pin: "9753", db: db, locationId: "default", env: [:]).id, created.id)
        }

        // Partial update WITHOUT a PIN — absent fields keep existing values,
        // and the stored hash is untouched (blank PIN = keep).
        let renamed = try repo.update(id: created.id, name: "Renamed", context: ctx)
        XCTAssertEqual(renamed.name, "Renamed")
        XCTAssertEqual(renamed.role, "owner", "absent role must keep existing value")
        XCTAssertTrue(renamed.active, "absent isActive must keep existing value")
        try writeDB.pool.read { db in
            XCTAssertEqual(try PinVerifier().verify(pin: "9753", db: db, locationId: "default", env: [:]).id, created.id)
        }
    }

    func testUpdateUnknownIdThrowsNotFound() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.update(id: 999, name: "Ghost", context: ctx)) { error in
            XCTAssertEqual(error as? ManagerPinWriteError, .notFound)
        }
        XCTAssertThrowsError(try repo.update(id: 0, context: ctx)) { error in
            guard case ManagerPinWriteError.validation = error as! ManagerPinWriteError else {
                return XCTFail("id<=0 is a validation failure")
            }
        }
    }

    // ── disable ─────────────────────────────────────────────────────────

    func testDisabledUserNoLongerAuthenticates() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)
        let created = try repo.create(name: "Temp Manager", pin: "8080", role: "manager", context: ctx)

        let disabled = try repo.disable(id: created.id, context: ctx)
        XCTAssertFalse(disabled.active)
        XCTAssertNotNil(disabled.disabledAt, "disable must stamp disabled_at")

        try writeDB.pool.read { db in
            XCTAssertThrowsError(
                try PinVerifier().verify(pin: "8080", db: db, locationId: "default", env: [:]),
                "disabled users must not authenticate"
            )
            // insert + update audit rows, both same-transaction.
            let actions = try String.fetchAll(
                db, sql: "SELECT action FROM audit_events WHERE entity = 'manager_pin_user' AND entity_id = ? ORDER BY id",
                arguments: [created.id]
            )
            XCTAssertEqual(actions, ["insert", "update"])
        }
    }

    func testReenableClearsDisabledAt() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)
        let created = try repo.create(name: "Cycle", pin: "4646", role: "manager", context: ctx)
        _ = try repo.disable(id: created.id, context: ctx)
        let reenabled = try repo.update(id: created.id, isActive: true, context: ctx)
        XCTAssertTrue(reenabled.active)
        XCTAssertNil(reenabled.disabledAt, "web CASE clears disabled_at when reactivated")
    }

    // ── list ────────────────────────────────────────────────────────────

    func testListIncludesDisabledAndOrdersActiveFirst() async throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)
        let a = try repo.create(name: "A", pin: "1111", role: "manager", context: ctx)
        let b = try repo.create(name: "B", pin: "2222", role: "manager", context: ctx)
        _ = try repo.disable(id: a.id, context: ctx)

        let all = try await repo.list(locationId: "default", includeDisabled: true)
        XCTAssertEqual(all.map(\.name), ["B", "A"], "is_active DESC puts active users first")
        XCTAssertEqual(all.map(\.active), [true, false])

        let activeOnly = try await repo.list(locationId: "default", includeDisabled: false)
        XCTAssertEqual(activeOnly.map(\.id), [b.id])
    }

    // ── location scoping ────────────────────────────────────────────────

    func testLocationScoping() async throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)
        let downtown = RegulatedWriteContext(
            actorCookId: nil, actorSource: RegulatedWriteContext.nativeMacActorSource,
            locationId: "downtown", shiftDate: ShiftDate.todayISO()
        )
        let created = try repo.create(name: "Downtown Mgr", pin: "3131", role: "manager", context: downtown)

        let defaultUsers = try await repo.list(locationId: "default")
        XCTAssertEqual(defaultUsers.count, 0)
        let downtownUsers = try await repo.list(locationId: "downtown")
        XCTAssertEqual(downtownUsers.map(\.id), [created.id])

        // Cross-location update must not find the row (web WHERE location_id).
        XCTAssertThrowsError(try repo.update(id: created.id, name: "Steal", context: ctx)) { error in
            XCTAssertEqual(error as? ManagerPinWriteError, .notFound)
        }
    }

    // ── atomicity ───────────────────────────────────────────────────────

    func testAuditFailureRollsBackTheInsert() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)
        try writeDB.pool.write { db in
            try db.execute(sql: """
                CREATE TEMP TRIGGER fail_manager_pin_audit
                BEFORE INSERT ON audit_events
                WHEN NEW.entity = 'manager_pin_user'
                BEGIN
                  SELECT RAISE(ABORT, 'forced audit failure');
                END;
                """)
        }
        defer { try? writeDB.pool.write { db in try db.execute(sql: "DROP TRIGGER IF EXISTS fail_manager_pin_audit") } }

        XCTAssertThrowsError(try repo.create(name: "Ghost", pin: "7777", role: "manager", context: ctx))
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM manager_pin_users"), 0, "source row must roll back with the audit")
        }
    }
}
