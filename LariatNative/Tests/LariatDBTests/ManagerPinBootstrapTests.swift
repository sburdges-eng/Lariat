import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// First-run PIN bootstrap — the escape from the catch-22 a packaged build hits:
/// every write on the Manager → PINs board is PIN-gated, so with an empty
/// `manager_pin_users` table and no `LARIAT_PIN` in the environment (a
/// Finder-launched .app inherits no shell env) there is no way to create the
/// first PIN. `createFirst` is the ONLY unsessioned write on this surface.
///
/// The permission is exactly the negation of `PinVerifier.gateConfigured` —
/// one source of truth — and is re-checked INSIDE the write transaction so a
/// concurrent create cannot slip a second unsessioned PIN through.
final class ManagerPinBootstrapTests: XCTestCase {
    private let noEnv: [String: String] = [:]

    private func ctx(_ locationId: String = "default") -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: nil,
            actorSource: RegulatedWriteContext.nativeMacActorSource,
            locationId: locationId,
            shiftDate: ShiftDate.todayISO()
        )
    }

    // ── the bootstrap itself ────────────────────────────────────────────

    func testCreatesTheFirstPinWithoutASession() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)

        let created = try repo.createFirst(name: "Sean", pin: "0708", role: "owner", context: ctx(), env: noEnv)
        XCTAssertGreaterThan(created.id, 0)
        XCTAssertEqual(created.role, "owner")
        XCTAssertTrue(created.active)

        try writeDB.pool.read { db in
            // Hashed like any other PIN — bootstrap must not weaken storage.
            let hash: String = try String.fetchOne(
                db, sql: "SELECT pin_hash FROM manager_pin_users WHERE id = ?", arguments: [created.id]
            )!
            XCTAssertNotEqual(hash, "0708", "raw PIN must never be stored")
            XCTAssertFalse(PinHash.isLegacyHash(hash), "must be the salted PBKDF2 format")

            // And it authenticates — the gate is closed from here on.
            let user = try PinVerifier().verify(pin: "0708", db: db, env: noEnv)
            XCTAssertEqual(user.id, created.id)
            XCTAssertTrue(try PinVerifier().gateConfigured(db: db, env: noEnv))
        }
    }

    func testBootstrapAuditRowNamesItselfAndCarriesNoPinMaterial() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)

        let created = try repo.createFirst(name: "Sean", pin: "0708", role: nil, context: ctx(), env: noEnv)

        try writeDB.pool.read { db in
            let row = try Row.fetchOne(
                db,
                sql: """
                  SELECT action, actor_source, actor_cook_id, note, payload_json
                    FROM audit_events
                   WHERE entity = 'manager_pin_user' AND entity_id = ?
                  """,
                arguments: [created.id]
            )!
            XCTAssertEqual(row["action"] as String, "insert")
            XCTAssertEqual(row["actor_source"] as String, RegulatedWriteContext.nativeMacActorSource)
            XCTAssertNil(row["actor_cook_id"] as String?, "no manager was signed in — the actor is honestly absent")
            // An unsessioned write must be identifiable forever in the trail.
            XCTAssertEqual(row["note"] as String?, ManagerPinRepository.bootstrapAuditNote)
            let payload: String = row["payload_json"]
            XCTAssertFalse(payload.contains("0708"), "audit payload must not carry the raw PIN")
        }
    }

    /// The live 2026-08-05 state: one row, disabled. `gateConfigured` counts
    /// only `is_active = 1`, so the board is still unusable and bootstrap applies.
    func testAllowedWhenEveryExistingPinIsDisabled() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)

        let ana = try repo.create(name: "Ana", pin: "1357", role: "manager", context: ctx())
        _ = try repo.disable(id: ana.id, context: ctx())

        let created = try repo.createFirst(name: "Sean", pin: "0708", role: "owner", context: ctx(), env: noEnv)
        XCTAssertGreaterThan(created.id, 0)
    }

    // ── the refusals ────────────────────────────────────────────────────

    func testRefusedOnceAnActivePinExistsAndWritesNothing() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.create(name: "Ana", pin: "1357", role: "manager", context: ctx())

        XCTAssertThrowsError(
            try repo.createFirst(name: "Sean", pin: "0708", role: "owner", context: ctx(), env: noEnv)
        ) { error in
            guard case ManagerPinWriteError.validation(let msg) = error else {
                return XCTFail("expected a validation refusal, got \(error)")
            }
            XCTAssertTrue(msg.lowercased().contains("pin"), "message should name the PIN: \(msg)")
        }

        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM manager_pin_users"), 1)
            XCTAssertEqual(
                try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity = 'manager_pin_user'"),
                1, "a refused bootstrap must leave no audit row behind"
            )
        }
    }

    /// With `LARIAT_PIN` set the operator already holds a working unlock, so the
    /// unsessioned path must stay shut — same condition `gateConfigured` uses.
    func testRefusedWhenTheEnvOverrideIsConfigured() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)

        XCTAssertThrowsError(
            try repo.createFirst(
                name: "Sean", pin: "0708", role: "owner",
                context: ctx(), env: ["LARIAT_PIN": "9999"]
            )
        ) { error in
            guard case ManagerPinWriteError.validation = error else {
                return XCTFail("expected a validation refusal, got \(error)")
            }
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM manager_pin_users"), 0)
        }
    }

    func testValidationLadderStillAppliesToTheFirstPin() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)

        for bad in [("   ", "1234"), ("Chef", "123"), ("Chef", "12a4")] {
            XCTAssertThrowsError(
                try repo.createFirst(name: bad.0, pin: bad.1, role: nil, context: ctx(), env: noEnv)
            ) { error in
                guard case ManagerPinWriteError.validation = error else {
                    return XCTFail("expected a validation error for \(bad), got \(error)")
                }
            }
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM manager_pin_users"), 0)
        }
    }

    // ── location scoping ────────────────────────────────────────────────

    /// Each location gates independently, so a PIN at another location must not
    /// lock a fresh location out — nor unlock a second bootstrap at its own.
    func testScopedToItsOwnLocation() throws {
        let (readDB, writeDB, path) = try makePinRepos(); defer { cleanupPinFixture(path) }
        let repo = ManagerPinRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.create(name: "Ana", pin: "1357", role: "manager", context: ctx("uptown"))

        // Different location → still unconfigured here → allowed.
        _ = try repo.createFirst(name: "Sean", pin: "0708", role: "owner", context: ctx(), env: noEnv)

        // Same location, second attempt → refused.
        XCTAssertThrowsError(
            try repo.createFirst(name: "Kim", pin: "2468", role: "manager", context: ctx(), env: noEnv)
        )
    }
}
