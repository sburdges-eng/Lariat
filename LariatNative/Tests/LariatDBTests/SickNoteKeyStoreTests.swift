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
