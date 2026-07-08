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
            // Payload is the document row — file metadata only, never
            // symptoms/diagnosis (spec §8 PHI guard).
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "sick_note_documents",
                    entityId: newId,
                    action: .insert,
                    actorCookId: context.actorCookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(row),
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

    public static func list(db: Database, reportId: Int64, locationId: String) throws -> [SickNoteDocumentRow] {
        try SickNoteDocumentRow.fetchAll(
            db,
            sql: """
              SELECT * FROM sick_note_documents
               WHERE report_id = ? AND location_id = ?
               ORDER BY id
              """,
            arguments: [reportId, locationId]
        )
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
