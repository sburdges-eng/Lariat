import XCTest
@testable import LariatModel

final class SickNoteDocumentComputeTests: XCTestCase {

    func testAllowlistAcceptsApprovedTypes() {
        for name in ["note.pdf", "SCAN.PDF", "photo.jpg", "photo.jpeg", "img.png", "iphone.heic"] {
            XCTAssertTrue(SickNoteDocumentCompute.validate(filename: name), "should accept \(name)")
        }
    }

    func testAllowlistRejectsOtherTypes() {
        for name in ["note.docx", "sheet.xlsx", "malware.exe", "noext", "archive.zip", "trailingdot.", "pdf"] {
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
