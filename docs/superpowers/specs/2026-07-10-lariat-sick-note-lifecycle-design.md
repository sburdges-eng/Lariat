# Sick-Note Document Lifecycle — Encryption at Rest, Content Validation, Retention (P0-6)

**Date:** 2026-07-10
**Status:** Designed (owner-ratified decisions §2; implementation pending)
**Author:** Claude (Fable 5) with owner
**Audit item:** External audit 2026-07-10, finding P0-6 (verified severity P2): native sick-note
documents (medical PHI) are stored plaintext on disk with extension-only validation and no
retention automation. Combined with backups that include `data/uploads/sick-notes/` (PR #457),
PHI in an unencrypted backup is the compliance-relevant combination.
**Predecessors on `main`:** #453 sick-note capture (`30cba5b`), #456 PBKDF2 PIN hashing
(`a4fd606`), #457 verified backup (`b707bfb`).

---

## 1. Problem

The sick-note capture feature (design `2026-07-08-lariat-sick-note-docs-design.md`) stores
doctor's-note documents byte-for-byte at `<dataDir>/uploads/sick-notes/<report_id>/<uuid>.<ext>`
via `FileManager.copyItem` (`LariatApp/UI/Support/SickNoteAttach.swift`) and opens them with
`NSWorkspace.shared.open` (`SickWorkerView.swift:190-192`). Three gaps:

- **(a) Plaintext at rest.** The files — and every backup snapshot of them since #457 — are
  readable by anyone holding the disk or a backup. Spotlight indexes their text; Time Machine
  snapshots hold plaintext copies.
- **(b) Extension-only validation.** The pure allowlist (`SickNoteDocumentCompute.validate`)
  checks the filename extension only. No size cap, no magic-number/content check anywhere.
- **(c) No retention automation.** The 2026-07-08 spec explicitly deferred retention as a
  compliance policy decision. No delete path for these rows/files exists anywhere in
  production code — purge will be the first deleter.

**Corpus status at design time: zero.** No `uploads/sick-notes/` directory, no
`sick_note_documents` table in the live DB, no sick-note files in any backup on this machine.
Encryption lands before the first real document exists. (One owner confirmation outstanding:
that the restaurant Mac also holds none — the migration sweep in §8 covers it either way.)

## 2. Owner-ratified decisions (2026-07-10)

1. **Retention window: 2 years after upload.** Anchored to the documented sick-worker-report
   window ("2 years, HFWA-adjacent + until resolution", `HEALTH_SAFETY_LABOR_AUDIT.md` §5).
   Named constant + citation string; changing it later is a one-line edit.
2. **Purge mode: flag, then one-click purge.** Automation detects and surfaces overdue
   documents; deletion happens only on a PIN-gated confirm (audited). No silent deletion of
   medical paperwork; the owner keeps a legal-hold escape hatch.
3. **Key recovery: key file + macOS Keychain mirror.** The key file under the data dir is the
   source of truth (readable by both runtimes, automatically excluded from backups); native
   mirrors it into the Keychain for recovery.

## 3. Non-goals

- No purge of parent `sick_worker_reports` rows (they feed HACCP windows via
  `lib/haccpPlan.ts` and Family-1 sync, where peers would resurrect deleted rows; their
  retention is a separate, already-documented policy).
- No DB-at-rest encryption (SQLCipher) — that is the P0-3 residual, tracked separately.
  Row metadata (`original_filename`, `uploaded_by`) stays plaintext in the DB.
- No web upload UI, no web read-only view (both still deferred from the 2026-07-08 spec).
  No Node encryption implementation lands now — only the format contract + golden vectors.
- No employee self-service; no inline document rendering (the OS viewer keeps rendering, §7).
- No redaction of already-peer-replicated audit payloads (none exist — corpus is zero).
- No backup rotation/pruning and no re-encryption of historical backups (none contain
  sick-note files on this machine; production to be confirmed).
- Not touched: `staff_certifications.document_path` / `wage_notices.document_path` sibling
  HR documents. The crypto/purge seams are shaped for reuse there in a later wave.

## 4. Architecture overview

Three additions, all keyed to the existing layering (pure logic → LariatModel; DB/file-system
effects → LariatDB; UI/OS glue → LariatApp, which has no test target):

1. **Encryption at rest** — a versioned AEAD file format (`LSN1`, §5) sealed/opened by pure
   `SickNoteCrypto`, keyed by a per-install media key (§6). Attach encrypts (§7); view
   decrypts to a managed temp file (§7); a launch-time sweep encrypts any legacy plaintext (§8).
2. **Content validation** — pure `SickNoteContentValidator`: size cap checked before reading,
   magic-number sniff + extension↔content agreement on the plaintext bytes, pre-encryption (§7).
3. **Retention** — pure `SickNoteRetention` window math; overdue badge + PIN-gated one-click
   audited purge on the native board; a report-only nightly job on the web cron rails (§9).

## 5. Encryption format — `LSN1`

Binary layout (48 bytes overhead):

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 4 | Magic `LSN1` (ASCII; also the format version) |
| 4 | 16 | `key_id` (raw bytes; matches the key file's `key_id`) |
| 20 | 12 | AES-GCM nonce (random per file) |
| 32 | n+16 | AES-256-GCM ciphertext ‖ 16-byte tag |

- **AAD = the UTF-8 bytes of the row's `file_path`** (e.g.
  `sick-notes/12/3F2A….pdf`). A ciphertext moved, renamed, or swapped between rows fails
  authentication. Rows' `file_path` is immutable today; any future move implies re-encrypt.
- **The on-disk name keeps its original extension** (no `.enc` suffix). Encryption state is
  determined solely by the `LSN1` magic via `isEncrypted(_:)`, never by the filename. This
  keeps `SickNoteDocumentCompute.storedPath` / `safeUploadRelativePath` / `file_path` rows /
  the `documentLabel` fallback untouched, and lets the migration sweep (§8) overwrite bytes in
  place with no DB write.
- **Cipher choice:** CryptoKit `AES.GCM` on native (CommonCrypto has no GCM mode);
  byte-identical in Node via `crypto.createCipheriv('aes-256-gcm')` + `setAAD` — the same
  dep-free-on-both-runtimes discipline as the PR #456 PBKDF2 contract. No third-party deps.
- **Format pinning:** a golden-vector fixture (key, nonce, AAD, plaintext, expected
  ciphertext) is committed under `LariatNative/Tests/Fixtures/` and asserted by a
  `LariatModelTests` decrypt test. The future web reader implements against the same vector.
- `SickNoteCrypto.isEncrypted(_:)` sniffs the 4-byte magic — this distinguishes legacy
  plaintext during the sweep (§8) and the view grace path (§7).

## 6. Key management

- **Key file (source of truth):** `<dataDir>/keys/sick-note-media.json` —
  `{"v":1,"key_id":"<32 hex>","key":"<base64 32 bytes>","created_at":"<ISO-8601>"}`.
  Follows the `lib/peerKeypair.ts` / `desktop/settings.ts` precedent exactly: 0600 with
  explicit chmod fallback, tmp+rename atomic write, versioned shape, bounded fail-closed
  parsing (malformed → error, never a guess). Created lazily by native on first attach.
  Path resolves through the frozen data-dir convention (`LARIAT_DATA_DIR` else `<cwd>/data`)
  on both runtimes — no new resolution rules.
- **Backups exclude it automatically.** `scripts/backup.mjs` copies exactly `lariat.db` +
  `<dataDir>/uploads` + `<dataDir>/audit`; `keys/` is not among them. A stolen backup holds
  ciphertext only. Consequence: a restore onto a new machine needs the key from the Keychain
  mirror or manual escrow — documented in §11; the backup manifest gains a
  `sick_note_key_fingerprint` (hex SHA-256 of the raw key, first 16 chars) so the restore
  drill can confirm the right key is present without containing it.
- **Keychain mirror (recovery):** after creating the key file, native writes a generic
  password item (service `com.lariat.sick-note-media-key`, account = `key_id`). On launch,
  if the file is missing but the Keychain item exists, native restores the file (heal); if
  the file exists but no item does, native mirrors it. Keychain failures warn once and never
  block attach/view — the file is authoritative. This is the repo's first Keychain code;
  it stays a thin, build-verified LariatApp unit whose JSON/validation core is the tested
  LariatModel key-file code.
- **Rotation: explicitly unsupported in v1.** Unlike the peer keypair, deleting this key
  orphans every ciphertext. The `key_id` field in file + format header is the seam that
  makes rotation implementable later (re-encrypt sweep keyed by header `key_id`).

## 7. Attach and view flows (native)

**Attach** (`SickNoteAttach.copyIn` becomes read → validate → encrypt → write):

1. Size gate **before reading**: file attributes checked against
   `SickNoteContentValidator.maxDocumentBytes = 25 MB` (scanned multi-page PDFs overflow the
   10 MB recipe-photo precedent; still bounded). Oversize → reject, nothing read.
2. Read plaintext `Data`, validate magic numbers + extension agreement:
   PDF `%PDF-` @0; JPEG `FF D8 FF` @0 (`jpg/jpeg/jpe`); PNG 8-byte signature @0;
   HEIC ISO-BMFF `ftyp` @4 with brand @8 ∈ {`heic`,`heix`,`hevc`,`hevx`,`mif1`,`msf1`}.
   Mismatch (e.g. an `.exe` renamed `.pdf`) → reject with kitchen-native copy
   (per `docs/UI_COPY_RULES.md`; never "validation failed").
3. `storedPath` is unchanged — the ciphertext is written at the same
   `sick-notes/<report_id>/<uuid>.<ext>` path the plaintext copy would have used. No `.enc`
   suffix, no new compute helper; `safeUploadRelativePath` containment is unchanged.
4. Seal with `SickNoteCrypto` (AAD = the relative path), atomic `Data.write(options: .atomic)`,
   then narrow to 0600. The existing invariants survive verbatim: PIN re-check after the
   modal panel, and a failed DB insert removes the just-written (now ciphertext) file.
5. **Audit payload change:** the attach `audit_events` payload drops `original_filename`
   (quasi-PHI that replicates to peers via Family-1 `audit_events` sync, beyond purge's
   reach). It keeps `report_id`, `location_id`, `file_path` (UUID-based, non-identifying),
   `kind`, `uploaded_by`, `uploaded_at`. The `SickNoteRepositoryTests` payload assertion
   updates to assert the filename is now *absent*.

**View** (`Open` in `SickWorkerView.documentRow`):

- Stays behind the existing direct-`pinOk` gating — semantics deliberately untouched (the VM
  uses `pinOk`, not the `RegulatedReadGate` helper; this design does not silently change that).
- Read stored file → if `LSN1`: decrypt, write plaintext to
  `FileManager.temporaryDirectory/LariatSickNotes/<uuid>.<ext>` (directory 0700, file 0600;
  `$TMPDIR` is per-user and not Spotlight-indexed; the `<ext>` is recovered from the stored
  path's existing extension), `NSWorkspace.open` the temp file. If **not** `LSN1` (legacy
  plaintext, pre-sweep grace): open the stored file directly — today's behavior — and let the
  launch sweep (§8) fix it.
- **Temp lifecycle** behind a pure, tested `SickNoteTempStore` seam (path derivation +
  staleness policy); thin App glue sweeps the temp directory on app launch, on app
  terminate, and before each new open. Residual risk stated in §12.

## 8. Migration sweep (encrypt-in-place) + orphan detection

On app launch (async, off the main actor), walk `<dataDir>/uploads/sick-notes/**`:

- **Any plaintext file** (fails the `LSN1` magic sniff): seal it (AAD = its relative path) to a
  sibling `<name>.tmp`, then atomically rename over the original path. The DB row is
  **unchanged** — `file_path` already points at that path — so there is **no DB write, no audit
  event, and no file-vs-row drift window**: a crash before the rename leaves a harmless `.tmp`
  orphan (swept next launch) with the original plaintext intact; a crash after leaves the fully
  encrypted file.
- **Any file with no matching DB row** (crash-window artifacts, manual copies): counted and
  surfaced in the orphan report (§9). **Never auto-deleted** — removal goes through the same
  one-click purge affordance.
- Idempotent (the magic sniff is a 4-byte read; already-encrypted files are skipped), cheap,
  and expected to be a no-op given the zero corpus. Filesystem-only — needs the media key and
  `SickNoteCrypto`, but touches neither the DB nor `audit_events`.

## 9. Retention and purge

- **Policy core:** pure `SickNoteRetention` — `windowDays = 730`, `isOverdue(uploadedAt:now:)`,
  and `retentionCitation` ("2 years after upload — HFWA-adjacent; matches the sick-worker
  report window in HEALTH_SAFETY_LABOR_AUDIT §5; owner-ratified 2026-07-10"). **`isOverdue`
  fails OPEN:** an unparseable `uploaded_at` returns `false` (not overdue) — the opposite
  polarity of the auth precedent, so a malformed timestamp can never cause real PHI to be
  flagged for deletion. Parse via `AuditLogCompute.parseTimestamp` (handles the native
  fractional-second ISO-8601 the attach writes), not the yyyy-MM-dd-only date helpers.
- **Native surface (the actor):** the sick-worker board shows an overdue-document count
  (counts are PIN-free — the existing "N on file" posture). Behind `pinOk`, an overdue list
  (plus orphan files, as detected by the §8 launch sweep) with per-document and purge-all
  **Remove** actions, confirm behind the manager PIN.
- **Purge = audited transactional delete** in `SickNoteRepository.purge(documentId:context:)`:
  unlink the file, then delete the row, inside one transaction, tolerating an already-missing
  file (the `scripts/cleanup-recipe-photos.mjs` ordering precedent); plus an `audit_events`
  row (`action = 'delete'`, `actor_source = native_mac`, metadata-only payload) committed in
  the same transaction via the `AuditedWriteRunner`/`AuditEventWriter` pattern.
- **Nightly job (report-only):** `scripts/sick-note-retention.mjs` on the existing cron rails
  (`data/scheduled-jobs.json` entry + `examples/lariat.crontab` block via `install-cron.sh`,
  executed through `scripts/run-job.mjs` with its file lock and `ingest_runs`
  `kind='job:sick-note-retention'` bookkeeping). It reads the DB and walks the uploads tree,
  logs overdue/orphan/legacy-plaintext counts as durable compliance evidence, and **never
  deletes**. Retention visibility holds even if the native app sits unused; deletion remains
  human-confirmed per decision §2.2.
- Purge cannot reach historical backup snapshots or peer-replicated audit payloads; with a
  zero corpus at rollout, no plaintext PHI exists in either. From rollout on, backups hold
  ciphertext only, so purge + key custody is the effective deletion story for backups.

## 10. Web-side changes (complete list)

- `scripts/backup.mjs`: write `sick_note_key_fingerprint` into `manifest.json` when the key
  file exists (backup content unchanged; `tests/js/test-backup.mjs` gains the assertion).
- `scripts/sick-note-retention.mjs` (new, report-only) + `data/scheduled-jobs.json` entry +
  `examples/lariat.crontab` block + a Node test.
- **No schema change** — deliberate. Retention keys off the existing `uploaded_at`; encryption
  is invisible to the schema (ciphertext in place, same `file_path`, no new column).
  `SCHEMA_VERSION` stays 4; the `check-schema-version-bump.mjs` gate must NOT fire on this PR
  (it only inspects staged `lib/db.ts` DDL, which we never touch). (The v5 column set —
  `size_bytes`/`sha256`/`mime`/`deleted_at` — was considered and rejected as anticipatory;
  it remains available additively later.)
- **No Node crypto implementation** — zero web call sites today. The format contract (§5) +
  golden vectors pin byte-parity for the deferred web read-only view.

## 11. Docs and operational updates

- `HEALTH_SAFETY_LABOR_AUDIT.md` §5: add the document-retention row (2y, citation) and
  correct the aspirational "encrypted export" cell where it implies more than exists.
- `docs/PROTECTED_CONTRACTS.md`: new PHI-file section — sick-note files are ciphertext at
  rest (`LSN1`), key file never enters backups or git, purge is an audited delete, attach
  audit payloads carry no `original_filename`.
- Backup/restore doc (alongside #457's): key escrow — the Keychain mirror is the primary
  recovery; additionally copy `keys/sick-note-media.json` to a password manager once;
  restoring to a new Mac requires placing the key file back under `<dataDir>/keys/`.
- Refresh the stale pre-#457 description on the nightly backup entry in
  `data/scheduled-jobs.json` while adding the retention job (same file, verified drift).

## 12. Security invariants & residual risks

Invariants (unchanged or strengthened):

- Attach and purge are PIN-gated audited writes; audit row and data change commit in one
  transaction; `actor_source = native_mac`; payloads carry file metadata only — now with
  `original_filename` removed on attach.
- View stays behind the PIN; un-PINned users see counts only. Reads stay `location_id`-scoped.
- `data/uploads/` stays gitignored; the key file is additionally outside `uploads/` entirely.
- Failed insert leaves no file on disk (plaintext or ciphertext).
- Path containment (`safeUploadRelativePath` + symlink-resolved prefix check) unchanged.

Residual risks (accepted, stated):

- Plaintext exists in `$TMPDIR/LariatSickNotes/` while a document is open in the OS viewer;
  swept on launch/quit/next-open; per-user 0700, not Spotlight-indexed; FileVault covers
  disk theft. (In-app rendering was considered and rejected to preserve the ratified
  "OS viewer owns rendering" decision.)
- Row metadata (`original_filename`, `uploaded_by`, timestamps) remains plaintext in the
  unencrypted SQLite DB — P0-3 residual, out of scope here.
- Backup `manifest.json`/`SHA256SUMS` reveal report-id-bearing paths, sizes, and document
  counts (not contents).
- The manager's original source file (e.g. `~/Downloads/note.pdf`) is untouched by attach.
- Key loss = permanent loss of all documents; mitigated by the Keychain mirror + escrow doc.

## 13. Components & test-home split

| Unit | Layer | Responsibility | Tested |
| --- | --- | --- | --- |
| `SickNoteCrypto` | LariatModel | `LSN1` seal/open/sniff, AAD binding | unit + golden vector |
| `SickNoteMediaKey` | LariatModel | key-file JSON encode/parse, bounded fail-closed validation | unit |
| `SickNoteContentValidator` | LariatModel | 25 MB cap + magic-number/ext agreement | unit |
| `SickNoteRetention` | LariatModel | 730-day window math + citation | unit |
| `SickNoteTempStore` | LariatModel | temp path derivation + staleness policy | unit |
| `SickNoteKeyStore` | LariatDB | key-file IO: lazy create, load, 0600, atomic | DBTests |
| `SickNoteRepository` (edit) | LariatDB | attach payload change; `purge` audited tx; overdue/orphan queries | DBTests |
| `SickNoteMigrator` | LariatDB | filesystem-only encrypt-in-place sweep (atomic rename, no DB write), idempotency | DBTests |
| Attach/view/temp/Keychain glue | LariatApp | panel, encrypt-write call, decrypt-open, sweeps, SecItem mirror | build-verified |
| `scripts/sick-note-retention.mjs` | web | report-only nightly job | Node test |
| `scripts/backup.mjs` (edit) | web | manifest key fingerprint | `test-backup.mjs` |

## 14. Plan declarations (native-guide requirements)

- **Affected subsystem:** native sick-worker board (LariatModel/LariatDB/LariatApp) + web
  ops scripts. Regulated-PHI surface → Opus/Max-planned (done), Sonnet-implementable.
- **Freeze-readiness impact:** none on Phase C gates; no schema change, no new web write
  route, no `SchemaMigrator`/`ActorSource` change.
- **Determinism impact:** none — no cloud/runtime AI coupling; crypto is local; nonce
  randomness is per-file and never affects business math.
- **Security/audit impact:** strengthens PHI-at-rest posture; changes one audit payload
  shape (filename removed — asserted by test); adds one audited delete path.
- **Exact scope:** the files in §13 plus §11 docs. One PR, web+native together (the #456
  precedent), branch `feat/lariat-sick-note-lifecycle`. No UI-copy/layout churn beyond the
  new affordances (PROTECTED_CONTRACTS PR-hygiene rule).

## 15. Acceptance gates

1. `swift build && swift test` from `LariatNative/` green (new Model/DB suites included).
2. `npm run verify` green from repo root (includes `test:backup` with the new fingerprint
   assertion and the new retention-job test).
3. `SCHEMA_VERSION` untouched — schema-bump gate silent.
4. Golden-vector test proves `LSN1` decrypt against committed fixtures.
5. Manual GUI smoke (out-of-sandbox, user-run): attach → file on disk starts with `LSN1`;
   Open renders in Preview; Remove purges row+file and writes the audit event; Keychain
   shows the mirrored key item.

## 16. Out-of-scope findings surfaced (for separate follow-up)

1. **`scripts/export.mjs` exports sick-worker PHI un-gated:** symptoms/diagnosis/note go to
   `exports/sick_worker_<date>.csv` with no PIN gate, and only `*.xlsx` is gitignored —
   contradicts `HEALTH_SAFETY_LABOR_AUDIT` and the never-enter-git rule. Recommend an
   audit-follow-up ticket.
2. **Raw recipe-photo route lacks `nosniff`/PIN** — non-PHI, but noted while establishing
   the serving precedent; any future sick-note web route must NOT copy its posture
   (required instead: master-PIN, own realpath root, `nosniff`, `Cache-Control: no-store`).
3. **Ad-hoc backup file** `backups/lariat_2026-07-10_07-13.db` (old bare-file naming) exists
   beside #457's stamped dirs — an out-of-band snapshot practice the key-escrow story does
   not cover; flag to the owner.
