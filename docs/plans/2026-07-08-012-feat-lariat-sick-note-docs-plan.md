# Sick-Leave Doctor's-Note Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager/PIC attach a doctor's-note document to a sick-worker record in the native app and view it behind a PIN (medical PHI).

**Architecture:** A new web-owned `sick_note_documents` table (native replays a regenerated frozen schema). Pure `LariatModel` validation + path derivation; a `LariatDB` audited-insert repository; native `SickWorkerView` gains a PIN-gated attach (`NSOpenPanel` → copy into `data/uploads/sick-notes/`) and a PIN-gated view (`RegulatedReadGate` → open in OS viewer).

**Tech Stack:** Swift 5.9 / SwiftPM (LariatModel pure, LariatDB = GRDB, LariatApp = SwiftUI + AppKit, macOS-only); web = Next.js `lib/db.ts` for the schema declaration only.

## Global Constraints

- **Schema is web-owned.** The `CREATE TABLE` lands in web `lib/db.ts initSchema()`; native's `frozen_schema.sql` is regenerated (`node scripts/dump-fresh-schema.mjs --executable`) so its `SchemaMigrator` replay stays byte-parity. No data migration (additive table). (spec §3)
- **Medical PHI.** Attach = PIN-gated audited write (`actor_source = native_mac`, `audit_events` in-tx). View/open = `RegulatedReadGate` (PIN); un-PINned users see only a count, never filename or open. (spec §5, §8)
- **File-type allowlist (exact):** `.pdf`, `.jpeg`/`.jpg`, `.png`, `.heic` — enforced at the `NSOpenPanel` AND re-checked by the pure validator. (spec §9)
- **Storage:** off-tree at `data/uploads/sick-notes/<report_id>/<uuid>.<ext>`; UUID filenames; `original_filename` display-only. `data/uploads/` is already gitignored (confirm). (spec §7)
- **kind:** `'note' | 'clearance'` (enum). (spec §3)
- **Test homes:** parity-critical validation/path → `LariatModel` (XCTest); repository insert/list → `LariatDB` (XCTest); `NSOpenPanel`/copy/open UI → `LariatApp` build-verified (no App test target), stated honestly. (spec §6)
- **Native gate:** `swift build && swift test` from `LariatNative/`. **Web gate:** `npm run typecheck`.
- **Do NOT** echo PHI (symptoms/diagnosis) into audit payloads. (spec §8)

---

## File Structure

**Create:**
- `LariatNative/Sources/LariatModel/SickNoteDocument.swift` — record + `SickNoteDocumentCompute` (validation + path derivation + `kind` enum).
- `LariatNative/Tests/LariatModelTests/SickNoteDocumentComputeTests.swift`
- `LariatNative/Sources/LariatDB/SickNoteRepository.swift` — audited `attach` + `list`.
- `LariatNative/Tests/LariatDBTests/SickNoteRepositoryTests.swift`
- `LariatNative/Sources/LariatApp/SickNoteAttach.swift` — AppKit panel + file copy helper (build-verified).

**Modify:**
- `lib/db.ts` (web `initSchema`) — declare `sick_note_documents`.
- `LariatNative/Sources/LariatDB/Resources/frozen_schema.sql` — regenerated (do not hand-edit).
- `LariatNative/Sources/LariatApp/SickWorkerView.swift` — attach action + PIN-gated document list/open.
- `docs/superpowers/specs/2026-07-08-lariat-sick-note-docs-design.md` — mark Status: Implemented.

---

## Task 1: Web schema — sick_note_documents + native frozen-schema regen

**Files:**
- Modify: `lib/db.ts` (in `initSchema`, next to the `sick_worker_reports` CREATE at ~line 2626)
- Modify (generated): `LariatNative/Sources/LariatDB/Resources/frozen_schema.sql`

**Interfaces:**
- Produces: the `sick_note_documents` table shape all later tasks depend on.

- [ ] **Step 1: Add the table to web initSchema**

In `lib/db.ts`, inside `initSchema`, add (mirroring the surrounding `CREATE TABLE IF NOT EXISTS` style):

```sql
CREATE TABLE IF NOT EXISTS sick_note_documents (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id         INTEGER NOT NULL,
  location_id       TEXT    NOT NULL,
  file_path         TEXT    NOT NULL,
  kind              TEXT    NOT NULL,
  original_filename TEXT,
  uploaded_by       TEXT,
  uploaded_at       TEXT    NOT NULL
);
```

- [ ] **Step 2: Verify web typecheck + that the table initializes**

Run: `npm run typecheck`
Expected: success (no type errors; `.js` schema string change is inert to tsc but confirms no syntax break).
Run: `node -e "const {initSchema}=await import('./lib/db.ts'); const D=(await import('better-sqlite3')).default; const db=new D(':memory:'); initSchema(db); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name='sick_note_documents'\").get());"`
Expected: prints `{ name: 'sick_note_documents' }`.

- [ ] **Step 3: Regenerate native frozen schema**

Run: `node scripts/dump-fresh-schema.mjs --executable`
Expected: `LariatNative/Sources/LariatDB/Resources/frozen_schema.sql` now contains `sick_note_documents`. Do not hand-edit it.

- [ ] **Step 4: Verify native schema parity**

Run: `cd LariatNative && swift test --filter SchemaMigratorTests`
Expected: PASS (frozen replay still matches the web baseline; the new table is present).

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts LariatNative/Sources/LariatDB/Resources/frozen_schema.sql
AGENT_NAME=claude git commit -m "T1: sick_note_documents table (web schema + native frozen regen)"
```

---

## Task 2: LariatModel — SickNoteDocument record + validation/path compute

**Files:**
- Create: `LariatNative/Sources/LariatModel/SickNoteDocument.swift`
- Test: `LariatNative/Tests/LariatModelTests/SickNoteDocumentComputeTests.swift`

**Interfaces:**
- Produces: `SickNoteKind` enum (`.note`/`.clearance`, `rawValue` "note"/"clearance"); `SickNoteDocument` record; `SickNoteDocumentCompute.allowedExtensions` (Set), `.validate(filename:) -> Bool`, `.storedPath(reportId:uuid:ext:) -> String`. Task 3 (repo) + Task 4/5 (UI) consume these.

- [ ] **Step 1: Write the failing test**

Create `LariatNative/Tests/LariatModelTests/SickNoteDocumentComputeTests.swift`:

```swift
import XCTest
@testable import LariatModel

final class SickNoteDocumentComputeTests: XCTestCase {

    func testAllowlistAcceptsApprovedTypes() {
        for name in ["note.pdf", "SCAN.PDF", "photo.jpg", "photo.jpeg", "img.png", "iphone.heic"] {
            XCTAssertTrue(SickNoteDocumentCompute.validate(filename: name), "should accept \(name)")
        }
    }

    func testAllowlistRejectsOtherTypes() {
        for name in ["note.docx", "sheet.xlsx", "malware.exe", "noext", "archive.zip"] {
            XCTAssertFalse(SickNoteDocumentCompute.validate(filename: name), "should reject \(name)")
        }
    }

    func testStoredPathShape() {
        let p = SickNoteDocumentCompute.storedPath(reportId: 42, uuid: "abc123", ext: "pdf")
        XCTAssertEqual(p, "sick-notes/42/abc123.pdf")
    }

    func testStoredPathLowercasesExtension() {
        XCTAssertEqual(SickNoteDocumentCompute.storedPath(reportId: 7, uuid: "u", ext: "HEIC"),
                       "sick-notes/7/u.heic")
    }

    func testKindRawValues() {
        XCTAssertEqual(SickNoteKind.note.rawValue, "note")
        XCTAssertEqual(SickNoteKind.clearance.rawValue, "clearance")
        XCTAssertEqual(SickNoteKind(rawValue: "clearance"), .clearance)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd LariatNative && swift test --filter SickNoteDocumentComputeTests`
Expected: FAIL — "cannot find 'SickNoteDocumentCompute' / 'SickNoteKind' in scope".

- [ ] **Step 3: Write minimal implementation**

Create `LariatNative/Sources/LariatModel/SickNoteDocument.swift`:

```swift
import Foundation

public enum SickNoteKind: String, Equatable, Sendable, CaseIterable {
    case note
    case clearance
}

/// One attached doctor's-note document (row of sick_note_documents).
public struct SickNoteDocument: Equatable, Sendable {
    public let id: Int64
    public let reportId: Int64
    public let locationId: String
    public let filePath: String
    public let kind: SickNoteKind
    public let originalFilename: String?
    public let uploadedBy: String?
    public let uploadedAt: String

    public init(id: Int64, reportId: Int64, locationId: String, filePath: String,
                kind: SickNoteKind, originalFilename: String?, uploadedBy: String?, uploadedAt: String) {
        self.id = id; self.reportId = reportId; self.locationId = locationId; self.filePath = filePath
        self.kind = kind; self.originalFilename = originalFilename; self.uploadedBy = uploadedBy; self.uploadedAt = uploadedAt
    }
}

public enum SickNoteDocumentCompute {
    /// Lowercased extensions accepted for a doctor's-note attachment (spec §9).
    public static let allowedExtensions: Set<String> = ["pdf", "jpg", "jpeg", "png", "heic"]

    /// True when the filename's extension is in the allowlist (case-insensitive).
    public static func validate(filename: String) -> Bool {
        let ext = (filename as NSString).pathExtension.lowercased()
        return !ext.isEmpty && allowedExtensions.contains(ext)
    }

    /// Relative storage path under data/uploads/ — UUID filename, lowercased ext.
    public static func storedPath(reportId: Int64, uuid: String, ext: String) -> String {
        "sick-notes/\(reportId)/\(uuid).\(ext.lowercased())"
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd LariatNative && swift test --filter SickNoteDocumentComputeTests`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatModel/SickNoteDocument.swift \
        LariatNative/Tests/LariatModelTests/SickNoteDocumentComputeTests.swift
AGENT_NAME=claude git commit -m "T2: SickNoteDocument record + validation/path compute"
```

---

## Task 3: LariatDB — SickNoteRepository (audited attach + list)

**Files:**
- Create: `LariatNative/Sources/LariatDB/SickNoteRepository.swift`
- Test: `LariatNative/Tests/LariatDBTests/SickNoteRepositoryTests.swift`

**Interfaces:**
- Consumes: `SickNoteDocument`, `SickNoteKind` (Task 2), `AuditedWriteRunner`, `AuditEventWriter`, `AuditEventInput`, `RegulatedWriteContext` (existing LariatDB).
- Produces: `SickNoteRepository(writeDB:)` with `attach(reportId:locationId:filePath:kind:originalFilename:uploadedAt:context:) throws -> SickNoteDocument` and `static func list(db:reportId:) throws -> [SickNoteDocument]`. Task 4/5 UI calls these.

**Template:** mirror `BreakRepository.start` (`BreakRepository.swift:92-143`): `AuditedWriteRunner.perform` → `INSERT` → fetch row by `lastInsertedRowID` → `AuditEventWriter.post` with `AuditEventInput(entity:"sick_note_documents", action:.insert, actorSource: context.actorSource, payloadJSON: encodePayload(row), locationId:)`.

- [ ] **Step 1: Write the failing test**

Create `LariatNative/Tests/LariatDBTests/SickNoteRepositoryTests.swift`:

```swift
import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class SickNoteRepositoryTests: XCTestCase {

    private func makeWriteDB() throws -> DatabaseQueue {
        let db = try DatabaseQueue()
        try db.write { d in
            try d.execute(sql: """
                CREATE TABLE sick_note_documents (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  report_id INTEGER NOT NULL, location_id TEXT NOT NULL, file_path TEXT NOT NULL,
                  kind TEXT NOT NULL, original_filename TEXT, uploaded_by TEXT, uploaded_at TEXT NOT NULL);
                CREATE TABLE audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT, entity_id INTEGER,
                  action TEXT, actor_cook_id TEXT, actor_source TEXT, payload_json TEXT, shift_date TEXT,
                  location_id TEXT, created_at TEXT);
                """)
        }
        return db
    }

    func testAttachInsertsRowAndAuditEvent() throws {
        let db = try makeWriteDB()
        let repo = SickNoteRepository(writeDB: db)
        let ctx = RegulatedWriteContext.nativeMac(actorCookId: "mgr1")
        let doc = try repo.attach(reportId: 42, locationId: "default",
                                  filePath: "sick-notes/42/u.pdf", kind: .note,
                                  originalFilename: "note.pdf", uploadedAt: "2026-07-08T00:00:00Z", context: ctx)
        XCTAssertEqual(doc.reportId, 42)
        XCTAssertEqual(doc.kind, .note)
        XCTAssertEqual(doc.filePath, "sick-notes/42/u.pdf")

        try db.read { d in
            let rows = try SickNoteRepository.list(db: d, reportId: 42)
            XCTAssertEqual(rows.count, 1)
            let audits = try Int.fetchOne(d, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='sick_note_documents' AND action='insert'")
            XCTAssertEqual(audits, 1)   // one audit row per attach
            // PHI guard: payload must not carry symptoms/diagnosis fields
            let payload = try String.fetchOne(d, sql: "SELECT payload_json FROM audit_events LIMIT 1") ?? ""
            XCTAssertFalse(payload.contains("symptom"))
            XCTAssertFalse(payload.contains("diagnos"))
        }
    }

    func testListScopedByReport() throws {
        let db = try makeWriteDB()
        let repo = SickNoteRepository(writeDB: db)
        let ctx = RegulatedWriteContext.nativeMac(actorCookId: "mgr1")
        _ = try repo.attach(reportId: 1, locationId: "default", filePath: "sick-notes/1/a.pdf", kind: .note, originalFilename: nil, uploadedAt: "t", context: ctx)
        _ = try repo.attach(reportId: 2, locationId: "default", filePath: "sick-notes/2/b.pdf", kind: .clearance, originalFilename: nil, uploadedAt: "t", context: ctx)
        try db.read { d in
            XCTAssertEqual(try SickNoteRepository.list(db: d, reportId: 1).count, 1)
            XCTAssertEqual(try SickNoteRepository.list(db: d, reportId: 2).first?.kind, .clearance)
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd LariatNative && swift test --filter SickNoteRepositoryTests`
Expected: FAIL — "cannot find 'SickNoteRepository' in scope".

- [ ] **Step 3: Write minimal implementation**

Create `LariatNative/Sources/LariatDB/SickNoteRepository.swift` (mirror `BreakRepository`; adapt the `RegulatedWriteContext.nativeMac` factory name to the one that file actually uses — verify against `RegulatedWriteContext`):

```swift
import Foundation
import GRDB
import LariatModel

public struct SickNoteRepository {
    private let writeDB: DatabaseWriter
    public init(writeDB: DatabaseWriter) { self.writeDB = writeDB }

    @discardableResult
    public func attach(reportId: Int64, locationId: String, filePath: String, kind: SickNoteKind,
                       originalFilename: String?, uploadedAt: String,
                       context: RegulatedWriteContext) throws -> SickNoteDocument {
        try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(sql: """
                INSERT INTO sick_note_documents
                  (report_id, location_id, file_path, kind, original_filename, uploaded_by, uploaded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                arguments: [reportId, locationId, filePath, kind.rawValue,
                            originalFilename, context.actorCookId, uploadedAt])
            let newId = db.lastInsertedRowID
            let row = try SickNoteRepository.row(db: db, id: newId)
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "sick_note_documents", entityId: newId, action: .insert,
                actorCookId: context.actorCookId, actorSource: context.actorSource,
                payloadJSON: AuditEventWriter.encodePayload(row),   // file metadata only, no PHI
                shiftDate: nil, locationId: locationId))
            return row
        }
    }

    public static func list(db: Database, reportId: Int64) throws -> [SickNoteDocument] {
        try Row.fetchAll(db, sql: """
            SELECT id, report_id, location_id, file_path, kind, original_filename, uploaded_by, uploaded_at
              FROM sick_note_documents WHERE report_id = ? ORDER BY id
            """, arguments: [reportId]).map(mapRow)
    }

    private static func row(db: Database, id: Int64) throws -> SickNoteDocument {
        guard let r = try Row.fetchOne(db, sql: "SELECT * FROM sick_note_documents WHERE id = ?", arguments: [id])
        else { throw DatabaseError(message: "sick_note_documents row \(id) not found after insert") }
        return mapRow(r)
    }

    private static func mapRow(_ r: Row) -> SickNoteDocument {
        SickNoteDocument(
            id: r["id"], reportId: r["report_id"], locationId: r["location_id"], filePath: r["file_path"],
            kind: SickNoteKind(rawValue: r["kind"]) ?? .note,
            originalFilename: r["original_filename"], uploadedBy: r["uploaded_by"], uploadedAt: r["uploaded_at"])
    }
}
```

Note (`encodePayload` PHI guard): the payload is `SickNoteDocument` (file metadata) — it structurally cannot contain symptoms/diagnosis, satisfying the test's PHI assertions.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd LariatNative && swift test --filter SickNoteRepositoryTests`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatDB/SickNoteRepository.swift \
        LariatNative/Tests/LariatDBTests/SickNoteRepositoryTests.swift
AGENT_NAME=claude git commit -m "T3: SickNoteRepository audited attach + list"
```

---

## Task 4: Native attach — panel + copy helper + SickWorkerView action

**Files:**
- Create: `LariatNative/Sources/LariatApp/SickNoteAttach.swift`
- Modify: `LariatNative/Sources/LariatApp/SickWorkerView.swift`

**Interfaces:**
- Consumes: `SickNoteDocumentCompute` (Task 2), `SickNoteRepository` (Task 3), `RegulatedWriteContext`, `PinSessionStore`/`ManagementWrite`, `LariatWriteDatabase`.
- Produces: `SickNoteAttach.pickAndCopy(reportId:dataDir:) -> (filePath: String, originalFilename: String)?` (AppKit) — throws/returns nil on cancel or invalid type.

**Verification is `swift build`** (no App test target — state honestly).

- [ ] **Step 1: Create the AppKit panel + copy helper**

Create `LariatNative/Sources/LariatApp/SickNoteAttach.swift`:

```swift
#if canImport(AppKit)
import AppKit
import Foundation
import UniformTypeIdentifiers
import LariatModel

enum SickNoteAttach {
    /// Presents an open panel restricted to the allowlist, copies the picked file to
    /// data/uploads/<storedPath>, and returns the stored relative path + original name.
    /// Returns nil on cancel. Throws on copy failure or a rejected type.
    static func pickAndCopy(reportId: Int64, dataDir: URL) throws -> (filePath: String, originalFilename: String)? {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.pdf, .jpeg, .png, UTType(filenameExtension: "heic") ?? .image]
        guard panel.runModal() == .OK, let src = panel.url else { return nil }

        let name = src.lastPathComponent
        guard SickNoteDocumentCompute.validate(filename: name) else {
            throw SickNoteAttachError.unsupportedType(name)
        }
        let ext = (name as NSString).pathExtension
        let rel = SickNoteDocumentCompute.storedPath(reportId: reportId, uuid: UUID().uuidString, ext: ext)
        let dest = dataDir.appendingPathComponent("uploads").appendingPathComponent(rel)
        try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: src, to: dest)
        return (filePath: rel, originalFilename: name)
    }
}

enum SickNoteAttachError: LocalizedError {
    case unsupportedType(String)
    var errorDescription: String? {
        switch self { case .unsupportedType(let n): return "\(n) isn't an allowed document type (PDF, JPEG, PNG, HEIC)." }
    }
}
#endif
```

- [ ] **Step 2: Wire the attach action into SickWorkerView (PIN-gated)**

In `SickWorkerView.swift`, add a per-report "Attach doctor's note" button that (a) requires a PIN session via the existing `ManagementWrite`/`PinSessionStore` pattern used elsewhere in this view, (b) presents a `kind` picker (note | clearance), (c) calls `SickNoteAttach.pickAndCopy`, (d) on success calls `SickNoteRepository(writeDB: writeDB).attach(...)` with `RegulatedWriteContext.nativeMac(actorCookId: pinUser)` and the picker's `kind`, `uploadedAt` = now-ISO. Surface `SickNoteAttachError`/copy errors inline (no crash). Follow the interrupt/cook-identity + error-banner conventions already in `SickWorkerView`.

- [ ] **Step 3: Verify build + full suite**

Run: `cd LariatNative && swift build && swift test`
Expected: build clean; all tests pass (Tasks 1–3 included).

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/SickNoteAttach.swift \
        LariatNative/Sources/LariatApp/SickWorkerView.swift
AGENT_NAME=claude git commit -m "T4: native attach — panel + copy + PIN-gated SickWorkerView action (build-verified)"
```

---

## Task 5: Native view — PIN-gated document list + open

**Files:**
- Modify: `LariatNative/Sources/LariatApp/SickWorkerView.swift`

**Interfaces:**
- Consumes: `SickNoteRepository.list` (Task 3), `RegulatedReadGate` (existing), `SickNoteDocument` (Task 2).

**Verification is `swift build`** (no App test target).

- [ ] **Step 1: Add the PIN-gated document section**

In `SickWorkerView.swift`, for each report render its documents via `SickNoteRepository.list(db:reportId:)`. Gate with `RegulatedReadGate.evaluate(...)` (the same seam #447 introduced):
- `.locked` → show only `"\(count) document(s) on file"` + an "Unlock" affordance; no filename, no open button.
- `.open` → list each doc's `originalFilename ?? filePath` + `kind`, with an **Open** button calling:

```swift
private func openDocument(_ doc: SickNoteDocument, dataDir: URL) {
    let url = dataDir.appendingPathComponent("uploads").appendingPathComponent(doc.filePath)
    if FileManager.default.fileExists(atPath: url.path) {
        NSWorkspace.shared.open(url)
    } else {
        // set an inline "file not found" message; the DB row can outlive the file
    }
}
```
- `.unavailable` → the existing degrade message.

- [ ] **Step 2: Verify build**

Run: `cd LariatNative && swift build && swift test`
Expected: build clean; suite green.

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/SickWorkerView.swift
AGENT_NAME=claude git commit -m "T5: native PIN-gated doctor's-note list + open (build-verified)"
```

---

## Task 6: Docs — status + deferred follow-ons

**Files:**
- Modify: `docs/superpowers/specs/2026-07-08-lariat-sick-note-docs-design.md`

- [ ] **Step 1: Mark Status: Implemented** and record the deferred follow-ons explicitly (employee self-service entry; retention/purge policy; optional web read-only view of the docs list). Confirm `.gitignore` covers `data/uploads/sick-notes/` (it does via `data/uploads/`) — no change, note it.

- [ ] **Step 2: Commit**

```bash
git add docs/
git commit -m "T6: sick-note-docs — status + deferred follow-ons"
```

---

## Self-Review

**Spec coverage:** §3 data model → T1 (table + frozen regen); §4 attach flow → T2 (validate/path) + T3 (audited insert) + T4 (panel/copy/UI); §5 view flow → T5 (PIN-gated list/open); §6 test split → T2/T3 tested, T4/T5 build-verified, T1 schema-parity; §7 storage → T4 path + T6 gitignore confirm; §8 security → T3 audit + PHI-payload test + T5 gate; §9 risks → sequenced (T1 first), file-not-found handled (T5), allowlist double-checked (T2 validator + T4 panel). No section unassigned.

**Placeholder scan:** T4/T5 UI steps describe the wiring in prose (intended — LariatApp has no test target, so these are prose-driven build-verified steps per the SDD "mid-tier floor for prose-driven implementers" convention) but every non-UI step ships complete code. One explicit verify-against-source note: the `RegulatedWriteContext.nativeMac(actorCookId:)` factory name must be confirmed against `RegulatedWriteContext` (T3 step 3 flags this). No "TODO/TBD/handle edge cases".

**Type consistency:** `SickNoteKind` (.note/.clearance, rawValue note/clearance), `SickNoteDocument` (fields id/reportId/locationId/filePath/kind/originalFilename/uploadedBy/uploadedAt), `SickNoteDocumentCompute.validate/storedPath/allowedExtensions`, `SickNoteRepository.attach/list`, `SickNoteAttach.pickAndCopy` are used identically across T2–T5. `attach` signature (reportId/locationId/filePath/kind/originalFilename/uploadedAt/context) matches its call site in T4.
