# Sick-Note Document Lifecycle (P0-6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt sick-note doctor's-note documents at rest, validate their content at attach time, and add 2-year flag-then-confirm retention — closing audit finding P0-6.

**Architecture:** A versioned AEAD file format (`LSN1`, AES-256-GCM) seals every sick-note file in place with no filename change; a per-install media key lives in a 0600 key file under the data dir (excluded from backups) mirrored into the macOS Keychain. Pure crypto/validation/retention logic lands in `LariatModel` (unit-tested); file/DB effects in `LariatDB` (DBTests); NSOpenPanel/decrypt-to-temp/Keychain/board glue in `LariatApp` (build-verified, no test target). A report-only nightly web job surfaces overdue documents; deletion is a PIN-gated one-click audited purge in the native app.

**Tech Stack:** Swift 5.9 / SwiftPM (CryptoKit, GRDB, XCTest); Next.js/Node 24 web (better-sqlite3, `node:test`, `--experimental-strip-types`).

**Spec:** `docs/superpowers/specs/2026-07-10-lariat-sick-note-lifecycle-design.md`

## Global Constraints

- **Branch:** `feat/lariat-sick-note-lifecycle` in worktree `~/Dev/hospitality/Lariat-wt-p06`. One PR, web+native together (the #456 precedent).
- **No schema change.** `SCHEMA_VERSION` stays `4`. Do NOT edit `lib/db.ts` DDL, add columns, or touch `frozen_schema.sql` / `SchemaMigrator.webSchemaVersion`. The `scripts/check-schema-version-bump.mjs` gate only inspects staged `lib/db.ts` DDL, so it stays silent.
- **Layering:** pure logic → `LariatModel`; GRDB + file IO → `LariatDB`; SwiftUI/AppKit/Security → `LariatApp`. Anything that needs a test MUST live in `LariatModel` or `LariatDB` (`LariatApp` has no test target).
- **Encryption is invisible to the schema:** ciphertext is written at the *same* path (`sick-notes/<report_id>/<uuid>.<ext>`), original extension retained, `file_path` rows unchanged. `SickNoteCrypto.isEncrypted` (4-byte `LSN1` magic) is the sole authority on encryption state.
- **AAD = the row's relative `file_path` bytes** (UTF-8). Seal and open must use the identical string.
- **Key file** `<dataDir>/keys/sick-note-media.json`, sibling of `uploads/` and `audit/`, **outside `uploads/`** so backups never copy it. Written atomically, mode 0600.
- **Crypto is dep-free on both runtimes:** CryptoKit `AES.GCM` (native; CommonCrypto has no GCM mode). No Node crypto implementation lands this PR — contract + golden vector only.
- **PHI guard (unchanged, strengthened):** audit payloads carry file metadata only — never symptoms/diagnosis, and after this PR never `original_filename`. Attach and purge are PIN-gated audited writes; the audit row commits in the same transaction as the mutation (`AuditEventWriter.post` throws outside a transaction).
- **Retention fails OPEN:** an unparseable `uploaded_at` is treated as NOT overdue.
- **UI copy** obeys `docs/UI_COPY_RULES.md`: 5th–8th grade, kitchen-native. Banned: "validation failed", "authenticate", "user", "submit", "generate", "configure", "retention policy", "purge", "error occurred". Prefer "late" over "overdue", "yes/done" over "confirm", "go back" over "cancel". Never echo a filename into an error shown on the board.
- **Gates (design §15):** `swift build && swift test` from `LariatNative/` green; `npm run verify` from root green; schema-bump gate silent; golden-vector decrypt passes.
- **GitNexus:** run `impact({target, direction:"upstream"})` before editing `SickNoteRepository.attach`, `SickNoteDocumentCompute`, `AuditEventWriter`, or `scripts/backup.mjs`; report HIGH/CRITICAL before proceeding.

---

## File Structure

**New — `LariatNative/Sources/LariatModel/`**
- `Crypto/SickNoteCrypto.swift` — `LSN1` seal/open/isEncrypted (Task 1)
- `Crypto/SickNoteMediaKey.swift` — key-file value type + fail-closed parse/generate (Task 2)
- `Compute/SickNoteContentValidator.swift` — size cap + magic-byte sniff (Task 3)
- `Compute/SickNoteRetention.swift` — 730-day window, fail-open (Task 4)
- `Compute/SickNoteTempStore.swift` — decrypt-to-temp path derivation (Task 5)

**New — `LariatNative/Sources/LariatDB/`**
- `SickNoteKeyStore.swift` — lazy-create/load key file, 0600, atomic (Task 6)
- `SickNoteMigrator.swift` — filesystem encrypt-in-place sweep (Task 9)

**Modify — `LariatNative/Sources/LariatDB/SickNoteRepository.swift`** — attach payload → metadata-only (Task 7); add `purge` + `overdueDocuments`/`orphanDocuments` (Task 8)

**Modify — `LariatNative/Sources/LariatApp/`**
- `UI/Support/SickNoteAttach.swift` — validate + encrypt on write (Task 10)
- `UI/ViewModels/SickWorkerViewModel.swift` — decrypt-to-temp open, purge action (Tasks 11, 13)
- `UI/Boards/SickWorkerView.swift` — overdue/orphan section + Remove (Task 13)
- `UI/Support/SickNoteKeychain.swift` (new) — Keychain mirror (Task 12)
- app startup site — launch migration + temp sweep + Keychain heal (Task 13)

**New tests**
- `LariatNative/Tests/LariatModelTests/`: `SickNoteCryptoTests.swift`, `SickNoteMediaKeyTests.swift`, `SickNoteContentValidatorTests.swift`, `SickNoteRetentionTests.swift`, `SickNoteTempStoreTests.swift`
- `LariatNative/Tests/LariatDBTests/`: `SickNoteKeyStoreTests.swift`, `SickNoteMigratorTests.swift`; extend `SickNoteRepositoryTests.swift`

**New/Modify — web**
- `scripts/sick-note-retention.mjs` (new, report-only) + `tests/js/test-sick-note-retention.mjs` (new) (Task 14)
- `data/scheduled-jobs.json`, `examples/lariat.crontab` (Task 15)
- `scripts/backup.mjs`, `tests/js/test-backup.mjs` (Task 16)
- `package.json`, `.github/workflows/ci.yml` (Tasks 14, 16)

**Docs** — `docs/HEALTH_SAFETY_LABOR_AUDIT.md`, `docs/PROTECTED_CONTRACTS.md`, backup/restore key-escrow note (Task 17)

---

## Task 1: SickNoteCrypto — LSN1 AES-256-GCM seal/open

**Files:**
- Create: `LariatNative/Sources/LariatModel/Crypto/SickNoteCrypto.swift`
- Test: `LariatNative/Tests/LariatModelTests/SickNoteCryptoTests.swift`

**Interfaces:**
- Produces: `enum SickNoteCrypto` with `static func seal(_ plaintext: Data, key: SymmetricKey, keyId: Data, filePath: String, nonceOverride: Data? = nil) throws -> Data`; `static func open(_ blob: Data, key: SymmetricKey, keyId: Data, filePath: String) throws -> Data`; `static func isEncrypted(_ blob: Data) -> Bool`; `enum CryptoError: Error, Equatable { case badFormat, keyIdMismatch, authenticationFailed }`.

- [ ] **Step 1: Write the failing test**

```swift
// LariatNative/Tests/LariatModelTests/SickNoteCryptoTests.swift
import XCTest
import CryptoKit
@testable import LariatModel

final class SickNoteCryptoTests: XCTestCase {
    // Fixed vectors so the LSN1 layout is pinned across impls (Node parity lands later).
    let keyData = Data(base64Encoded: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")! // 32 bytes 0x00..0x1f
    let keyId   = Data((0..<16).map { UInt8($0 + 0x40) })                                // 16 bytes 0x40..0x4f
    let nonce   = Data((0..<12).map { UInt8($0 + 0x80) })                                // 12 bytes 0x80..0x8b
    let path    = "sick-notes/12/3f2a.pdf"
    let plain   = Data("%PDF-1.4 hello".utf8)

    func testRoundTripsWithFixedNonce() throws {
        let key = SymmetricKey(data: keyData)
        let blob = try SickNoteCrypto.seal(plain, key: key, keyId: keyId, filePath: path, nonceOverride: nonce)
        XCTAssertTrue(SickNoteCrypto.isEncrypted(blob))
        // layout: 4 magic + 16 keyId + 12 nonce + ciphertext + 16 tag
        XCTAssertEqual(blob.prefix(4), Data("LSN1".utf8))
        XCTAssertEqual(blob.subdata(in: 4..<20), keyId)
        XCTAssertEqual(blob.subdata(in: 20..<32), nonce)
        XCTAssertEqual(blob.count, 32 + plain.count + 16)
        let out = try SickNoteCrypto.open(blob, key: key, keyId: keyId, filePath: path)
        XCTAssertEqual(out, plain)
    }

    func testOpenFailsClosed() throws {
        let key = SymmetricKey(data: keyData)
        let blob = try SickNoteCrypto.seal(plain, key: key, keyId: keyId, filePath: path, nonceOverride: nonce)
        // wrong AAD (moved to another row) -> auth failure
        XCTAssertThrowsError(try SickNoteCrypto.open(blob, key: key, keyId: keyId, filePath: "sick-notes/99/x.pdf")) {
            XCTAssertEqual($0 as? SickNoteCrypto.CryptoError, .authenticationFailed)
        }
        // wrong keyId
        XCTAssertThrowsError(try SickNoteCrypto.open(blob, key: key, keyId: Data(repeating: 0, count: 16), filePath: path)) {
            XCTAssertEqual($0 as? SickNoteCrypto.CryptoError, .keyIdMismatch)
        }
        // truncated / not LSN1
        XCTAssertThrowsError(try SickNoteCrypto.open(Data([1,2,3]), key: key, keyId: keyId, filePath: path)) {
            XCTAssertEqual($0 as? SickNoteCrypto.CryptoError, .badFormat)
        }
        XCTAssertFalse(SickNoteCrypto.isEncrypted(Data("%PDF-".utf8)))
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd LariatNative && swift test --filter SickNoteCryptoTests`
Expected: FAIL — `cannot find 'SickNoteCrypto' in scope`.

- [ ] **Step 3: Write the implementation**

```swift
// LariatNative/Sources/LariatModel/Crypto/SickNoteCrypto.swift
import Foundation
import CryptoKit

/// LSN1 authenticated envelope for sick-note PHI files (audit P0-6).
/// Layout: "LSN1"(4) ‖ keyId(16) ‖ nonce(12) ‖ ciphertext ‖ tag(16).
/// AAD = the row's relative file_path bytes, binding a ciphertext to its slot.
public enum SickNoteCrypto {
    public static let magic = Data("LSN1".utf8)
    static let keyIdBytes = 16
    static let nonceBytes = 12
    static let tagBytes = 16
    static let headerBytes = 4 + 16 + 12 // = 32

    public enum CryptoError: Error, Equatable {
        case badFormat
        case keyIdMismatch
        case authenticationFailed
    }

    public static func isEncrypted(_ blob: Data) -> Bool {
        blob.count >= magic.count && blob.prefix(magic.count) == magic
    }

    /// `nonceOverride` exists ONLY for deterministic golden-vector tests; production seals with a fresh nonce.
    public static func seal(_ plaintext: Data, key: SymmetricKey, keyId: Data,
                            filePath: String, nonceOverride: Data? = nil) throws -> Data {
        guard keyId.count == keyIdBytes else { throw CryptoError.badFormat }
        let nonce: AES.GCM.Nonce
        if let n = nonceOverride {
            guard n.count == nonceBytes, let parsed = try? AES.GCM.Nonce(data: n) else { throw CryptoError.badFormat }
            nonce = parsed
        } else {
            nonce = AES.GCM.Nonce()
        }
        let box = try AES.GCM.seal(plaintext, using: key, nonce: nonce, authenticating: Data(filePath.utf8))
        var out = Data()
        out.append(magic)
        out.append(keyId)
        out.append(Data(box.nonce))
        out.append(box.ciphertext)
        out.append(box.tag)
        return out
    }

    public static func open(_ blob: Data, key: SymmetricKey, keyId: Data, filePath: String) throws -> Data {
        guard blob.count >= headerBytes + tagBytes, isEncrypted(blob) else { throw CryptoError.badFormat }
        let base = blob.startIndex
        let fileKeyId = blob.subdata(in: (base + 4)..<(base + 20))
        guard fileKeyId == keyId else { throw CryptoError.keyIdMismatch }
        let nonceData = blob.subdata(in: (base + 20)..<(base + 32))
        let tagStart = blob.endIndex - tagBytes
        let cipher = blob.subdata(in: (base + 32)..<tagStart)
        let tag = blob.subdata(in: tagStart..<blob.endIndex)
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonceData), ciphertext: cipher, tag: tag)
            return try AES.GCM.open(box, using: key, authenticating: Data(filePath.utf8))
        } catch {
            throw CryptoError.authenticationFailed
        }
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd LariatNative && swift test --filter SickNoteCryptoTests`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatModel/Crypto/SickNoteCrypto.swift LariatNative/Tests/LariatModelTests/SickNoteCryptoTests.swift
git commit -m "feat(native): LSN1 AES-256-GCM envelope for sick-note PHI (P0-6)"
```

---

## Task 2: SickNoteMediaKey — versioned key value type

**Files:**
- Create: `LariatNative/Sources/LariatModel/Crypto/SickNoteMediaKey.swift`
- Test: `LariatNative/Tests/LariatModelTests/SickNoteMediaKeyTests.swift`

**Interfaces:**
- Consumes: `SymmetricKey` (CryptoKit).
- Produces: `struct SickNoteMediaKey: Codable, Equatable, Sendable { let v: Int; let keyId: String; let key: String; let createdAt: String }` with `CodingKeys` mapping `keyId→key_id`, `createdAt→created_at`; `var keyIdData: Data?` (16 bytes); `var symmetricKey: SymmetricKey?` (32 bytes); `static func parse(_ json: Data) -> SickNoteMediaKey?` (fail-closed); `static func generate(now: Date) -> SickNoteMediaKey`; `static let currentVersion = 1`.

- [ ] **Step 1: Write the failing test**

```swift
// LariatNative/Tests/LariatModelTests/SickNoteMediaKeyTests.swift
import XCTest
@testable import LariatModel

final class SickNoteMediaKeyTests: XCTestCase {
    func testGenerateRoundTripsThroughJSON() throws {
        let key = SickNoteMediaKey.generate(now: Date(timeIntervalSince1970: 1_700_000_000))
        XCTAssertEqual(key.v, 1)
        XCTAssertEqual(key.keyIdData?.count, 16)
        XCTAssertNotNil(key.symmetricKey)
        let json = try JSONEncoder().encode(key)
        XCTAssertTrue(String(data: json, encoding: .utf8)!.contains("\"key_id\""))
        XCTAssertEqual(SickNoteMediaKey.parse(json), key)
    }

    func testParseFailsClosed() {
        XCTAssertNil(SickNoteMediaKey.parse(Data("not json".utf8)))
        // unsupported version
        XCTAssertNil(SickNoteMediaKey.parse(Data(#"{"v":2,"key_id":"404142434445464748494a4b4c4d4e4f","key":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=","created_at":"x"}"#.utf8)))
        // bad hex key_id and wrong-length key both reject
        XCTAssertNil(SickNoteMediaKey.parse(Data(#"{"v":1,"key_id":"zz","key":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=","created_at":"x"}"#.utf8)))
        XCTAssertNil(SickNoteMediaKey.parse(Data(#"{"v":1,"key_id":"404142434445464748494a4b4c4d4e4f","key":"AAA=","created_at":"x"}"#.utf8)))
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd LariatNative && swift test --filter SickNoteMediaKeyTests`
Expected: FAIL — `cannot find 'SickNoteMediaKey' in scope`.

- [ ] **Step 3: Write the implementation**

```swift
// LariatNative/Sources/LariatModel/Crypto/SickNoteMediaKey.swift
import Foundation
import CryptoKit

public struct SickNoteMediaKey: Codable, Equatable, Sendable {
    public let v: Int
    public let keyId: String   // 32 hex chars = 16 bytes
    public let key: String     // base64, 32 bytes
    public let createdAt: String

    enum CodingKeys: String, CodingKey {
        case v
        case keyId = "key_id"
        case key
        case createdAt = "created_at"
    }

    public static let currentVersion = 1

    public var keyIdData: Data? {
        let d = Self.dataFromHex(keyId)
        return d?.count == 16 ? d : nil
    }
    public var symmetricKey: SymmetricKey? {
        guard let d = Data(base64Encoded: key), d.count == 32 else { return nil }
        return SymmetricKey(data: d)
    }

    /// Fail-closed: nil on any malformed field. Never returns a guessed key.
    public static func parse(_ json: Data) -> SickNoteMediaKey? {
        guard let k = try? JSONDecoder().decode(SickNoteMediaKey.self, from: json) else { return nil }
        guard k.v == currentVersion, k.keyIdData != nil, k.symmetricKey != nil else { return nil }
        return k
    }

    public static func generate(now: Date) -> SickNoteMediaKey {
        var rng = SystemRandomNumberGenerator()
        let keyBytes = Data((0..<32).map { _ in UInt8.random(in: 0...255, using: &rng) })
        let idBytes = Data((0..<16).map { _ in UInt8.random(in: 0...255, using: &rng) })
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return SickNoteMediaKey(v: currentVersion,
                                keyId: hexFromData(idBytes),
                                key: keyBytes.base64EncodedString(),
                                createdAt: iso.string(from: now))
    }

    static func hexFromData(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }
    static func dataFromHex(_ s: String) -> Data? {
        let chars = Array(s)
        guard chars.count % 2 == 0 else { return nil }
        var out = Data(capacity: chars.count / 2)
        var i = 0
        while i < chars.count {
            guard let byte = UInt8(String(chars[i...(i + 1)]), radix: 16) else { return nil }
            out.append(byte); i += 2
        }
        return out
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd LariatNative && swift test --filter SickNoteMediaKeyTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatModel/Crypto/SickNoteMediaKey.swift LariatNative/Tests/LariatModelTests/SickNoteMediaKeyTests.swift
git commit -m "feat(native): SickNoteMediaKey versioned key value type (P0-6)"
```

---

## Task 3: SickNoteContentValidator — size cap + magic-byte sniff

**Files:**
- Create: `LariatNative/Sources/LariatModel/Compute/SickNoteContentValidator.swift`
- Test: `LariatNative/Tests/LariatModelTests/SickNoteContentValidatorTests.swift`

**Interfaces:**
- Produces: `enum SickNoteContentValidator` with `static let maxDocumentBytes = 25 * 1024 * 1024`; `enum Kind { case pdf, jpeg, png, heic }`; `static func sniff(_ bytes: Data) -> Kind?`; `static func matches(bytes: Data, ext: String) -> Bool`; `static func withinSizeLimit(_ byteCount: Int) -> Bool`.

- [ ] **Step 1: Write the failing test**

```swift
// LariatNative/Tests/LariatModelTests/SickNoteContentValidatorTests.swift
import XCTest
@testable import LariatModel

final class SickNoteContentValidatorTests: XCTestCase {
    let pdf  = Data([0x25,0x50,0x44,0x46,0x2D])                                    // %PDF-
    let jpeg = Data([0xFF,0xD8,0xFF,0xE0])
    let png  = Data([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A])
    let heic = Data([0,0,0,0x18,0x66,0x74,0x79,0x70,0x68,0x65,0x69,0x63])          // ....ftypheic

    func testSniffsKnownTypes() {
        XCTAssertEqual(SickNoteContentValidator.sniff(pdf), .pdf)
        XCTAssertEqual(SickNoteContentValidator.sniff(jpeg), .jpeg)
        XCTAssertEqual(SickNoteContentValidator.sniff(png), .png)
        XCTAssertEqual(SickNoteContentValidator.sniff(heic), .heic)
        XCTAssertNil(SickNoteContentValidator.sniff(Data([0x4D,0x5A,0x90,0x00]))) // MZ (exe)
    }

    func testMatchesRequiresExtensionAgreement() {
        XCTAssertTrue(SickNoteContentValidator.matches(bytes: jpeg, ext: "jpeg"))
        XCTAssertTrue(SickNoteContentValidator.matches(bytes: jpeg, ext: "jpg"))
        XCTAssertTrue(SickNoteContentValidator.matches(bytes: jpeg, ext: "jpe"))
        XCTAssertFalse(SickNoteContentValidator.matches(bytes: jpeg, ext: "pdf")) // renamed exe/mismatch
        XCTAssertFalse(SickNoteContentValidator.matches(bytes: Data([0x4D,0x5A]), ext: "pdf"))
    }

    func testSizeLimit() {
        XCTAssertTrue(SickNoteContentValidator.withinSizeLimit(1_000))
        XCTAssertFalse(SickNoteContentValidator.withinSizeLimit(25 * 1024 * 1024 + 1))
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd LariatNative && swift test --filter SickNoteContentValidatorTests`
Expected: FAIL — symbol not found.

- [ ] **Step 3: Write the implementation**

```swift
// LariatNative/Sources/LariatModel/Compute/SickNoteContentValidator.swift
import Foundation

/// Pure content validation for sick-note uploads (audit P0-6). Runs on plaintext
/// bytes BEFORE encryption. The App layer reads the leading bytes + file size and
/// calls in; keeping this pure makes it LariatModelTests-testable.
public enum SickNoteContentValidator {
    public static let maxDocumentBytes = 25 * 1024 * 1024

    public enum Kind: Equatable { case pdf, jpeg, png, heic }

    public static func withinSizeLimit(_ byteCount: Int) -> Bool { byteCount <= maxDocumentBytes }

    public static func sniff(_ bytes: Data) -> Kind? {
        let b = [UInt8](bytes.prefix(16))
        if b.count >= 5, b[0]==0x25, b[1]==0x50, b[2]==0x44, b[3]==0x46, b[4]==0x2D { return .pdf }
        if b.count >= 3, b[0]==0xFF, b[1]==0xD8, b[2]==0xFF { return .jpeg }
        if b.count >= 8, b[0]==0x89, b[1]==0x50, b[2]==0x4E, b[3]==0x47,
           b[4]==0x0D, b[5]==0x0A, b[6]==0x1A, b[7]==0x0A { return .png }
        if b.count >= 12, b[4]==0x66, b[5]==0x74, b[6]==0x79, b[7]==0x70 { // 'ftyp' box
            let brand = String(bytes: b[8..<12], encoding: .ascii) ?? ""
            if ["heic","heix","hevc","hevx","mif1","msf1"].contains(brand) { return .heic }
        }
        return nil
    }

    public static func matches(bytes: Data, ext: String) -> Bool {
        guard let kind = sniff(bytes) else { return false }
        switch kind {
        case .pdf:  return ext.lowercased() == "pdf"
        case .jpeg: return ["jpg","jpeg","jpe"].contains(ext.lowercased())
        case .png:  return ext.lowercased() == "png"
        case .heic: return ext.lowercased() == "heic"
        }
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd LariatNative && swift test --filter SickNoteContentValidatorTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatModel/Compute/SickNoteContentValidator.swift LariatNative/Tests/LariatModelTests/SickNoteContentValidatorTests.swift
git commit -m "feat(native): sick-note content validator (size cap + magic bytes, P0-6)"
```

---

## Task 4: SickNoteRetention — 730-day window, fail-open

**Files:**
- Create: `LariatNative/Sources/LariatModel/Compute/SickNoteRetention.swift`
- Test: `LariatNative/Tests/LariatModelTests/SickNoteRetentionTests.swift`

**Interfaces:**
- Consumes: `AuditLogCompute.parseTimestamp(_:) -> Date?` (existing, `LariatModel`).
- Produces: `enum SickNoteRetention` with `static let windowDays = 730`; `static let retentionCitation: String`; `static func isOverdue(uploadedAt: String, now: Date) -> Bool`.

- [ ] **Step 1: Write the failing test**

```swift
// LariatNative/Tests/LariatModelTests/SickNoteRetentionTests.swift
import XCTest
@testable import LariatModel

final class SickNoteRetentionTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1_800_000_000) // fixed "now"

    func iso(_ daysAgo: Double) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: now.addingTimeInterval(-daysAgo * 86_400))
    }

    func testOverduePastWindow() {
        XCTAssertTrue(SickNoteRetention.isOverdue(uploadedAt: iso(731), now: now))
        XCTAssertTrue(SickNoteRetention.isOverdue(uploadedAt: iso(730), now: now))
        XCTAssertFalse(SickNoteRetention.isOverdue(uploadedAt: iso(729), now: now))
        XCTAssertFalse(SickNoteRetention.isOverdue(uploadedAt: iso(1), now: now))
    }

    func testFailsOpenOnUnparseable() {
        // Malformed timestamp must NOT be flagged overdue (never delete real PHI on bad data).
        for junk in ["", "t", "not-a-date", "0000"] {
            XCTAssertFalse(SickNoteRetention.isOverdue(uploadedAt: junk, now: now), "junk \(junk) must fail open")
        }
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd LariatNative && swift test --filter SickNoteRetentionTests`
Expected: FAIL — symbol not found.

- [ ] **Step 3: Write the implementation**

```swift
// LariatNative/Sources/LariatModel/Compute/SickNoteRetention.swift
import Foundation

/// Sick-note document retention policy (audit P0-6, owner-ratified 2026-07-10).
public enum SickNoteRetention {
    public static let windowDays = 730
    public static let retentionCitation =
        "2 years after upload — HFWA-adjacent; matches the sick-worker report window in " +
        "HEALTH_SAFETY_LABOR_AUDIT §5; owner-ratified 2026-07-10."

    /// FAILS OPEN: an unparseable timestamp returns false (not overdue). Opposite polarity
    /// from the auth precedent — a malformed uploaded_at must never mark real PHI for deletion.
    public static func isOverdue(uploadedAt: String, now: Date) -> Bool {
        guard let ts = AuditLogCompute.parseTimestamp(uploadedAt) else { return false }
        return now.timeIntervalSince(ts) / 86_400 >= Double(windowDays)
    }
}
```

> If `AuditLogCompute.parseTimestamp` is not `public`, promote it to `public` in `LariatModel/AuditLogRecords.swift` in this commit (it is already used cross-file). Verify with `grep -n "func parseTimestamp" LariatNative/Sources/LariatModel/AuditLogRecords.swift`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd LariatNative && swift test --filter SickNoteRetentionTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatModel/Compute/SickNoteRetention.swift LariatNative/Tests/LariatModelTests/SickNoteRetentionTests.swift
git commit -m "feat(native): sick-note 2-year retention window (fail-open, P0-6)"
```

---

## Task 5: SickNoteTempStore — decrypt-to-temp path derivation

**Files:**
- Create: `LariatNative/Sources/LariatModel/Compute/SickNoteTempStore.swift`
- Test: `LariatNative/Tests/LariatModelTests/SickNoteTempStoreTests.swift`

**Interfaces:**
- Produces: `enum SickNoteTempStore` with `static let directoryName = "LariatSickNotes"`; `static func directory(base: URL) -> URL`; `static func fileURL(uuid: String, ext: String, base: URL) -> URL`; `static func isStale(modifiedAt: Date, now: Date, ttlSeconds: TimeInterval = 3600) -> Bool`.

- [ ] **Step 1: Write the failing test**

```swift
// LariatNative/Tests/LariatModelTests/SickNoteTempStoreTests.swift
import XCTest
@testable import LariatModel

final class SickNoteTempStoreTests: XCTestCase {
    let base = URL(fileURLWithPath: "/tmp/x", isDirectory: true)

    func testPaths() {
        XCTAssertEqual(SickNoteTempStore.directory(base: base).lastPathComponent, "LariatSickNotes")
        let f = SickNoteTempStore.fileURL(uuid: "ABC", ext: "PDF", base: base)
        XCTAssertEqual(f.lastPathComponent, "ABC.pdf")
        XCTAssertTrue(f.deletingLastPathComponent().path.hasSuffix("LariatSickNotes"))
    }

    func testStaleness() {
        let now = Date(timeIntervalSince1970: 10_000)
        XCTAssertTrue(SickNoteTempStore.isStale(modifiedAt: now.addingTimeInterval(-3601), now: now))
        XCTAssertFalse(SickNoteTempStore.isStale(modifiedAt: now.addingTimeInterval(-10), now: now))
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd LariatNative && swift test --filter SickNoteTempStoreTests`
Expected: FAIL — symbol not found.

- [ ] **Step 3: Write the implementation**

```swift
// LariatNative/Sources/LariatModel/Compute/SickNoteTempStore.swift
import Foundation

/// Where a decrypted sick-note is transiently written for the OS viewer (audit P0-6, §7/§12).
/// Path logic is pure/testable; the App layer does the writes + sweeps.
public enum SickNoteTempStore {
    public static let directoryName = "LariatSickNotes"

    public static func directory(base: URL = FileManager.default.temporaryDirectory) -> URL {
        base.appendingPathComponent(directoryName, isDirectory: true)
    }
    public static func fileURL(uuid: String, ext: String,
                               base: URL = FileManager.default.temporaryDirectory) -> URL {
        directory(base: base).appendingPathComponent("\(uuid).\(ext.lowercased())")
    }
    public static func isStale(modifiedAt: Date, now: Date, ttlSeconds: TimeInterval = 3600) -> Bool {
        now.timeIntervalSince(modifiedAt) > ttlSeconds
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd LariatNative && swift test --filter SickNoteTempStoreTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatModel/Compute/SickNoteTempStore.swift LariatNative/Tests/LariatModelTests/SickNoteTempStoreTests.swift
git commit -m "feat(native): sick-note temp-store path derivation (P0-6)"
```

---

## Task 6: SickNoteKeyStore — lazy key file, 0600, atomic

**Files:**
- Create: `LariatNative/Sources/LariatDB/SickNoteKeyStore.swift`
- Test: `LariatNative/Tests/LariatDBTests/SickNoteKeyStoreTests.swift`

**Interfaces:**
- Consumes: `SickNoteMediaKey` (Task 2).
- Produces: `struct SickNoteKeyStore` with `func keyPath(dataDir: URL) -> URL`; `func loadOrCreate(dataDir: URL, now: Date = Date()) throws -> SickNoteMediaKey`; `func writeIfAbsent(_ key: SickNoteMediaKey, dataDir: URL) throws`; `enum SickNoteKeyError: Error, Equatable { case malformedKeyFile }`.

- [ ] **Step 1: Write the failing test**

```swift
// LariatNative/Tests/LariatDBTests/SickNoteKeyStoreTests.swift
import XCTest
import LariatModel
@testable import LariatDB

final class SickNoteKeyStoreTests: XCTestCase {
    func tempDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    func testCreatesOnceThenReloadsSameKey() throws {
        let dir = tempDir(); defer { try? FileManager.default.removeItem(at: dir) }
        let store = SickNoteKeyStore()
        let k1 = try store.loadOrCreate(dataDir: dir)
        let path = store.keyPath(dataDir: dir).path
        XCTAssertTrue(FileManager.default.fileExists(atPath: path))
        let mode = (try FileManager.default.attributesOfItem(atPath: path)[.posixPermissions] as? NSNumber)?.intValue
        XCTAssertEqual(mode, 0o600)
        let k2 = try store.loadOrCreate(dataDir: dir)
        XCTAssertEqual(k1, k2, "second call must NOT regenerate the key")
        // key file sits OUTSIDE uploads/
        XCTAssertFalse(path.contains("/uploads/"))
        XCTAssertTrue(path.hasSuffix("keys/sick-note-media.json"))
    }

    func testMalformedFileFailsClosed() throws {
        let dir = tempDir(); defer { try? FileManager.default.removeItem(at: dir) }
        let store = SickNoteKeyStore()
        let path = store.keyPath(dataDir: dir)
        try FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("garbage".utf8).write(to: path)
        XCTAssertThrowsError(try store.loadOrCreate(dataDir: dir)) {
            XCTAssertEqual($0 as? SickNoteKeyError, .malformedKeyFile)
        }
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd LariatNative && swift test --filter SickNoteKeyStoreTests`
Expected: FAIL — symbol not found.

- [ ] **Step 3: Write the implementation**

```swift
// LariatNative/Sources/LariatDB/SickNoteKeyStore.swift
import Foundation
import LariatModel

public enum SickNoteKeyError: Error, Equatable { case malformedKeyFile }

/// Reads/creates the sick-note media key file (audit P0-6, §6). 0600, atomic write,
/// sibling of uploads/ and audit/ (OUTSIDE uploads/ so backups never copy it).
public struct SickNoteKeyStore {
    public init() {}

    public func keyPath(dataDir: URL) -> URL {
        dataDir.appendingPathComponent("keys", isDirectory: true)
               .appendingPathComponent("sick-note-media.json")
    }

    public func loadOrCreate(dataDir: URL, now: Date = Date()) throws -> SickNoteMediaKey {
        let path = keyPath(dataDir: dataDir)
        if FileManager.default.fileExists(atPath: path.path) {
            guard let key = SickNoteMediaKey.parse(try Data(contentsOf: path)) else {
                throw SickNoteKeyError.malformedKeyFile
            }
            return key
        }
        let key = SickNoteMediaKey.generate(now: now)
        try write(key, to: path)
        return key
    }

    /// Used by the Keychain heal path: write a recovered key only if none exists on disk.
    public func writeIfAbsent(_ key: SickNoteMediaKey, dataDir: URL) throws {
        let path = keyPath(dataDir: dataDir)
        guard !FileManager.default.fileExists(atPath: path.path) else { return }
        try write(key, to: path)
    }

    private func write(_ key: SickNoteMediaKey, to path: URL) throws {
        try FileManager.default.createDirectory(at: path.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(key).write(to: path, options: .atomic) // temp+rename
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd LariatNative && swift test --filter SickNoteKeyStoreTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatDB/SickNoteKeyStore.swift LariatNative/Tests/LariatDBTests/SickNoteKeyStoreTests.swift
git commit -m "feat(native): sick-note media key store (0600 atomic key file, P0-6)"
```

---

## Task 7: SickNoteRepository.attach — metadata-only audit payload

**Files:**
- Modify: `LariatNative/Sources/LariatDB/SickNoteRepository.swift`
- Modify: `LariatNative/Tests/LariatDBTests/SickNoteRepositoryTests.swift`

**Interfaces:**
- Consumes: existing `SickNoteRepository.attach(input:context:)`, `AuditEventWriter.encodePayload`, `AuditEventWriter.post`.
- Produces: a private `struct SickNoteAuditPayload: Encodable` (metadata only); attach's audit `payloadJSON` is now this struct, NOT the whole row.

**Context:** the existing `testAttachInsertsRowAndAuditEvent` asserts the audit payload *contains* the filename (`payload.contains("u.pdf")`). This task FLIPS that to assert its *absence* — `original_filename` is quasi-PHI that replicates to peers via Family-1 `audit_events` sync, beyond purge's reach (spec §7.5).

- [ ] **Step 1: Update the test to the new contract (make it fail)**

In `SickNoteRepositoryTests.swift`, find the attach/audit test (asserts `payload.contains("u.pdf")` ~L56) and change the payload assertions to:

```swift
// audit payload carries file metadata only — never the original filename (spec §7.5) or PHI
XCTAssertTrue(payload.contains("file_path"))
XCTAssertTrue(payload.contains(row.filePath))          // the UUID path, non-identifying
XCTAssertFalse(payload.contains("u.pdf"), "original_filename must NOT enter the audit payload")
XCTAssertFalse(payload.contains("symptom"))
XCTAssertFalse(payload.contains("diagnos"))
```

(If the seeded attach used `originalFilename: "u.pdf"`, keep that in the input — the point is it must not reach the payload.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd LariatNative && swift test --filter SickNoteRepositoryTests`
Expected: FAIL — `XCTAssertFalse(payload.contains("u.pdf"))` fails because attach currently encodes the whole row.

- [ ] **Step 3: Implement the metadata-only payload**

In `SickNoteRepository.swift`, add near the top of the type:

```swift
private struct SickNoteAuditPayload: Encodable {
    let reportId: Int64
    let locationId: String
    let filePath: String
    let kind: String
    let uploadedBy: String?
    let uploadedAt: String
}
```

In `attach(...)`, replace the audit `payloadJSON` argument. Change:

```swift
payloadJSON: AuditEventWriter.encodePayload(row),
```

to:

```swift
payloadJSON: AuditEventWriter.encodePayload(SickNoteAuditPayload(
    reportId: row.reportId, locationId: row.locationId, filePath: row.filePath,
    kind: row.kind, uploadedBy: row.uploadedBy, uploadedAt: row.uploadedAt)),
```

(`encodePayload` uses `.convertToSnakeCase`, so fields serialize as `report_id`, `file_path`, etc.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd LariatNative && swift test --filter SickNoteRepositoryTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatDB/SickNoteRepository.swift LariatNative/Tests/LariatDBTests/SickNoteRepositoryTests.swift
git commit -m "fix(native): drop original_filename from sick-note attach audit payload (P0-6)"
```

---

## Task 8: SickNoteRepository — purge + overdue/orphan queries

**Files:**
- Modify: `LariatNative/Sources/LariatDB/SickNoteRepository.swift`
- Modify: `LariatNative/Tests/LariatDBTests/SickNoteRepositoryTests.swift`

**Interfaces:**
- Consumes: `AuditedWriteRunner.perform`, `AuditEventWriter.post`, `SickNoteRetention.isOverdue` (Task 4), `RegulatedWriteContext`.
- Produces: `func purge(documentId: Int64, context: RegulatedWriteContext) throws -> String?` (returns the deleted row's `file_path` for post-commit unlink, or `nil` if no matching row at that location); `func overdueDocuments(locationId: String, now: Date) throws -> [SickNoteDocumentRow]`; `func orphanDocuments(locationId: String) throws -> [SickNoteDocumentRow]`.

- [ ] **Step 1: Write the failing test**

Extend `SickNoteRepositoryTests.swift`. Reuse the file's existing DB seeding helper (`makeRepos()` / `seedSickNoteDatabase()` pattern) to insert a parent report and documents with varied `uploaded_at`:

```swift
func testPurgeDeletesRowWritesAuditReturnsPath() throws {
    let (readDB, writeDB, _) = try makeRepos()
    let repo = SickNoteRepository(readDB: readDB, writeDB: writeDB)
    // seed one parent report (id 1, location 'default') + one document (see existing seed helper)
    let doc = try repo.attach(input: .init(reportId: 1, filePath: "sick-notes/1/a.pdf",
                                           kind: .note, originalFilename: "a.pdf",
                                           uploadedAt: "2020-01-01T00:00:00.000Z"),
                              context: .nativeMac(pinUser: seededManager))
    let path = try repo.purge(documentId: doc.id, context: .nativeMac(pinUser: seededManager))
    XCTAssertEqual(path, "sick-notes/1/a.pdf")
    try writeDB.pool.read { db in
        XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM sick_note_documents WHERE id = ?", arguments: [doc.id]), 0)
        let action = try String.fetchOne(db, sql: "SELECT action FROM audit_events WHERE entity='sick_note_documents' ORDER BY id DESC LIMIT 1")
        XCTAssertEqual(action, "delete")
        let payload = try String.fetchOne(db, sql: "SELECT payload_json FROM audit_events WHERE entity='sick_note_documents' ORDER BY id DESC LIMIT 1") ?? ""
        XCTAssertFalse(payload.contains("a.pdf"), "purge payload carries no original filename")
        XCTAssertFalse(payload.contains("symptom"))
    }
    // purging a non-existent / cross-location id returns nil, writes nothing
    XCTAssertNil(try repo.purge(documentId: 99_999, context: .nativeMac(pinUser: seededManager)))
}

func testOverdueAndOrphanQueries() throws {
    let (readDB, writeDB, _) = try makeRepos()
    let repo = SickNoteRepository(readDB: readDB, writeDB: writeDB)
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func iso(_ daysAgo: Double) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: now.addingTimeInterval(-daysAgo * 86_400))
    }
    _ = try repo.attach(input: .init(reportId: 1, filePath: "sick-notes/1/old.pdf", kind: .note,
                                     originalFilename: nil, uploadedAt: iso(800)),
                        context: .nativeMac(pinUser: seededManager))
    _ = try repo.attach(input: .init(reportId: 1, filePath: "sick-notes/1/new.pdf", kind: .note,
                                     originalFilename: nil, uploadedAt: iso(5)),
                        context: .nativeMac(pinUser: seededManager))
    let overdue = try repo.overdueDocuments(locationId: "default", now: now)
    XCTAssertEqual(overdue.map(\.filePath), ["sick-notes/1/old.pdf"])
    // orphan: a document whose report_id has no parent report
    _ = try repo.attach(input: .init(reportId: 1, filePath: "sick-notes/1/keep.pdf", kind: .note,
                                     originalFilename: nil, uploadedAt: iso(5)),
                        context: .nativeMac(pinUser: seededManager))
    try writeDB.pool.write { db in
        try db.execute(sql: "INSERT INTO sick_note_documents (report_id, location_id, file_path, kind, uploaded_at) VALUES (4242,'default','sick-notes/4242/x.pdf','note',?)", arguments: [iso(5)])
    }
    let orphans = try repo.orphanDocuments(locationId: "default")
    XCTAssertEqual(orphans.map(\.filePath), ["sick-notes/4242/x.pdf"])
}
```

> If the test file lacks a `seededManager` / `makeRepos()` returning readonly+write DBs, reuse whatever the existing attach test uses (it already constructs a repo and a `RegulatedWriteContext`). Match that helper's names exactly.

- [ ] **Step 2: Run to verify it fails**

Run: `cd LariatNative && swift test --filter SickNoteRepositoryTests`
Expected: FAIL — `purge`/`overdueDocuments`/`orphanDocuments` not found.

- [ ] **Step 3: Implement the methods**

Add to `SickNoteRepository`:

```swift
private struct SickNotePurgePayload: Encodable {
    let documentId: Int64
    let reportId: Int64
    let locationId: String
    let filePath: String
    let uploadedAt: String
}

/// Delete one document row + audit event in one transaction. Returns the row's file_path so
/// the caller unlinks the on-disk ciphertext AFTER commit (filesystem side-effects stay out of
/// the DB txn). Returns nil if no matching row at the context's location (no-op, no audit).
@discardableResult
public func purge(documentId: Int64, context: RegulatedWriteContext) throws -> String? {
    try AuditedWriteRunner.perform(db: writeDB) { db in
        guard let row = try SickNoteDocumentRow.fetchOne(db,
                sql: "SELECT * FROM sick_note_documents WHERE id = ? AND location_id = ?",
                arguments: [documentId, context.locationId]) else { return nil }
        try db.execute(sql: "DELETE FROM sick_note_documents WHERE id = ?", arguments: [documentId])
        _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
            entity: "sick_note_documents", entityId: row.id, action: .delete,
            actorCookId: context.actorCookId, actorSource: context.actorSource,
            payloadJSON: AuditEventWriter.encodePayload(SickNotePurgePayload(
                documentId: row.id, reportId: row.reportId, locationId: row.locationId,
                filePath: row.filePath, uploadedAt: row.uploadedAt)),
            note: "retention removal", locationId: row.locationId))
        return row.filePath
    }
}

/// Documents past the retention window. Filtered in Swift via the fail-open policy (SickNoteRetention).
public func overdueDocuments(locationId: String, now: Date) throws -> [SickNoteDocumentRow] {
    let rows = try writeDB.pool.read { db in
        try SickNoteDocumentRow.fetchAll(db,
            sql: "SELECT * FROM sick_note_documents WHERE location_id = ? ORDER BY uploaded_at",
            arguments: [locationId])
    }
    return rows.filter { SickNoteRetention.isOverdue(uploadedAt: $0.uploadedAt, now: now) }
}

/// Document rows whose parent sick_worker_report no longer exists (no FK, so orphans are possible).
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
```

> `SickNoteDocumentRow` must be `import LariatModel` visible in this file (it already is — attach returns it). `SickNoteRetention` is `LariatModel`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd LariatNative && swift test --filter SickNoteRepositoryTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatDB/SickNoteRepository.swift LariatNative/Tests/LariatDBTests/SickNoteRepositoryTests.swift
git commit -m "feat(native): sick-note purge (audited delete) + overdue/orphan queries (P0-6)"
```

---

## Task 9: SickNoteMigrator — filesystem encrypt-in-place sweep

**Files:**
- Create: `LariatNative/Sources/LariatDB/SickNoteMigrator.swift`
- Test: `LariatNative/Tests/LariatDBTests/SickNoteMigratorTests.swift`

**Interfaces:**
- Consumes: `SickNoteCrypto` (Task 1), `SickNoteMediaKey` (Task 2).
- Produces: `struct SickNoteMigrator` with `struct SweepResult: Equatable { var encrypted, alreadyEncrypted, failed: Int }`; `@discardableResult func encryptLegacyFiles(dataDir: URL, key: SickNoteMediaKey) throws -> SweepResult`.

- [ ] **Step 1: Write the failing test**

```swift
// LariatNative/Tests/LariatDBTests/SickNoteMigratorTests.swift
import XCTest
import CryptoKit
import LariatModel
@testable import LariatDB

final class SickNoteMigratorTests: XCTestCase {
    func testEncryptsLegacyInPlaceIdempotently() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let fileDir = dir.appendingPathComponent("uploads/sick-notes/1")
        try FileManager.default.createDirectory(at: fileDir, withIntermediateDirectories: true)
        let file = fileDir.appendingPathComponent("a.pdf")
        let plain = Data("%PDF-1.4 legacy".utf8)
        try plain.write(to: file)
        defer { try? FileManager.default.removeItem(at: dir) }

        let key = SickNoteMediaKey.generate(now: Date())
        let m = SickNoteMigrator()

        let r1 = try m.encryptLegacyFiles(dataDir: dir, key: key)
        XCTAssertEqual(r1.encrypted, 1)
        let onDisk = try Data(contentsOf: file)
        XCTAssertTrue(SickNoteCrypto.isEncrypted(onDisk))
        // decrypts back to the original with AAD = relative path
        let out = try SickNoteCrypto.open(onDisk, key: key.symmetricKey!, keyId: key.keyIdData!, filePath: "sick-notes/1/a.pdf")
        XCTAssertEqual(out, plain)
        // idempotent
        let r2 = try m.encryptLegacyFiles(dataDir: dir, key: key)
        XCTAssertEqual(r2.encrypted, 0)
        XCTAssertEqual(r2.alreadyEncrypted, 1)
    }

    func testNoSickNotesDirIsNoOp() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let r = try SickNoteMigrator().encryptLegacyFiles(dataDir: dir, key: SickNoteMediaKey.generate(now: Date()))
        XCTAssertEqual(r, .init(encrypted: 0, alreadyEncrypted: 0, failed: 0))
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd LariatNative && swift test --filter SickNoteMigratorTests`
Expected: FAIL — symbol not found.

- [ ] **Step 3: Write the implementation**

```swift
// LariatNative/Sources/LariatDB/SickNoteMigrator.swift
import Foundation
import LariatModel

/// One-time / on-launch sweep that encrypts any legacy plaintext sick-note file in place
/// (audit P0-6, §8). Filesystem-only: no DB access, no audit events, no file_path change.
/// Idempotent. Expected to be a no-op given the zero corpus at rollout.
public struct SickNoteMigrator {
    public init() {}

    public struct SweepResult: Equatable {
        public var encrypted: Int
        public var alreadyEncrypted: Int
        public var failed: Int
        public init(encrypted: Int = 0, alreadyEncrypted: Int = 0, failed: Int = 0) {
            self.encrypted = encrypted; self.alreadyEncrypted = alreadyEncrypted; self.failed = failed
        }
    }

    @discardableResult
    public func encryptLegacyFiles(dataDir: URL, key: SickNoteMediaKey) throws -> SweepResult {
        guard let keyId = key.keyIdData, let symKey = key.symmetricKey else {
            throw SickNoteKeyError.malformedKeyFile
        }
        let uploads = dataDir.appendingPathComponent("uploads")
        let root = uploads.appendingPathComponent("sick-notes")
        var result = SweepResult()
        guard let walker = FileManager.default.enumerator(at: root,
                includingPropertiesForKeys: [.isRegularFileKey]) else { return result }
        let base = uploads.standardizedFileURL.path + "/"
        for case let fileURL as URL in walker {
            guard (try? fileURL.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true,
                  !fileURL.lastPathComponent.hasSuffix(".tmp") else { continue }
            guard let data = try? Data(contentsOf: fileURL) else { result.failed += 1; continue }
            if SickNoteCrypto.isEncrypted(data) { result.alreadyEncrypted += 1; continue }
            let full = fileURL.standardizedFileURL.path
            let rel = full.hasPrefix(base) ? String(full.dropFirst(base.count)) : fileURL.lastPathComponent
            do {
                let sealed = try SickNoteCrypto.seal(data, key: symKey, keyId: keyId, filePath: rel)
                let tmp = fileURL.deletingLastPathComponent().appendingPathComponent(".\(UUID().uuidString).tmp")
                try sealed.write(to: tmp, options: .atomic)
                _ = try FileManager.default.replaceItemAt(fileURL, withItemAt: tmp)
                try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
                result.encrypted += 1
            } catch {
                result.failed += 1
            }
        }
        return result
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd LariatNative && swift test --filter SickNoteMigratorTests`
Expected: PASS.

- [ ] **Step 5: Full native gate + commit**

```bash
cd LariatNative && swift build && swift test    # expect all green (Model + DB suites)
cd .. && git add LariatNative/Sources/LariatDB/SickNoteMigrator.swift LariatNative/Tests/LariatDBTests/SickNoteMigratorTests.swift
git commit -m "feat(native): sick-note legacy encrypt-in-place migrator (P0-6)"
```

---

## Task 10: Attach — validate + encrypt on write (App, build-verified)

**Files:**
- Modify: `LariatNative/Sources/LariatApp/UI/Support/SickNoteAttach.swift`

**Interfaces:**
- Consumes: `SickNoteContentValidator` (Task 3), `SickNoteKeyStore` (Task 6), `SickNoteCrypto` (Task 1).
- Produces: unchanged `copyIn(pickedURL:reportId:dataDir:) throws -> Picked` (now writes ciphertext) + new `SickNoteAttachError` cases.

- [ ] **Step 1: Extend the error enum (PHI-safe copy, no filename)**

```swift
enum SickNoteAttachError: LocalizedError {
    case unsupportedType(String)
    case tooLarge
    case contentMismatch
    case encryptionUnavailable

    var errorDescription: String? {
        switch self {
        case .unsupportedType:      return "That file type isn't allowed here."
        case .tooLarge:             return "That file is too big to attach."
        case .contentMismatch:      return "That file doesn't look like a real photo or PDF."
        case .encryptionUnavailable:return "Couldn't lock the file safely — please try again."
        }
    }
}
```

- [ ] **Step 2: Rewrite the copy body to read → validate → encrypt**

Replace the current `guard SickNoteDocumentCompute.validate...` / `copyItem` block in `copyIn` with:

```swift
guard SickNoteDocumentCompute.validate(filename: name) else { throw SickNoteAttachError.unsupportedType(name) }
let ext = (name as NSString).pathExtension

// size gate BEFORE reading the whole file
if let size = try FileManager.default.attributesOfItem(atPath: src.path)[.size] as? Int,
   !SickNoteContentValidator.withinSizeLimit(size) {
    throw SickNoteAttachError.tooLarge
}
let plaintext = try Data(contentsOf: src)
guard SickNoteContentValidator.matches(bytes: plaintext, ext: ext) else {
    throw SickNoteAttachError.contentMismatch
}

let rel = SickNoteDocumentCompute.storedPath(reportId: reportId, uuid: UUID().uuidString, ext: ext)
let dest = dataDir.appendingPathComponent("uploads").appendingPathComponent(rel)
try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)

let mediaKey = try SickNoteKeyStore().loadOrCreate(dataDir: dataDir)
guard let keyId = mediaKey.keyIdData, let symKey = mediaKey.symmetricKey else {
    throw SickNoteAttachError.encryptionUnavailable
}
let sealed = try SickNoteCrypto.seal(plaintext, key: symKey, keyId: keyId, filePath: rel)
try sealed.write(to: dest, options: .atomic)
try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: dest.path)
```

Keep the `Picked(filePath: rel, originalFilename: name, destination: dest)` return unchanged — `destination` must be the ciphertext file so the VM's failed-insert cleanup still removes it.

- [ ] **Step 3: Add `import LariatDB` if absent** (for `SickNoteKeyStore`) at the top of the file, and confirm `import LariatModel` is present.

- [ ] **Step 4: Build-verify**

Run: `cd LariatNative && swift build`
Expected: builds clean. (No App test target — verified by build only.)

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatApp/UI/Support/SickNoteAttach.swift
git commit -m "feat(native): validate + encrypt sick-note files on attach (P0-6)"
```

---

## Task 11: View — decrypt-to-temp open + legacy grace (App, build-verified)

**Files:**
- Modify: `LariatNative/Sources/LariatApp/UI/ViewModels/SickWorkerViewModel.swift`
- Modify: `LariatNative/Sources/LariatApp/UI/Boards/SickWorkerView.swift`

**Interfaces:**
- Consumes: `SickNoteCrypto`, `SickNoteKeyStore`, `SickNoteTempStore`, `SickNoteDocumentCompute.safeUploadRelativePath`.
- Produces: `nonisolated static func decryptedOpenURL(_ doc: SickNoteDocumentRow, dataDir: URL, env:) throws -> URL?`.

- [ ] **Step 1: Add the decrypt-to-temp resolver to the VM**

```swift
// SickWorkerViewModel.swift — a nonisolated static helper (file I/O off the MainActor)
nonisolated static func decryptedOpenURL(_ doc: SickNoteDocumentRow,
                                         dataDir: URL,
                                         env: [String: String] = ProcessInfo.processInfo.environment) throws -> URL? {
    guard let onDisk = documentFileURL(doc, env: env) else { return nil } // containment-checked
    let data = try Data(contentsOf: onDisk)
    if !SickNoteCrypto.isEncrypted(data) { return onDisk }                 // legacy plaintext grace
    let mediaKey = try SickNoteKeyStore().loadOrCreate(dataDir: dataDir)
    guard let keyId = mediaKey.keyIdData, let symKey = mediaKey.symmetricKey else { return nil }
    // AAD = the stored relative file_path (identical to what attach/migrator sealed with)
    let plaintext = try SickNoteCrypto.open(data, key: symKey, keyId: keyId, filePath: doc.filePath)
    let ext = (doc.filePath as NSString).pathExtension
    let tmpDir = SickNoteTempStore.directory()
    try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true,
                                            attributes: [.posixPermissions: 0o700])
    let tmp = SickNoteTempStore.fileURL(uuid: UUID().uuidString, ext: ext)
    try plaintext.write(to: tmp, options: .atomic)
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tmp.path)
    return tmp
}
```

> `dataRoot()` already exists in the VM — expose or reuse it to supply `dataDir`. `documentFileURL` keeps its symlink-resolved containment check unchanged.

- [ ] **Step 2: Route the Open button through it (SickWorkerView.documentRow)**

Replace the current `Button { NSWorkspace.shared.open(url) }` with a call that decrypts first:

```swift
Button {
    if let url = try? SickWorkerViewModel.decryptedOpenURL(doc, dataDir: vm.dataRootURL) {
        NSWorkspace.shared.open(url)
    }
} label: { /* unchanged label */ }
```

(Expose `vm.dataRootURL` as a small `var dataRootURL: URL { Self.dataRoot() }` if the View needs it.)

- [ ] **Step 3: Build-verify**

Run: `cd LariatNative && swift build`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatApp/UI/ViewModels/SickWorkerViewModel.swift LariatNative/Sources/LariatApp/UI/Boards/SickWorkerView.swift
git commit -m "feat(native): decrypt sick-note to temp for the OS viewer, legacy grace path (P0-6)"
```

---

## Task 12: Keychain mirror (App, build-verified)

**Files:**
- Create: `LariatNative/Sources/LariatApp/UI/Support/SickNoteKeychain.swift`

**Interfaces:**
- Consumes: `SickNoteMediaKey`, `SickNoteKeyStore`.
- Produces: `enum SickNoteKeychain` with `static func load() -> SickNoteMediaKey?`; `static func store(_ key: SickNoteMediaKey)`; `static func healAndMirror(dataDir: URL)`.

- [ ] **Step 1: Write the Keychain shim**

```swift
// LariatNative/Sources/LariatApp/UI/Support/SickNoteKeychain.swift
import Foundation
import LariatModel
import LariatDB
#if canImport(Security)
import Security
#endif

/// Recovery mirror for the sick-note media key (audit P0-6, §6). The key FILE is authoritative;
/// the Keychain is a best-effort recovery copy. Failures warn once and never block attach/view.
enum SickNoteKeychain {
    static let service = "com.lariat.sick-note-media-key"

    #if canImport(Security)
    static func load() -> SickNoteMediaKey? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return SickNoteMediaKey.parse(data)
    }

    static func store(_ key: SickNoteMediaKey) {
        guard let data = try? JSONEncoder().encode(key) else { return }
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.keyId,
        ]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        if status != errSecSuccess { warnOnce("keychain store failed: \(status)") }
    }
    #else
    static func load() -> SickNoteMediaKey? { nil }
    static func store(_ key: SickNoteMediaKey) {}
    #endif

    /// On launch: heal a missing key file from the Keychain, else mirror the file into the Keychain.
    static func healAndMirror(dataDir: URL) {
        let store = SickNoteKeyStore()
        let hasFile = FileManager.default.fileExists(atPath: store.keyPath(dataDir: dataDir).path)
        if !hasFile, let recovered = load() {
            try? store.writeIfAbsent(recovered, dataDir: dataDir)
            return
        }
        if hasFile, let onDisk = try? store.loadOrCreate(dataDir: dataDir), SickNoteKeychain.load() == nil {
            SickNoteKeychain.store(onDisk)
        }
    }

    private static var warned = false
    private static func warnOnce(_ msg: String) {
        if !warned { warned = true; FileHandle.standardError.write(Data("[sick-note-keychain] \(msg)\n".utf8)) }
    }
}
```

- [ ] **Step 2: Build-verify**

Run: `cd LariatNative && swift build`
Expected: builds clean (Security links on macOS with no Package.swift change).

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/UI/Support/SickNoteKeychain.swift
git commit -m "feat(native): Keychain recovery mirror for sick-note media key (P0-6)"
```

---

## Task 13: Board purge UI + launch sweeps (App, build-verified)

**Files:**
- Modify: `LariatNative/Sources/LariatApp/UI/ViewModels/SickWorkerViewModel.swift`
- Modify: `LariatNative/Sources/LariatApp/UI/Boards/SickWorkerView.swift`
- Modify: the app launch site (the `App`/scene startup that already opens the DB — locate via `grep -rn "resolveDataDirectory\|\.task {" LariatNative/Sources/LariatApp` and pick the top-level startup).

**Interfaces:**
- Consumes: `SickNoteRepository.purge/overdueDocuments/orphanDocuments` (Task 8), `SickNoteMigrator` (Task 9), `SickNoteKeychain` (Task 12), `SickNoteTempStore` (Task 5), `SickNoteKeyStore` (Task 6).

- [ ] **Step 1: Add the PIN-gated purge action to the VM**

```swift
// SickWorkerViewModel.swift (@MainActor)
@Published var lateDocuments: [SickNoteDocumentRow] = []   // overdue + orphan, shown behind pinOk

func refreshLateDocuments(now: Date = Date()) async {
    guard pinOk, let loc = pinStore.activeUser?.locationId else { lateDocuments = []; return }
    let overdue = (try? repo.overdueDocuments(locationId: loc, now: now)) ?? []
    let orphan  = (try? repo.orphanDocuments(locationId: loc)) ?? []
    // de-dup by id, orphans first
    var seen = Set<Int64>(); lateDocuments = (orphan + overdue).filter { seen.insert($0.id).inserted }
}

func removeDocument(_ doc: SickNoteDocumentRow) {
    do {
        let user = try ManagementWrite().requireSession(pinStore.session)          // re-gate
        try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
        let ctx = RegulatedWriteContext.nativeMac(pinUser: user)
        if let rel = try repo.purge(documentId: doc.id, context: ctx),
           let safe = SickNoteDocumentCompute.safeUploadRelativePath(rel) {
            let onDisk = Self.dataRoot().appendingPathComponent("uploads").appendingPathComponent(safe)
            try? FileManager.default.removeItem(at: onDisk)   // best-effort, AFTER commit
        }
        Task { await refreshLateDocuments(); await refreshDocuments() }
    } catch {
        attachError = Self.attachErrorMessage(for: error)
    }
}
```

- [ ] **Step 2: Add the "late paperwork" section to the board (behind pinOk)**

In `SickWorkerView`, add a section rendered only when `vm.pinOk && !vm.lateDocuments.isEmpty`: a list of the documents with a **Remove** button per row that calls `vm.removeDocument(doc)`, plus a one-line header using kitchen-native copy (e.g. "Old paperwork you can clear"). Never render a filename in this locked-context list beyond the display label the board already uses. Trigger `await vm.refreshLateDocuments()` from the board's existing `.task`/refresh.

- [ ] **Step 3: Wire the launch sweeps**

At the app startup site, after the data dir is known, run once (off the main actor):

```swift
Task.detached(priority: .utility) {
    let dataDir = URL(fileURLWithPath: LariatDB.resolveDataDirectory())
    SickNoteKeychain.healAndMirror(dataDir: dataDir)
    if let key = try? SickNoteKeyStore().loadOrCreate(dataDir: dataDir) {
        _ = try? SickNoteMigrator().encryptLegacyFiles(dataDir: dataDir, key: key)
    }
    // sweep stale decrypted temp files
    let now = Date()
    let tmpDir = SickNoteTempStore.directory()
    if let items = try? FileManager.default.contentsOfDirectory(at: tmpDir, includingPropertiesForKeys: [.contentModificationDateKey]) {
        for item in items {
            let mod = (try? item.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            if SickNoteTempStore.isStale(modifiedAt: mod, now: now) { try? FileManager.default.removeItem(at: item) }
        }
    }
}
```

> `resolveDataDirectory()` takes defaulted args (env/cwd) — call the no-arg form. Do NOT run the migrator against `data/lariat.db`'s schema — it never touches the DB, only `uploads/sick-notes/**`, so it is safe pre-Phase-C-flip.

- [ ] **Step 4: Build-verify**

Run: `cd LariatNative && swift build && swift test`
Expected: builds clean; all Model/DB tests still green.

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatApp
git commit -m "feat(native): late-paperwork purge UI + launch encrypt/temp sweeps (P0-6)"
```

---

## Task 14: Report-only nightly retention job (web, TDD)

**Files:**
- Create: `scripts/sick-note-retention.mjs`
- Create: `tests/js/test-sick-note-retention.mjs`
- Modify: `package.json` (scripts + verify), `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `lib/dataDir.ts` `resolveDataDir()`; `better-sqlite3` (as in `scripts/backup.mjs`).
- Produces: `export const RETENTION_DAYS = 730`; `export function cutoffISO(now?, days?) : string`; `export function runRetentionReport({ now?, dbPath?, dataDir? }) : { cutoff, retentionDays, overdueCount, overdue: Array<{id, report_id, location_id, file_path, uploaded_at, present}> }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/js/test-sick-note-retention.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const { runRetentionReport, cutoffISO, RETENTION_DAYS } = await import('../../scripts/sick-note-retention.mjs');

function tmpDir() {
  const d = path.join(process.cwd(), `.tmp-retention-${process.pid}-${Math.floor(process.hrtime()[1])}`);
  fs.mkdirSync(path.join(d, 'uploads', 'sick-notes', '1'), { recursive: true });
  return d;
}
function iso(daysAgo) { return new Date(Date.now() - daysAgo * 86400_000).toISOString(); }

describe('sick-note retention report', () => {
  it('flags only documents past the 2-year window, and reports file presence', () => {
    const dir = tmpDir();
    const dbPath = path.join(dir, 'lariat.db');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE sick_note_documents (id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL, location_id TEXT NOT NULL, file_path TEXT NOT NULL,
      kind TEXT NOT NULL, original_filename TEXT, uploaded_by TEXT, uploaded_at TEXT NOT NULL)`);
    const ins = db.prepare(`INSERT INTO sick_note_documents (report_id,location_id,file_path,kind,uploaded_at) VALUES (?,?,?,?,?)`);
    ins.run(1, 'default', 'sick-notes/1/old.pdf', 'note', iso(800));  // overdue, file present
    ins.run(1, 'default', 'sick-notes/1/new.pdf', 'note', iso(10));   // fresh
    db.close();
    fs.writeFileSync(path.join(dir, 'uploads', 'sick-notes', '1', 'old.pdf'), 'X');

    const r = runRetentionReport({ dbPath, dataDir: dir });
    assert.equal(RETENTION_DAYS, 730);
    assert.equal(r.overdueCount, 1);
    assert.equal(r.overdue[0].file_path, 'sick-notes/1/old.pdf');
    assert.equal(r.overdue[0].present, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns zero on a fresh DB with no table (report-only, never throws)', () => {
    const dir = tmpDir();
    const dbPath = path.join(dir, 'lariat.db');
    new Database(dbPath).close(); // empty DB, no table
    const r = runRetentionReport({ dbPath, dataDir: dir });
    assert.equal(r.overdueCount, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-sick-note-retention.mjs`
Expected: FAIL — cannot resolve `scripts/sick-note-retention.mjs`.

- [ ] **Step 3: Write the script**

```js
// scripts/sick-note-retention.mjs
// Report-only: identifies sick-note documents past the 2-year retention window.
// NEVER deletes — deletion is a PIN-gated one-click action in the native app (audit P0-6).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { resolveDataDir } from '../lib/dataDir.ts';

export const RETENTION_DAYS = 730;

export function cutoffISO(now = new Date(), days = RETENTION_DAYS) {
  return new Date(now.getTime() - days * 86400_000).toISOString();
}

export function runRetentionReport({ now = new Date(), dbPath, dataDir } = {}) {
  const dir = dataDir ?? resolveDataDir();
  const db = new Database(dbPath ?? path.join(dir, 'lariat.db'), { readonly: true });
  try {
    const cutoff = cutoffISO(now);
    const hasTable = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='sick_note_documents'`).get();
    if (!hasTable) return { cutoff, retentionDays: RETENTION_DAYS, overdueCount: 0, overdue: [] };
    const rows = db.prepare(
      `SELECT id, report_id, location_id, file_path, uploaded_at
         FROM sick_note_documents WHERE uploaded_at <= ? ORDER BY uploaded_at`).all(cutoff);
    const overdue = rows.map((r) => ({
      ...r,
      present: fs.existsSync(path.join(dir, 'uploads', r.file_path)),
    }));
    return { cutoff, retentionDays: RETENTION_DAYS, overdueCount: overdue.length, overdue };
  } finally {
    db.close();
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = runRetentionReport();
  // Durable evidence via run-job's ingest_runs bookkeeping + captured stdout.
  console.log(JSON.stringify({
    kind: 'sick-note-retention', retention_days: r.retentionDays, cutoff: r.cutoff,
    overdue: r.overdueCount, missing_files: r.overdue.filter((d) => !d.present).length,
  }));
  process.exit(0);
}
```

> `import Database from 'better-sqlite3'` matches `scripts/backup.mjs`. If backup.mjs uses a different import form, mirror it exactly (confirm with `grep -n "better-sqlite3" scripts/backup.mjs`).

- [ ] **Step 4: Run to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-sick-note-retention.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire npm + verify + CI**

In `package.json`, add to `"scripts"`:

```json
"retention:sick-notes": "node --experimental-strip-types scripts/sick-note-retention.mjs",
"test:sick-note-retention": "node --experimental-strip-types --test tests/js/test-sick-note-retention.mjs",
```

and append `&& npm run test:sick-note-retention` to the `"verify"` script chain (next to `test:backup`).

In `.github/workflows/ci.yml`, add a discrete step after the backup test step:

```yaml
      - name: Sick-note retention report test
        run: npm run test:sick-note-retention
```

- [ ] **Step 6: Verify + commit**

Run: `npm run test:sick-note-retention && npm run verify`
Expected: both green.

```bash
git add scripts/sick-note-retention.mjs tests/js/test-sick-note-retention.mjs package.json .github/workflows/ci.yml
git commit -m "feat(ops): report-only sick-note retention job wired into verify + CI (P0-6)"
```

---

## Task 15: Schedule the retention job (web)

**Files:**
- Modify: `data/scheduled-jobs.json`
- Modify: `examples/lariat.crontab`

- [ ] **Step 1: Add the job entry**

In `data/scheduled-jobs.json`, add a sibling of the existing `backup` job (match the file's exact shape for `command`/`cron`/`timeout_sec`/`description`):

```json
"sick-note-retention": {
  "command": ["node", "--experimental-strip-types", "scripts/sick-note-retention.mjs"],
  "cron": "30 1 * * *",
  "timeout_sec": 120,
  "description": "Report sick-note documents past the 2-year retention window (report-only; never deletes)."
}
```

While here, refresh the stale `backup` entry `description` to match post-#457 behavior (one online snapshot + uploads + audit + integrity check) — same file, verified drift (spec §11).

- [ ] **Step 2: Add the cron line**

In `examples/lariat.crontab`, inside the `# LARIAT_CRON_BEGIN` / `# LARIAT_CRON_END` markers, add a line mirroring the existing backup line's `cron-wrapper.sh` form:

```
30 1 * * * /path/to/repo/scripts/cron-wrapper.sh sick-note-retention
```

(Match the exact wrapper path/format used by the neighboring backup line; `install-cron.sh` copies the whole marker block, so it needs no edit.)

- [ ] **Step 3: Sanity-check the manifest loads**

Run: `node --experimental-strip-types -e "import('./scripts/run-job.mjs').then(m => console.log(m.listJobs(m.loadManifest()).map(j => j.name)))"`
Expected: output includes `sick-note-retention` and `backup`.

- [ ] **Step 4: Commit**

```bash
git add data/scheduled-jobs.json examples/lariat.crontab
git commit -m "feat(ops): schedule the nightly sick-note retention report (P0-6)"
```

---

## Task 16: Backup manifest key fingerprint (web, TDD)

**Files:**
- Modify: `scripts/backup.mjs`
- Modify: `tests/js/test-backup.mjs`

**Interfaces:**
- Produces: `manifest.sick_note_key_fingerprint` — first 16 hex chars of SHA-256 over the raw media key, or `null` when no key file exists. The key file is NOT copied into the backup (it lives outside `uploads/`); only the fingerprint is recorded, so a restore can detect a key mismatch.

- [ ] **Step 1: Add the failing assertion to the happy-path test**

In `tests/js/test-backup.mjs`, in the `seedDataDir` helper add a key file, and in the "snapshots the DB…" happy-path test assert the fingerprint:

```js
// in seedDataDir(dir):
fs.mkdirSync(path.join(dir, 'keys'), { recursive: true });
fs.writeFileSync(path.join(dir, 'keys', 'sick-note-media.json'),
  JSON.stringify({ v: 1, key_id: '40414243444546474849 4a4b4c4d4e4f'.replace(/ /g,''),
                   key: Buffer.alloc(32, 7).toString('base64'), created_at: '2026-07-10T00:00:00.000Z' }));

// in the happy-path test, after reading manifest.json:
assert.match(manifest.sick_note_key_fingerprint, /^[0-9a-f]{16}$/);
// deterministic: sha256 of 32 bytes of 0x07, first 16 hex chars
assert.equal(manifest.sick_note_key_fingerprint,
  crypto.createHash('sha256').update(Buffer.alloc(32, 7)).digest('hex').slice(0, 16));
```

(Import `crypto` in the test if not already: `import crypto from 'node:crypto'`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:backup`
Expected: FAIL — `manifest.sick_note_key_fingerprint` is `undefined`.

- [ ] **Step 3: Implement the fingerprint in backup.mjs**

In `runBackup`, before the `manifest` object is written, compute the fingerprint from the (out-of-backup) key file:

```js
let sickNoteKeyFingerprint = null;
try {
  const keyFile = path.join(dataDir, 'keys', 'sick-note-media.json');
  if (fs.existsSync(keyFile)) {
    const parsed = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    if (parsed && typeof parsed.key === 'string') {
      const raw = Buffer.from(parsed.key, 'base64');
      if (raw.length === 32) {
        sickNoteKeyFingerprint = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
      }
    }
  }
} catch { /* leave null — provenance metadata only */ }
```

Add `sick_note_key_fingerprint: sickNoteKeyFingerprint` as a top-level sibling in the `manifest` object literal (next to `includes_audit`). `crypto` and `fs`/`path` are already imported.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:backup`
Expected: PASS.

- [ ] **Step 5: Full web gate + commit**

```bash
npm run verify    # expect green: eslint, typecheck, jest, node tests (incl. test:backup + test:sick-note-retention), pytest, build
git add scripts/backup.mjs tests/js/test-backup.mjs
git commit -m "feat(ops): record sick-note key fingerprint in backup manifest (P0-6)"
```

---

## Task 17: Docs — contracts, audit table, key-escrow

**Files:**
- Modify: `docs/HEALTH_SAFETY_LABOR_AUDIT.md`
- Modify: `docs/PROTECTED_CONTRACTS.md`
- Modify: the backup/restore doc created alongside #457 (find via `grep -rln "backup -- verify\|restore drill" docs`)

- [ ] **Step 1: HEALTH_SAFETY_LABOR_AUDIT §5** — add a document-retention row: "Doctor's-note documents: encrypted at rest (LSN1/AES-256-GCM); 2-year retention (HFWA-adjacent), flagged then PIN-confirmed removal." Correct the aspirational "encrypted export" cell to state exactly what exists (file-at-rest encryption; `export.mjs` is NOT encrypted — see the out-of-scope note in the spec §16).

- [ ] **Step 2: PROTECTED_CONTRACTS.md** — add a PHI-file section: sick-note files are ciphertext at rest (`LSN1`, AAD-bound to `file_path`); the media key never enters backups or git; attach/purge are audited writes with metadata-only payloads (no `original_filename`, no symptoms/diagnosis); removal is PIN-gated.

- [ ] **Step 3: Backup/restore key-escrow note** — document that the media key (`<dataDir>/keys/sick-note-media.json`) is excluded from backups by design; recovery is the macOS Keychain mirror (same Mac / iCloud Keychain) plus a one-time manual copy of the key file into a password manager; restoring to a new Mac requires placing the key file back under `<dataDir>/keys/`. The backup manifest's `sick_note_key_fingerprint` lets a restore confirm the right key is present.

- [ ] **Step 4: Commit**

```bash
git add docs/HEALTH_SAFETY_LABOR_AUDIT.md docs/PROTECTED_CONTRACTS.md docs/*backup* 2>/dev/null
git commit -m "docs: sick-note PHI encryption + retention contracts and key escrow (P0-6)"
```

---

## Final verification (before PR)

- [ ] `cd LariatNative && swift build && swift test` — all green (5 new Model suites, 2 new DB suites, extended SickNoteRepositoryTests).
- [ ] `npm run verify` from repo root — green (eslint, typecheck, jest, node tests incl. `test:backup` + `test:sick-note-retention`, pytest, build).
- [ ] `git diff --stat origin/main` shows NO change to `lib/db.ts`, `frozen_schema.sql`, or `SchemaMigrator` (schema untouched; `SCHEMA_VERSION` still 4).
- [ ] `mcp__gitnexus__detect_changes({scope:"compare", base_ref:"main"})` — affected symbols match this plan; no unexpected blast radius.
- [ ] Manual GUI smoke (out-of-sandbox, owner-run): attach a PDF → the on-disk file under `uploads/sick-notes/…` starts with bytes `LSN1`; Open renders it in Preview; the late-paperwork Remove deletes the row + file and writes an `audit_events` `delete`; Keychain Access shows a `com.lariat.sick-note-media-key` item.
- [ ] Confirm with the owner whether the restaurant Mac holds any pre-existing sick-note files (this box has zero); the migration sweep handles either answer but the confirmation closes the historical-plaintext question.

## Out-of-scope items to surface in the PR description (do NOT fix here — spec §16)

1. `scripts/export.mjs` writes sick-worker symptoms/diagnosis to a **non-gitignored** `exports/sick_worker_<date>.csv` with **no PIN gate** — recommend a separate audit-follow-up ticket.
2. The raw recipe-photo GET route lacks `X-Content-Type-Options: nosniff` / PIN (non-PHI; note only).
3. Ad-hoc `backups/lariat_2026-07-10_07-13.db` (old bare-file naming) sits beside #457's stamped dirs — an out-of-band snapshot practice the key-escrow story doesn't cover; flag to the owner.
