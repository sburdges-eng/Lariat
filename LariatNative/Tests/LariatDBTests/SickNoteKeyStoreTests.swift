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
        let keysDir = (path as NSString).deletingLastPathComponent
        let dirMode = (try FileManager.default.attributesOfItem(atPath: keysDir)[.posixPermissions] as? NSNumber)?.intValue
        XCTAssertEqual(dirMode, 0o700, "keys/ dir must be owner-only")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: keysDir), ["sick-note-media.json"],
                       "no temp residue may remain next to the key")
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

    func testWriteIfAbsentWritesWhenMissingButNoOpsWhenPresent() throws {
        let dir = tempDir(); defer { try? FileManager.default.removeItem(at: dir) }
        let store = SickNoteKeyStore()
        let path = store.keyPath(dataDir: dir).path

        // No key file yet: writeIfAbsent must write it, and it must parse back equal.
        let recovered = SickNoteMediaKey.generate(now: Date())
        XCTAssertFalse(FileManager.default.fileExists(atPath: path))
        try store.writeIfAbsent(recovered, dataDir: dir)
        XCTAssertTrue(FileManager.default.fileExists(atPath: path))
        let written = SickNoteMediaKey.parse(try Data(contentsOf: URL(fileURLWithPath: path)))
        XCTAssertEqual(written, recovered)

        // A key file already exists (seed a DIFFERENT key): writeIfAbsent must be a no-op,
        // i.e. must NOT overwrite the existing key with the new one.
        let other = SickNoteMediaKey.generate(now: Date())
        XCTAssertNotEqual(other, recovered, "sanity: the two generated keys must differ")
        try store.writeIfAbsent(other, dataDir: dir)
        let stillOnDisk = SickNoteMediaKey.parse(try Data(contentsOf: URL(fileURLWithPath: path)))
        XCTAssertEqual(stillOnDisk, recovered, "writeIfAbsent must not overwrite an existing key file")
        XCTAssertNotEqual(stillOnDisk, other)
    }
}
