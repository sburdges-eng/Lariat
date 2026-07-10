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
