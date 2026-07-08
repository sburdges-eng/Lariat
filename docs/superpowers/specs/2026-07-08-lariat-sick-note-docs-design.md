# Sick-Leave Doctor's-Note Capture — Design

**Date:** 2026-07-08
**Status:** Implemented (2026-07-08, branch `feat/lariat-sick-note-capture` —
schema v4 + native capture/view; see §10 for source-verified adaptations and
deferred follow-ons)
**Author:** Claude (Opus 4.8) with owner
**Scope:** Let a manager/PIC attach a doctor's-note document (scan/photo) to a
sick-worker record in the native app, and view it behind a PIN. Employee
self-service entry is explicitly out of scope (deferred).

---

## 1. Problem

Owner requirement: *"a place for MGMT and employees to log any doctors notes in the
event of requirement of said paperwork."* Today the sick-leave surface has a private
free-text `note` field (PIC-entered), `clearance_source`, and `return_at` — but **no way
to store the actual doctor's-note document** (the PDF/photo an operator receives when
return-to-work paperwork is required). This design adds that capture, on the native app.

Scope decisions already made (brainstorm, 2026-07-08):
- **Who logs it:** manager/PIC only (MVP). Employee self-service is a deferred future wave
  (it needs an employee identity surface the app doesn't have).
- **Surface:** native macOS app (owner's daily driver + the full-replacement target).
- **Data model:** a dedicated `sick_note_documents` table (multiple docs per event +
  compliance metadata), NOT a single column.
- **No paperwork-status flag** in MVP (document capture only).

## 2. Non-goals

- No employee-facing submission path or new identity mechanism.
- No `doctors_note_required/on_file` status flag or "missing paperwork" indicator.
- No web upload UI (the web surface only gains the shared schema — §3).
- No document retention/purge automation (compliance policy decision — §7, deferred).
- No inline document rendering (open in the OS viewer).

## 3. Data model (web-owned schema, native-driven UI)

New table — added to the web's declared schema first, because the shared `data/lariat.db`
schema is web-owned and native replays a frozen copy:

```sql
CREATE TABLE IF NOT EXISTS sick_note_documents (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id         INTEGER NOT NULL,          -- FK → sick_worker_reports(id)
  location_id       TEXT    NOT NULL,
  file_path         TEXT    NOT NULL,          -- relative to data/uploads/, e.g.
                                               -- sick-notes/<report_id>/<uuid>.<ext>
  kind              TEXT    NOT NULL,          -- 'note' | 'clearance'
  original_filename TEXT,                      -- as picked, for display only
  uploaded_by       TEXT,                      -- PIN user id
  uploaded_at       TEXT    NOT NULL           -- ISO-8601 UTC
);
```

**Schema-ownership path (the only web code in this feature):**
1. Add the `CREATE TABLE` to web `lib/db.ts` `initSchema()` (same place every table is declared).
2. Regenerate native's frozen schema: `node scripts/dump-fresh-schema.mjs --executable`
   → refreshes `LariatNative/Sources/LariatDB/Resources/frozen_schema.sql`, keeping
   native's `SchemaMigrator` replay byte-parity (per the C2 design).
3. No data migration — the table is additive; the live DB gains it when web's `initSchema`
   runs (web owns writes today). Native then reads/writes it, exactly like every other
   audited native write to a web-owned table.

`location_id` is carried for parity with every other row in this DB and to keep the
BeoBoard-class cross-location predicate available (a sick note is location-scoped).

## 4. Native attach flow (new native file-attach pattern)

In `SickWorkerView` (native), a per-report **"Attach doctor's note"** action, PIN-gated:

1. **PIN gate** — the attach is a medical-record write; require a PIN session
   (`ManagementWrite.requireSession` / the existing PIN pattern) before the panel opens.
2. **Pick** — `NSOpenPanel`, `allowedContentTypes = [.pdf, .jpeg, .png, .heic]`, single file.
3. **Validate** — `SickNoteDocumentCompute.validate(filename:)` enforces the extension
   allowlist (pure, unit-tested); reject with an inline message on a bad type.
4. **Copy** — derive the stored relative path
   `sick-notes/<report_id>/<uuid>.<ext>` (`SickNoteDocumentCompute.storedPath(...)`, pure),
   resolve to `LARIAT_DATA_DIR/uploads/<relative>`, create the dir, `FileManager.copyItem`.
5. **Record** — insert one `sick_note_documents` row via the **audited write path**
   (`AuditedWriteRunner` / `AuditEventWriter`), `actor_source = native_mac`,
   `uploaded_by = pinUser`, `kind` from a picker (note | clearance), `original_filename`
   from the picked URL. The insert + audit event are one transaction (existing pattern).

File I/O (panel, copy) lives in the App layer (build-verified). Path derivation +
validation are pure `LariatModel` (unit-tested). The DB insert is `LariatDB` (tested).

## 5. Native view flow (PHI-gated)

The doctor's note is medical PHI — same posture as symptoms/diagnosis in #447:

- The per-report document **list** and the **Open** action sit behind `RegulatedReadGate`
  (PIN). Without a PIN session, the row shows only a count ("1 document on file") — never
  the filename or an open affordance.
- **Open** = `NSWorkspace.shared.open(fileURL)` (resolved from `file_path`); if missing on
  disk, show "file not found" (the DB row can outlive a moved/deleted file).
- No inline preview; the OS viewer owns rendering.

## 6. Components & test-home split (honest, matches #447)

| Unit | Layer | Responsibility | Tested? |
|---|---|---|---|
| `SickNoteDocument` (record) | LariatModel | value struct mirroring the row | via compute tests |
| `SickNoteDocumentCompute` | LariatModel | extension allowlist validation; `storedPath(reportId:uuid:ext:)`; `kind` enum | **unit tests first** (parity-critical) |
| `SickNoteRepository` | LariatDB | `attach(...)` (audited insert) + `list(reportId:)` | **DBTests** (insert/list + audit envelope) |
| `SickWorkerView` attach/view | LariatApp | NSOpenPanel + copy + PIN gate + open | build-verified (no App test target) |
| `sick_note_documents` schema | web `lib/db.ts` + native `frozen_schema.sql` | table declaration + frozen replay | schema-parity check (existing `SchemaMigratorTests`) |

`LariatApp` has no unit-test target — the file-picker/copy/open UI is `swift build`-verified
and that split is stated honestly in commits/PR, exactly as every prior native wave.

## 7. Storage & compliance

- Files live off-tree at `data/uploads/sick-notes/<report_id>/…`, mirroring the recipe-photo
  precedent (`data/uploads/recipes/…`). Add `data/uploads/sick-notes/` handling to
  `.gitignore` (medical/HR documents must never enter git; `data/uploads/` is likely already
  covered — confirm and, if not, add).
- **UUID filenames** (not the original name) prevent path/name leakage; `original_filename`
  is display-only.
- **Retention/purge** (medical-record retention windows, secure deletion) is a compliance
  **policy** decision, not MVP code — documented as a deferred follow-on.

## 8. Security & PHI invariants

- Attach = PIN-gated audited write (`actor_source = native_mac`); every attach emits an
  `audit_events` row in the same transaction as the insert.
- View/open = `RegulatedReadGate` (PIN); un-PINned users see only a count.
- `location_id`-scoped reads (a note belongs to one location).
- No PHI in log/audit payloads beyond the fact that a document was attached (mirror #447 —
  symptoms/diagnosis are not echoed into audit notes).

## 9. Risks & open items

- **Cross-boundary change:** this is the first native-driven feature that also edits the web
  schema. The web `initSchema` addition + `frozen_schema.sql` regen must land together, or
  native's schema-parity test fails. The plan sequences the schema task first.
- **File-vs-row drift:** a `sick_note_documents` row can outlive its file (manual deletion,
  moved data dir). View handles "file not found" gracefully; no automatic cleanup in MVP.
- **`LARIAT_DATA_DIR` resolution:** the copy target resolves from the same env the app
  already uses to open the DB; a headless/misconfigured launch with no data dir can't attach
  (fails with a clear message, no crash).
- **Allowlist:** PDF + JPEG + PNG + HEIC (owner-approved). Anything else is rejected at the
  panel + re-checked by the pure validator (defense in depth).

## 10. Implementation notes & deferred follow-ons (2026-07-08)

Landed as planned with these source-verified adaptations:

- Real native paths: the view lives at `LariatApp/UI/Boards/SickWorkerView.swift` with a
  separate `UI/ViewModels/SickWorkerViewModel.swift`; the panel/copy helper landed at
  `UI/Support/SickNoteAttach.swift`. Records follow the `CoolingRow` convention —
  `SickNoteDocumentRow` in `LariatModel/SickNoteRecords.swift` + pure
  `Compute/SickNoteDocumentCompute.swift`.
- The schema-bump gate (`scripts/check-schema-version-bump.mjs`) required
  `SCHEMA_VERSION` 3 → 4 (web) mirrored by `SchemaMigrator.webSchemaVersion` (native);
  all four derived fixtures regenerated, `SchemaMigratorTests` green.
- Reads are location-scoped end to end (§8): `list`/`counts` take `location_id`, and
  `attach` requires the parent report to exist at the context's location (unknown or
  cross-location report → `reportNotFound`; no orphan documents).
- PIN posture in the VM: counts are fetched PIN-free (drives the locked "N on file"
  row); full rows (filenames) are fetched only with an active manager-PIN session —
  the `includeHistory: pinOk` pattern this board already used.
- A failed DB insert removes the just-copied file so no orphan lands on disk.
- Cleared (history) reports keep the attach/list affordances — return-to-work
  clearance paperwork usually arrives after clearing.
- `.gitignore` already covers `data/uploads/` (confirmed — no change needed).

Deferred follow-ons (unchanged from §2, recorded for the roadmap):

1. **Employee self-service entry** — needs an employee identity surface the app
   doesn't have.
2. **Retention/purge policy** — medical-record retention windows + secure deletion are
   a compliance policy decision first, then code.
3. **Web read-only view** of the documents list (web currently gains only the schema).
