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
        XCTAssertNil(SickNoteContentValidator.sniff(Data())) // zero-length
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
        XCTAssertTrue(SickNoteContentValidator.withinSizeLimit(25 * 1024 * 1024)) // exact boundary passes
        XCTAssertFalse(SickNoteContentValidator.withinSizeLimit(25 * 1024 * 1024 + 1))
    }
}
