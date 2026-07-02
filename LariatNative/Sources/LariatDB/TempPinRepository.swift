import Foundation
import GRDB
import LariatModel

/// Issuance / listing / revocation of scoped, time-boxed temp PINs — behavior
/// parity with `/api/auth/temp-pin/{issue,list,revoke}` + `lib/tempPin.ts`.
/// The verifier side already lives in `TempPinVerifier`.
///
/// Security invariants (parity with the web routes):
///   • The raw PIN exists ONLY in the returned `TempPinIssueResult` — the DB
///     stores `SHA-256(pin)` and the PIN is unrecoverable after issuance.
///     If a cook loses it, revoke and reissue.
///   • `listActive` returns metadata only — never `pin_hash` or a raw PIN.
///   • Scope inputs are validated against the ported `TempPinRules.knownScopes`
///     (unknown scope → typed validation error, no write).
///   • Every mutation and its `audit_events` row (`entity=temp_pin`) commit —
///     or roll back — in ONE transaction.
///
/// Deliberate divergences (documented, asserted in tests):
///   • `actor_source` from `RegulatedWriteContext` (`native_mac`; web:
///     `manager_ui`).
///   • No idempotency layer — matching the web /issue route, which is
///     deliberately NOT wrapped in `withIdempotency` (caching a response that
///     carries a raw PIN was audit 2026-05-08 Tier-1 HIGH #2); /revoke's
///     replay-dedupe need disappears natively (direct in-process call, no
///     SW replay path), and revoke is idempotent by construction anyway.
public struct TempPinRepository {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    /// Web `MAX_COLLISION_RETRIES` — attempts to find a PIN whose hash does
    /// not collide with the UNIQUE `pin_hash` column.
    public static let maxCollisionRetries = 5

    static let maxLabelLength = 200

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── issue (POST /api/auth/temp-pin/issue) ───────────────────────────

    /// Mint a scoped, time-boxed temp PIN. Returns the raw PIN ONCE.
    /// `pinGenerator` is injectable for deterministic collision tests; the
    /// default draws from the system CSPRNG (`randomInt` parity), padding to
    /// preserve leading zeros ('0042' is a valid PIN, not '42').
    public func issue(
        label: String,
        expiresAt: String,
        scopes: [String],
        pinLength: Int? = nil,
        context: RegulatedWriteContext,
        pinGenerator: (Int) -> String = TempPinRepository.generatePin
    ) throws -> TempPinIssueResult {
        guard let cleanLabel = Self.clip(label, max: Self.maxLabelLength) else {
            throw TempPinWriteError.validation("label required")
        }

        guard TempPinRules.isCanonicalISO(expiresAt) else {
            throw TempPinWriteError.validation("expires_at must be canonical ISO-8601 UTC")
        }
        guard !TempPinRules.isExpired(expiresAt) else {
            throw TempPinWriteError.validation("expires_at must be in the future")
        }

        guard !scopes.isEmpty else {
            throw TempPinWriteError.validation("scopes required (at least one)")
        }
        for scope in scopes where !TempPinRules.isKnownScope(scope) {
            throw TempPinWriteError.validation("unknown scope: \(scope)")
        }

        // pin_length: default 4; out-of-range values fall back to 4 (web parity).
        let length: Int = {
            guard let n = pinLength else { return PinHash.minLength }
            guard n >= PinHash.minLength && n <= PinHash.maxLength else { return PinHash.minLength }
            return n
        }()

        let scopesJson = try TempPinRules.serializeScopes(scopes)

        // Collision-retry loop: 4-digit PIN with ~50 active rows → ~0.5% odds;
        // a UNIQUE violation on pin_hash rolls the attempt back and retries.
        for attempt in 0..<Self.maxCollisionRetries {
            let pin = pinGenerator(length)
            if PinHash.validateFormat(pin) != nil { continue }
            let pinHash = PinHash.sha256Hex(pin)
            do {
                let id = try AuditedWriteRunner.perform(db: writeDB) { db -> Int64 in
                    try db.execute(
                        sql: """
                          INSERT INTO temp_pins (location_id, pin_hash, label, scopes_json, expires_at)
                          VALUES (?, ?, ?, ?, ?)
                          """,
                        arguments: [context.locationId, pinHash, cleanLabel, scopesJson, expiresAt]
                    )
                    let newId = db.lastInsertedRowID
                    _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                        entity: "temp_pin",
                        entityId: newId,
                        action: .insert,
                        actorCookId: context.actorCookId,
                        actorSource: context.actorSource,
                        payloadJSON: AuditEventWriter.encodePayload(IssuePayload(
                            label: cleanLabel, expiresAt: expiresAt, scopes: scopes
                        )),
                        shiftDate: context.shiftDate,
                        locationId: context.locationId
                    ))
                    return newId
                }
                return TempPinIssueResult(
                    id: id, pin: pin, label: cleanLabel, scopes: scopes, expiresAt: expiresAt
                )
            } catch {
                let text = String(describing: error).uppercased()
                if text.contains("UNIQUE") && attempt < Self.maxCollisionRetries - 1 {
                    continue // pick a new PIN and retry
                }
                if text.contains("UNIQUE") {
                    throw TempPinWriteError.exhausted
                }
                throw error
            }
        }
        throw TempPinWriteError.exhausted
    }

    // ── list (GET /api/auth/temp-pin/list) ──────────────────────────────

    /// Active PINs only: not revoked AND not expired. `datetime()` on both
    /// sides normalizes ISO 'T'/'Z' to SQLite's canonical form so the string
    /// comparison is correct; an unparseable expires_at yields NULL and is
    /// excluded — fail-closed, a corrupted row never lists as active.
    public func listActive(locationId: String = LocationScope.resolve()) async throws -> [TempPinRecord] {
        try await readDB.pool.read { db in
            let rows = try Row.fetchAll(
                db,
                sql: """
                  SELECT id, label, scopes_json, issued_at, expires_at
                    FROM temp_pins
                   WHERE location_id = ?
                     AND revoked_at IS NULL
                     AND datetime(expires_at) > datetime('now')
                   ORDER BY issued_at DESC
                  """,
                arguments: [locationId]
            )
            return rows.map { row in
                TempPinRecord(
                    id: row["id"],
                    label: row["label"],
                    scopes: TempPinVerifier.parseScopes(row["scopes_json"]),
                    issuedAt: row["issued_at"],
                    expiresAt: row["expires_at"]
                )
            }
        }
    }

    // ── revoke (POST /api/auth/temp-pin/revoke) ─────────────────────────

    /// Sets `revoked_at = now`. The verifier's WHERE clause filters
    /// `revoked_at IS NULL`, so the PIN stops working immediately.
    /// Idempotent: an already-revoked row returns its existing `revoked_at`
    /// WITHOUT a second audit row. Unknown id → `.notFound` (web 404).
    @discardableResult
    public func revoke(id: Int64, context: RegulatedWriteContext) throws -> String {
        guard id > 0 else { throw TempPinWriteError.validation("id required (positive integer)") }
        return try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let existing = try Row.fetchOne(
                db,
                sql: "SELECT id, revoked_at FROM temp_pins WHERE id = ? AND location_id = ?",
                arguments: [id, context.locationId]
            ) else {
                throw TempPinWriteError.notFound
            }
            if let already: String = existing["revoked_at"] {
                return already
            }

            try db.execute(
                sql: "UPDATE temp_pins SET revoked_at = datetime('now') WHERE id = ?",
                arguments: [id]
            )
            guard let revokedAt = try String.fetchOne(
                db,
                sql: "SELECT revoked_at FROM temp_pins WHERE id = ?",
                arguments: [id]
            ) else {
                throw TempPinWriteError.persistenceFailed
            }

            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "temp_pin",
                entityId: id,
                action: .update,
                actorCookId: context.actorCookId,
                actorSource: context.actorSource,
                payloadJSON: AuditEventWriter.encodePayload(RevokePayload(
                    revoked: true, revokedAt: revokedAt
                )),
                shiftDate: context.shiftDate,
                locationId: context.locationId
            ))
            return revokedAt
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────

    /// Web `generatePin(length)` — CSPRNG draw padded to preserve leading zeros.
    public static func generatePin(length: Int) -> String {
        var rng = SystemRandomNumberGenerator()
        let max = Int(pow(10.0, Double(length)))
        let value = Int.random(in: 0..<max, using: &rng)
        return String(format: "%0\(length)d", value)
    }

    /// Route `clip(s, max)` — trim, nil when empty, slice to max.
    static func clip(_ value: String, max: Int) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }

    private struct IssuePayload: Encodable {
        let label: String
        let expiresAt: String
        let scopes: [String]
    }

    private struct RevokePayload: Encodable {
        let revoked: Bool
        let revokedAt: String
    }
}
