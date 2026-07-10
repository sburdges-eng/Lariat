import Foundation
import GRDB
import LariatModel

/// Doctor's-note documents attached to sick-worker reports (medical PHI —
/// design 2026-07-08-lariat-sick-note-docs). Attach is a PIN-gated audited
/// write (`actor_source = native_mac`); reads are location-scoped. Counts are
/// safe to read without a PIN (the UI shows "N on file" when locked); full
/// rows (filenames) are fetched only behind the manager-PIN read gate.
public struct SickNoteRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    /// Metadata-only audit payload for an attach write. Deliberately excludes
    /// `original_filename`: it is quasi-PHI that replicates to peer boxes via
    /// Family-1 `audit_events` sync, beyond a purge's reach (spec §7.5). The
    /// DB row itself still keeps `original_filename` — only the audit payload
    /// is stripped.
    private struct SickNoteAuditPayload: Encodable {
        let reportId: Int64
        let locationId: String
        let filePath: String
        let kind: String
        let uploadedBy: String?
        let uploadedAt: String
    }

    /// Record one attached document. The parent report must exist at the
    /// context's location (spec §8 location scoping; also prevents orphan
    /// rows). Insert + audit event commit in one transaction.
    @discardableResult
    public func attach(input: SickNoteAttachInput, context: RegulatedWriteContext) throws -> SickNoteDocumentRow {
        try AuditedWriteRunner.perform(db: writeDB) { db in
            guard try Int64.fetchOne(
                db,
                sql: "SELECT id FROM sick_worker_reports WHERE id = ? AND location_id = ?",
                arguments: [input.reportId, context.locationId]
            ) != nil else {
                throw SickNoteWriteError.reportNotFound
            }

            try db.execute(
                sql: """
                  INSERT INTO sick_note_documents
                    (report_id, location_id, file_path, kind, original_filename, uploaded_by, uploaded_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    input.reportId, context.locationId, input.filePath, input.kind.rawValue,
                    input.originalFilename, context.actorCookId, input.uploadedAt,
                ]
            )
            let newId = db.lastInsertedRowID
            guard let row = try SickNoteDocumentRow.fetchOne(
                db,
                sql: "SELECT * FROM sick_note_documents WHERE id = ?",
                arguments: [newId]
            ) else {
                throw SickNoteWriteError.persistenceFailed
            }
            // Payload is file metadata only — never symptoms/diagnosis (spec §8
            // PHI guard) and never original_filename (spec §7.5: quasi-PHI
            // that replicates to peer boxes via Family-1 audit_events sync,
            // beyond a purge's reach). The DB row (`row`, returned below)
            // still carries original_filename; only the audit payload omits it.
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "sick_note_documents",
                    entityId: newId,
                    action: .insert,
                    actorCookId: context.actorCookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(SickNoteAuditPayload(
                        reportId: row.reportId,
                        locationId: row.locationId,
                        filePath: row.filePath,
                        kind: row.kind,
                        uploadedBy: row.uploadedBy,
                        uploadedAt: row.uploadedAt
                    )),
                    shiftDate: context.shiftDate,
                    locationId: context.locationId
                )
            )
            return row
        }
    }

    /// Per-report document counts — PIN-free (drives the locked "N on file"
    /// row; exposes no filename or path).
    public func counts(reportIds: [Int64], locationId: String) async throws -> [Int64: Int] {
        try await readDB.pool.read { db in
            try Self.counts(db: db, reportIds: reportIds, locationId: locationId)
        }
    }

    /// Full document rows grouped by report — call only behind the manager-PIN
    /// read gate (filenames are PHI-adjacent).
    public func documents(reportIds: [Int64], locationId: String) async throws -> [Int64: [SickNoteDocumentRow]] {
        try await readDB.pool.read { db in
            guard !reportIds.isEmpty else { return [:] }
            let marks = Array(repeating: "?", count: reportIds.count).joined(separator: ",")
            let rows = try SickNoteDocumentRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM sick_note_documents
                   WHERE location_id = ? AND report_id IN (\(marks))
                   ORDER BY id
                  """,
                arguments: StatementArguments([locationId] as [DatabaseValueConvertible] + reportIds.map { $0 as DatabaseValueConvertible })
            )
            return Dictionary(grouping: rows, by: \.reportId)
        }
    }

    /// Metadata-only audit payload for a purge (retention-driven delete).
    /// Deliberately excludes `original_filename` (spec §7.5, same rationale as
    /// `SickNoteAuditPayload` above) and never touches symptoms/diagnosis —
    /// this is document metadata only.
    private struct SickNotePurgePayload: Encodable {
        let documentId: Int64
        let reportId: Int64
        let locationId: String
        let filePath: String
        let uploadedAt: String
    }

    /// Delete one document row + audit event in one transaction (the first
    /// deleter of this data — audit P0-6 retention purge). Returns the row's
    /// `file_path` so the caller unlinks the on-disk ciphertext AFTER commit;
    /// filesystem side-effects deliberately stay out of the DB transaction.
    /// Returns `nil` if no row matches at the context's location — a no-op
    /// that writes no audit event (nothing happened, nothing to record).
    @discardableResult
    public func purge(documentId: Int64, context: RegulatedWriteContext) throws -> String? {
        try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let row = try SickNoteDocumentRow.fetchOne(
                db,
                sql: "SELECT * FROM sick_note_documents WHERE id = ? AND location_id = ?",
                arguments: [documentId, context.locationId]
            ) else { return nil }

            try db.execute(sql: "DELETE FROM sick_note_documents WHERE id = ?", arguments: [documentId])
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "sick_note_documents",
                    entityId: row.id,
                    action: .delete,
                    actorCookId: context.actorCookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(SickNotePurgePayload(
                        documentId: row.id,
                        reportId: row.reportId,
                        locationId: row.locationId,
                        filePath: row.filePath,
                        uploadedAt: row.uploadedAt
                    )),
                    note: "retention purge",
                    shiftDate: context.shiftDate,
                    locationId: row.locationId
                )
            )
            return row.filePath
        }
    }

    /// Documents past the retention window, filtered in Swift via
    /// `SickNoteRetention.isOverdue` so the fail-open policy lives in one
    /// tested place (a malformed `uploaded_at` never counts as overdue).
    public func overdueDocuments(locationId: String, now: Date) throws -> [SickNoteDocumentRow] {
        let rows = try writeDB.pool.read { db in
            try SickNoteDocumentRow.fetchAll(
                db,
                sql: "SELECT * FROM sick_note_documents WHERE location_id = ? ORDER BY uploaded_at",
                arguments: [locationId]
            )
        }
        return rows.filter { SickNoteRetention.isOverdue(uploadedAt: $0.uploadedAt, now: now) }
    }

    /// Document rows whose parent `sick_worker_reports` row no longer exists.
    /// There is no FK on `report_id`, so orphans are possible (e.g. a report
    /// deleted out from under its attachments) and must still be purgeable.
    public func orphanDocuments(locationId: String) throws -> [SickNoteDocumentRow] {
        try writeDB.pool.read { db in
            try SickNoteDocumentRow.fetchAll(db, sql: """
                SELECT d.* FROM sick_note_documents d
                LEFT JOIN sick_worker_reports r ON d.report_id = r.id
                WHERE d.location_id = ? AND r.id IS NULL
                ORDER BY d.uploaded_at
                """, arguments: [locationId])
        }
    }

    public static func counts(db: Database, reportIds: [Int64], locationId: String) throws -> [Int64: Int] {
        guard !reportIds.isEmpty else { return [:] }
        let marks = Array(repeating: "?", count: reportIds.count).joined(separator: ",")
        let rows = try Row.fetchAll(
            db,
            sql: """
              SELECT report_id, COUNT(*) AS n FROM sick_note_documents
               WHERE location_id = ? AND report_id IN (\(marks))
               GROUP BY report_id
              """,
            arguments: StatementArguments([locationId] as [DatabaseValueConvertible] + reportIds.map { $0 as DatabaseValueConvertible })
        )
        var out: [Int64: Int] = [:]
        for r in rows { out[r["report_id"]] = r["n"] }
        return out
    }
}
