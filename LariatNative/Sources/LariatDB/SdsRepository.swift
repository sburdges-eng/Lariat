import Foundation
import GRDB
import LariatModel

/// Repository for the SDS registry — behavior parity with `app/api/sds/route.ts`
/// (OSHA HazCom, 29 CFR 1910.1200). Reads via the read-only pool; the regulated
/// write (register a product) goes through `AuditedWriteRunner` so the
/// `sds_registry` INSERT and its `audit_events` row commit (or roll back) in ONE
/// transaction. Status semantics mirror the web route:
///   - any invalid field → validationFailed (web 400)
/// There is no 422 corrective-note gate and no PIN gate on this surface — the
/// web POST returns only 200 / 400 / 500.
public struct SdsRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET — active registry for a location ───────────────────────────

    public func load(
        locationId: String = LocationScope.resolve()
    ) async throws -> SdsBoardSnapshot {
        try await readDB.pool.read { db in
            let rows = try SdsRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM sds_registry
                   WHERE location_id = ? AND active = 1
                   ORDER BY product_name ASC
                  """,
                arguments: [locationId]
            )
            return SdsBoardSnapshot(locationId: locationId, rows: rows)
        }
    }

    // ── POST — register a product ──────────────────────────────────────

    @discardableResult
    public func register(input: SdsInput, context: RegulatedWriteContext) throws -> SdsRow {
        // Validate against the raw input (parity with web `validateSds`). Web
        // returns 400 for every failure here — surfaced as validationFailed.
        let decision = SdsCompute.validate(
            productName: input.productName,
            manufacturer: input.manufacturer,
            hazardClass: input.hazardClass,
            storageLocation: input.storageLocation,
            pdfPath: input.pdfPath,
            url: input.url,
            lastReviewed: input.lastReviewed,
            active: input.active,
            cookId: input.cookId
        )
        let norm: SdsCompute.NormalizedSds
        switch decision {
        case .failure(let reason): throw SdsWriteError.validationFailed(reason)
        case .ok(let v): norm = v
        }

        // The web route re-clips each field to its route limit (a no-op after the
        // validator's length bounds pass) and defaults last_reviewed → today,
        // active → 1. Mirror exactly.
        let locationId = context.locationId
        let productName = clip(norm.productName, max: SdsCompute.productNameMaxLen)!
        let manufacturer = clip(norm.manufacturer, max: SdsCompute.manufacturerMaxLen)
        let hazardClass = clip(norm.hazardClass, max: SdsCompute.hazardClassMaxLen)
        let storageLocation = clip(norm.storageLocation, max: SdsCompute.storageLocationMaxLen)
        let pdfPath = clip(norm.pdfPath, max: SdsCompute.pdfPathMaxLen)
        let url = clip(norm.url, max: SdsCompute.urlMaxLen)
        let lastReviewed = clip(norm.lastReviewed, max: SdsCompute.lastReviewedMaxLen) ?? ShiftDate.todayISO()
        let cookId = clip(norm.cookId, max: SdsCompute.cookIdMaxLen) ?? context.actorCookId
        let active: Int64 = (norm.active != nil) ? Int64(norm.active!) : 1

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO sds_registry
                    (location_id, product_name, manufacturer, hazard_class, storage_location, pdf_path, url, last_reviewed, active)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    locationId, productName, manufacturer, hazardClass, storageLocation,
                    pdfPath, url, lastReviewed, active,
                ]
            )
            let newId = db.lastInsertedRowID
            guard let row = try SdsRow.fetchOne(
                db, sql: "SELECT * FROM sds_registry WHERE id = ?", arguments: [newId]
            ) else {
                throw SdsWriteError.persistenceFailed
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "sds_registry",
                    entityId: newId,
                    action: .insert,
                    actorCookId: cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(row),
                    shiftDate: context.shiftDate,
                    locationId: locationId
                )
            )
            return row
        }
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}
