import Foundation
import GRDB
import LariatModel

/// CRUD side of manager PIN users — behavior parity with `lib/managerPins.ts`
/// + `/api/auth/manager-pins/route.js`. The verifier side already lives in
/// `PinVerifier`; this repository reuses the same `PinHash` so a PIN created
/// here authenticates there.
///
/// Security invariants (parity with the web module):
///   • A raw PIN is hashed (`PinHash.sha256Hex`) before ANY I/O and is never
///     stored, logged, returned, or put in an audit payload.
///   • `ManagerPinRecord` structurally excludes `pin_hash` — it is never
///     SELECTed out of the table by this repository.
///   • Rule failures throw typed `ManagerPinWriteError`s BEFORE any write or
///     audit row (web maps them all to 422).
///   • Every mutation and its `audit_events` row (`entity=manager_pin_user`)
///     commit — or roll back — in ONE transaction.
///
/// Deliberate divergences (documented, asserted in tests):
///   • `actor_source` comes from `RegulatedWriteContext` (`native_mac`);
///     the web route stamps `manager_ui`.
///   • No `withIdempotency` replay-dedupe layer — native calls are direct
///     in-process invocations with no service-worker replay path.
public struct ManagerPinRepository {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    private static let selectColumns =
        "id, location_id, name, role, is_active, created_at, updated_at, disabled_at"

    // ── list (route GET → listManagerPinUsers) ──────────────────────────

    /// The management page lists disabled users too (`includeDisabled: true`).
    public func list(
        locationId: String = LocationScope.resolve(),
        includeDisabled: Bool = true
    ) async throws -> [ManagerPinRecord] {
        try await readDB.pool.read { db in
            try ManagerPinRecord.fetchAll(
                db,
                sql: """
                  SELECT \(Self.selectColumns)
                    FROM manager_pin_users
                   WHERE location_id = ?
                     \(includeDisabled ? "" : "AND is_active = 1")
                   ORDER BY is_active DESC, updated_at DESC, id DESC
                  """,
                arguments: [locationId]
            )
        }
    }

    // ── create (route POST → createManagerPinUser) ──────────────────────

    @discardableResult
    public func create(
        name: String,
        pin: String,
        role: String? = nil,
        context: RegulatedWriteContext
    ) throws -> ManagerPinRecord {
        let cleanName = try Self.normalizeName(name)
        let cleanRole = try Self.normalizeRole(role)
        if let fmt = PinHash.validateFormat(pin) { throw ManagerPinWriteError.validation(fmt) }

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try Self.assertPinCodeFree(db, pin: pin, locationId: context.locationId, exceptId: nil)
            let pinHash = PinHash.hashPinSecure(pin)
            try db.execute(
                sql: """
                  INSERT INTO manager_pin_users (location_id, name, pin_hash, role)
                  VALUES (?, ?, ?, ?)
                  """,
                arguments: [context.locationId, cleanName, pinHash, cleanRole]
            )
            let newId = db.lastInsertedRowID
            let record = try Self.fetch(db, id: newId, locationId: context.locationId)
            try Self.audit(db, action: .insert, record: record, context: context)
            return record
        }
    }

    // ── update (route PATCH → updateManagerPinUser) ─────────────────────

    /// Merge semantics: absent fields keep the existing value; the PIN is
    /// re-hashed only when a new one is provided; `disabled_at` follows the
    /// web CASE (active → NULL, inactive → COALESCE(existing, now)).
    @discardableResult
    public func update(
        id: Int64,
        name: String? = nil,
        pin: String? = nil,
        role: String? = nil,
        isActive: Bool? = nil,
        context: RegulatedWriteContext
    ) throws -> ManagerPinRecord {
        guard id > 0 else { throw ManagerPinWriteError.validation("id required") }
        let cleanName = try name.map(Self.normalizeName)
        let cleanRole = try role.map { try Self.normalizeRole($0) }
        if let pin, let fmt = PinHash.validateFormat(pin) {
            throw ManagerPinWriteError.validation(fmt)
        }

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let existing = try? Self.fetch(db, id: id, locationId: context.locationId) else {
                throw ManagerPinWriteError.notFound
            }
            let nextName = cleanName ?? existing.name
            let nextRole = cleanRole ?? existing.role
            let nextActive = isActive ?? existing.active

            var pinHash: String?
            if let pin {
                try Self.assertPinCodeFree(db, pin: pin, locationId: context.locationId, exceptId: id)
                pinHash = PinHash.hashPinSecure(pin)
            }

            if let pinHash {
                try db.execute(
                    sql: """
                      UPDATE manager_pin_users
                         SET name = ?,
                             pin_hash = ?,
                             role = ?,
                             is_active = ?,
                             updated_at = datetime('now'),
                             disabled_at = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(disabled_at, datetime('now')) END
                       WHERE id = ?
                         AND location_id = ?
                      """,
                    arguments: [nextName, pinHash, nextRole, nextActive ? 1 : 0, nextActive ? 1 : 0, id, context.locationId]
                )
            } else {
                try db.execute(
                    sql: """
                      UPDATE manager_pin_users
                         SET name = ?,
                             role = ?,
                             is_active = ?,
                             updated_at = datetime('now'),
                             disabled_at = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(disabled_at, datetime('now')) END
                       WHERE id = ?
                         AND location_id = ?
                      """,
                    arguments: [nextName, nextRole, nextActive ? 1 : 0, nextActive ? 1 : 0, id, context.locationId]
                )
            }

            let record = try Self.fetch(db, id: id, locationId: context.locationId)
            try Self.audit(db, action: .update, record: record, context: context)
            return record
        }
    }

    // ── disable (route DELETE → disableManagerPinUser) ──────────────────

    @discardableResult
    public func disable(id: Int64, context: RegulatedWriteContext) throws -> ManagerPinRecord {
        try update(id: id, isActive: false, context: context)
    }

    // ── rule helpers (parity with normalizeName / normalizeRole / hashManagerPin) ──

    static func normalizeName(_ name: String) throws -> String {
        let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { throw ManagerPinWriteError.validation("name required") }
        guard value.count <= 80 else { throw ManagerPinWriteError.validation("name too long") }
        return value
    }

    static func normalizeRole(_ role: String?) throws -> String {
        let value = (role ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return "manager" }
        guard value == "manager" || value == "owner" else {
            throw ManagerPinWriteError.validation("role must be manager or owner")
        }
        return value
    }

    /// Reject a PIN already held by another ACTIVE manager in this location so
    /// login stays unambiguous — the DB UNIQUE(location_id, pin_hash) index can
    /// no longer enforce it once every salted hash is distinct (parity with
    /// lib/managerPins.ts assertPinCodeFree). Runs inside the write transaction.
    static func assertPinCodeFree(_ db: Database, pin: String, locationId: String, exceptId: Int64?) throws {
        let rows = try Row.fetchAll(
            db,
            sql: "SELECT id, pin_hash FROM manager_pin_users WHERE location_id = ? AND is_active = 1",
            arguments: [locationId]
        )
        for row in rows {
            let rowId: Int64 = row["id"]
            if let exceptId, rowId == exceptId { continue }
            let stored: String = row["pin_hash"]
            if PinHash.verify(pin, stored) {
                throw ManagerPinWriteError.validation("PIN already in use by an active manager")
            }
        }
    }

    // ── internals ───────────────────────────────────────────────────────

    private static func fetch(_ db: Database, id: Int64, locationId: String) throws -> ManagerPinRecord {
        guard let record = try ManagerPinRecord.fetchOne(
            db,
            sql: """
              SELECT \(selectColumns)
                FROM manager_pin_users
               WHERE id = ?
                 AND location_id = ?
              """,
            arguments: [id, locationId]
        ) else {
            throw ManagerPinWriteError.notFound
        }
        return record
    }

    /// Web audit payload shape: `{ name, role, is_active }` — never a hash.
    private static func audit(
        _ db: Database,
        action: AuditEventAction,
        record: ManagerPinRecord,
        context: RegulatedWriteContext
    ) throws {
        _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
            entity: "manager_pin_user",
            entityId: record.id,
            action: action,
            actorCookId: context.actorCookId,
            actorSource: context.actorSource,
            payloadJSON: AuditEventWriter.encodePayload(AuditPayload(
                name: record.name, role: record.role, isActive: record.active
            )),
            shiftDate: context.shiftDate,
            locationId: context.locationId
        ))
    }

    private struct AuditPayload: Encodable {
        let name: String
        let role: String
        let isActive: Bool
    }
}
