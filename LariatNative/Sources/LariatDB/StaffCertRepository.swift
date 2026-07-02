import Foundation
import GRDB
import LariatModel

/// Repository for staff certifications — behavior parity with
/// `app/api/certifications/route.js` (A3 / L3). Reads via the read-only pool
/// (GET is open); regulated writes (record a cert / patch-or-retire) go through
/// `AuditedWriteRunner` so the `staff_certifications` mutation and its
/// `audit_events` row commit (or roll back) in ONE transaction.
///
/// Status semantics mirror the web route:
///   - bad shape (missing cook_id / cert_label, out-of-set cert_type, malformed
///     date) → validationFailed (web 400) — thrown BEFORE any INSERT so a raw
///     SQLite CHECK error never surfaces.
///   - PATCH with an empty change-set → validationFailed (web 400 "nothing to update").
///   - PATCH of an unknown id → notFound (web 404).
///
/// Writes are tagged `actor_source = native_mac` (the web route uses `pic_ui`;
/// this is the established LariatNative divergence — the PIN gate is the native
/// analog of the web `pic.staff_certs` scope). The gate itself is enforced at the
/// view-model layer (`RegulatedWriteContext.nativeMac(pinUser:)`); the repository
/// is handed an already-authorized context.
///
/// Retire is SOFT-DELETE only (`active = 0`) — never a hard DELETE. A live FK
/// `shift_pic.cfpm_cert_id … ON DELETE SET NULL` would null CFPM linkage.
public struct StaffCertRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET — list for a location (optional scope to one cook) ─────────
    //
    // The route's board GET orders `active DESC, expires_on IS NULL,
    // expires_on ASC, id ASC` (active first, then most-urgent expiry first,
    // no-expiry last). Location-scoped; optional `cook_id` filter.

    public func load(
        locationId: String = LocationScope.resolve(),
        cookId: String? = nil
    ) async throws -> [StaffCertRow] {
        try await readDB.pool.read { db in
            try Self.fetch(db, locationId: locationId, cookId: cookId)
        }
    }

    private static func fetch(_ db: Database, locationId: String, cookId: String?) throws -> [StaffCertRow] {
        var sql = "SELECT * FROM staff_certifications WHERE location_id = ?"
        var args: [DatabaseValueConvertible] = [locationId]
        if let cookId, !cookId.isEmpty {
            sql += " AND cook_id = ?"
            args.append(cookId)
        }
        sql += " ORDER BY active DESC, expires_on IS NULL, expires_on ASC, id ASC"
        return try StaffCertRow.fetchAll(db, sql: sql, arguments: StatementArguments(args))
    }

    // ── POST — record a new cert ───────────────────────────────────────

    @discardableResult
    public func create(input: StaffCertCreateInput, context: RegulatedWriteContext) throws -> StaffCertRow {
        // Shape validation mirrors `certificationsPostHandler` and runs BEFORE
        // the INSERT so a bad cert_type / date is a clean validationFailed, not a
        // raw SQLite CHECK error.
        guard let cookId = StaffCertCompute.clip(input.cookId, max: 64) else {
            throw StaffCertWriteError.validationFailed("cook_id required")
        }
        guard let certType = StaffCertCompute.parseCertType(input.certType) else {
            throw StaffCertWriteError.validationFailed(
                "cert_type must be one of: cfpm, food_handler, tips, allergen, other"
            )
        }
        guard let certLabel = StaffCertCompute.clip(input.certLabel, max: 120) else {
            throw StaffCertWriteError.validationFailed("cert_label required")
        }
        let issuer = StaffCertCompute.clip(input.issuer, max: 120)
        let certNumber = StaffCertCompute.clip(input.certNumber, max: 120)
        let issuedOn = StaffCertCompute.clip(input.issuedOn, max: 10)
        let expiresOn = StaffCertCompute.clip(input.expiresOn, max: 10)
        let documentPath = StaffCertCompute.clip(input.documentPath, max: 300)

        guard StaffCertCompute.isValidDate(issuedOn) else {
            throw StaffCertWriteError.validationFailed("issued_on must be YYYY-MM-DD")
        }
        guard StaffCertCompute.isValidDate(expiresOn) else {
            throw StaffCertWriteError.validationFailed("expires_on must be YYYY-MM-DD")
        }

        let locationId = context.locationId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO staff_certifications
                    (location_id, cook_id, cert_type, cert_label, issuer, cert_number,
                     issued_on, expires_on, document_path, active)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                  """,
                arguments: [
                    locationId, cookId, certType.rawValue, certLabel, issuer, certNumber,
                    issuedOn, expiresOn, documentPath,
                ]
            )
            let newId = db.lastInsertedRowID
            guard let row = try StaffCertRow.fetchOne(db, sql: "SELECT * FROM staff_certifications WHERE id = ?", arguments: [newId]) else {
                throw StaffCertWriteError.persistenceFailed
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "staff_certifications",
                    entityId: newId,
                    action: .insert,
                    actorCookId: context.actorCookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(row),
                    shiftDate: context.shiftDate,
                    locationId: locationId
                )
            )
            return row
        }
    }

    // ── PATCH — update expiry / retire (soft-delete) ───────────────────

    @discardableResult
    public func patch(input: StaffCertPatchInput, context: RegulatedWriteContext) throws -> StaffCertRow {
        guard input.id > 0 else { throw StaffCertWriteError.validationFailed("id required") }
        guard !input.fields.isEmpty else {
            throw StaffCertWriteError.validationFailed("nothing to update")
        }

        // Project the patch into SET clauses. Only the columns the web route
        // allows are representable via `StaffCertPatchField`; string columns are
        // clipped (document_path 300, the rest 120) and `active` coerced 1/0.
        var sets: [String] = []
        var args: [DatabaseValueConvertible?] = []
        for field in input.fields {
            switch field {
            case .certLabel(let v):    sets.append("cert_label = ?");    args.append(StaffCertCompute.clip(v, max: 120))
            case .issuer(let v):       sets.append("issuer = ?");        args.append(StaffCertCompute.clip(v, max: 120))
            case .certNumber(let v):   sets.append("cert_number = ?");   args.append(StaffCertCompute.clip(v, max: 120))
            case .issuedOn(let v):     sets.append("issued_on = ?");     args.append(StaffCertCompute.clip(v, max: 120))
            case .expiresOn(let v):    sets.append("expires_on = ?");    args.append(StaffCertCompute.clip(v, max: 120))
            case .documentPath(let v): sets.append("document_path = ?"); args.append(StaffCertCompute.clip(v, max: 300))
            case .active(let on):      sets.append("active = ?");        args.append(on ? 1 : 0)
            }
        }
        // Always bump updated_at (parity with the route's trailing SET).
        sets.append("updated_at = datetime('now')")

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            // Existence check + UPDATE in ONE transaction so a concurrent delete
            // can't slip between the 404 guard and the write.
            guard try StaffCertRow.fetchOne(db, sql: "SELECT * FROM staff_certifications WHERE id = ?", arguments: [input.id]) != nil else {
                throw StaffCertWriteError.notFound
            }
            var updateArgs = args
            updateArgs.append(input.id)
            try db.execute(
                sql: "UPDATE staff_certifications SET \(sets.joined(separator: ", ")) WHERE id = ?",
                arguments: StatementArguments(updateArgs)
            )
            guard let updated = try StaffCertRow.fetchOne(db, sql: "SELECT * FROM staff_certifications WHERE id = ?", arguments: [input.id]) else {
                throw StaffCertWriteError.persistenceFailed
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "staff_certifications",
                    entityId: input.id,
                    action: .update,
                    actorCookId: context.actorCookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(updated),
                    shiftDate: context.shiftDate,
                    locationId: updated.locationId
                )
            )
            return updated
        }
    }

    // ── Convenience — retire = soft-delete (active = 0) ────────────────
    //
    // The board's "Retire" action PATCHes `{ id, active: false }`. Never a hard
    // DELETE — a live FK `shift_pic.cfpm_cert_id … ON DELETE SET NULL` would null
    // CFPM linkage on retire.

    @discardableResult
    public func retire(id: Int64, context: RegulatedWriteContext) throws -> StaffCertRow {
        try patch(input: StaffCertPatchInput(id: id, fields: [.active(false)]), context: context)
    }
}
