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
