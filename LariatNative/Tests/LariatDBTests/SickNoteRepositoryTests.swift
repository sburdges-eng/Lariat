import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class SickNoteRepositoryTests: XCTestCase {

    private func macContext(locationId: String = "default", actor: String? = "mgr-1") -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: actor,
            actorSource: RegulatedWriteContext.nativeMacActorSource,
            locationId: locationId,
            shiftDate: "2026-07-08"
        )
    }

    func testAttachInsertsRowAndAuditEvent() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let reportId = try seedReport(writeDB: writeDB)

        let repo = SickNoteRepository(readDB: readDB, writeDB: writeDB)
        let doc = try repo.attach(
            input: SickNoteAttachInput(
                reportId: reportId,
                filePath: "sick-notes/\(reportId)/u.pdf",
                kind: .note,
                originalFilename: "note.pdf",
                uploadedAt: "2026-07-08T00:00:00.000Z"
            ),
            context: macContext()
        )
        XCTAssertEqual(doc.reportId, reportId)
        XCTAssertEqual(doc.kindValue, .note)
        XCTAssertEqual(doc.filePath, "sick-notes/\(reportId)/u.pdf")
        XCTAssertEqual(doc.uploadedBy, "mgr-1")

        // Read path: exercise the production documents() method the UI calls.
        let byReport = try await repo.documents(reportIds: [reportId], locationId: "default")
        XCTAssertEqual(byReport[reportId]?.count, 1)
        XCTAssertEqual(byReport[reportId]?.first?.originalFilename, "note.pdf")

        try await writeDB.pool.read { db in
            let audits = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM audit_events WHERE entity='sick_note_documents' AND action='insert' AND actor_source='native_mac'"
            )
            XCTAssertEqual(audits, 1)   // one audit row per attach, same transaction
            // PHI guard (spec §8): the audit payload is file metadata only —
            // symptoms/diagnosis must never be echoed into audit_events.
            let payload = try String.fetchOne(db, sql: "SELECT payload_json FROM audit_events LIMIT 1") ?? ""
            XCTAssertFalse(payload.contains("symptom"))
            XCTAssertFalse(payload.contains("diagnos"))
            // (JSONEncoder escapes "/" so match on field name + filename.)
            XCTAssertTrue(payload.contains("file_path"))
            XCTAssertTrue(payload.contains("u.pdf"))
            // original_filename is quasi-PHI that replicates to peer boxes via
            // Family-1 audit_events sync, beyond a purge's reach (spec §7.5) —
            // it must never enter the audit payload (the DB row still keeps it,
            // asserted above via byReport[reportId]?.first?.originalFilename).
            XCTAssertFalse(payload.contains("note.pdf"), "original_filename must NOT enter the audit payload")
            XCTAssertFalse(payload.contains("original_filename"))
        }
    }

    func testAttachUnknownReportThrowsAndWritesNothing() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }

        let repo = SickNoteRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.attach(
                input: SickNoteAttachInput(
                    reportId: 999, filePath: "sick-notes/999/u.pdf", kind: .note,
                    originalFilename: nil, uploadedAt: "2026-07-08T00:00:00.000Z"
                ),
                context: macContext()
            )
        ) { error in
            XCTAssertEqual(error as? SickNoteWriteError, .reportNotFound)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM sick_note_documents") ?? -1, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
        }
    }

    func testAttachCrossLocationReportThrows() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let reportId = try seedReport(writeDB: writeDB, locationId: "default")

        let repo = SickNoteRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(
            try repo.attach(
                input: SickNoteAttachInput(
                    reportId: reportId, filePath: "sick-notes/\(reportId)/u.pdf", kind: .note,
                    originalFilename: nil, uploadedAt: "2026-07-08T00:00:00.000Z"
                ),
                context: macContext(locationId: "other-site")
            )
        ) { error in
            XCTAssertEqual(error as? SickNoteWriteError, .reportNotFound)
        }
    }

    func testDocumentsScopedByReportAndLocation() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let r1 = try seedReport(writeDB: writeDB, cookId: "alice")
        let r2 = try seedReport(writeDB: writeDB, cookId: "bob")

        let repo = SickNoteRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.attach(
            input: SickNoteAttachInput(reportId: r1, filePath: "sick-notes/\(r1)/a.pdf", kind: .note,
                                       originalFilename: nil, uploadedAt: "t1"),
            context: macContext()
        )
        _ = try repo.attach(
            input: SickNoteAttachInput(reportId: r2, filePath: "sick-notes/\(r2)/b.pdf", kind: .clearance,
                                       originalFilename: nil, uploadedAt: "t2"),
            context: macContext()
        )

        // Production read path (grouped by report), incl. spec §8 location scoping.
        let inDefault = try await repo.documents(reportIds: [r1, r2], locationId: "default")
        XCTAssertEqual(inDefault[r1]?.count, 1)
        XCTAssertEqual(inDefault[r2]?.first?.kindValue, .clearance)
        // A different location sees nothing for the same report ids.
        let inOther = try await repo.documents(reportIds: [r1, r2], locationId: "other-site")
        XCTAssertTrue(inOther.isEmpty)
        // Empty id list is a no-op, not a SQL error.
        let none = try await repo.documents(reportIds: [], locationId: "default")
        XCTAssertTrue(none.isEmpty)
    }

    func testCountsGroupsByReport() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let r1 = try seedReport(writeDB: writeDB, cookId: "alice")
        let r2 = try seedReport(writeDB: writeDB, cookId: "bob")

        let repo = SickNoteRepository(readDB: readDB, writeDB: writeDB)
        for _ in 0..<2 {
            _ = try repo.attach(
                input: SickNoteAttachInput(reportId: r1, filePath: "sick-notes/\(r1)/x.pdf", kind: .note,
                                           originalFilename: nil, uploadedAt: "t"),
                context: macContext()
            )
        }

        try writeDB.pool.read { db in
            let counts = try SickNoteRepository.counts(db: db, reportIds: [r1, r2], locationId: "default")
            XCTAssertEqual(counts[r1], 2)
            XCTAssertNil(counts[r2])    // no docs → absent, callers default to 0
            // Empty id list is a no-op, not a SQL error.
            XCTAssertTrue(try SickNoteRepository.counts(db: db, reportIds: [], locationId: "default").isEmpty)
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────

    /// Insert a parent sick-worker report row; returns its id.
    private func seedReport(
        writeDB: LariatWriteDatabase,
        locationId: String = "default",
        cookId: String = "alice"
    ) throws -> Int64 {
        try writeDB.pool.write { db in
            try db.execute(
                sql: """
                  INSERT INTO sick_worker_reports
                    (shift_date, location_id, cook_id, symptoms, action, started_at)
                  VALUES (?, ?, ?, 'vomiting', 'excluded', '2026-07-08T00:00:00.000Z')
                  """,
                arguments: ["2026-07-08", locationId, cookId]
            )
            return db.lastInsertedRowID
        }
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedSickNoteDatabase()
        return (try LariatDatabase(path: path), try LariatWriteDatabase(path: path), path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedSickNoteDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-sicknote-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        // Mirror the REAL web schema from lib/db.ts (sick_worker_reports ~L2626,
        // sick_note_documents just below it).
        try db.execute(sql: """
            CREATE TABLE sick_worker_reports (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              cook_id TEXT NOT NULL,
              reported_by_pic_id TEXT,
              symptoms TEXT NOT NULL,
              diagnosed_illness TEXT,
              action TEXT NOT NULL
                CHECK(action IN ('excluded','restricted','monitor','none')),
              started_at TEXT NOT NULL,
              return_at TEXT,
              clearance_source TEXT,
              note TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE sick_note_documents (
              id                INTEGER PRIMARY KEY AUTOINCREMENT,
              report_id         INTEGER NOT NULL,
              location_id       TEXT    NOT NULL,
              file_path         TEXT    NOT NULL,
              kind              TEXT    NOT NULL,
              original_filename TEXT,
              uploaded_by       TEXT,
              uploaded_at       TEXT    NOT NULL
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
