import XCTest
@testable import LariatModel

final class SickNoteDocumentComputeTests: XCTestCase {

    func testAllowlistAcceptsApprovedTypes() {
        for name in ["note.pdf", "SCAN.PDF", "photo.jpg", "photo.jpeg", "img.png", "iphone.heic"] {
            XCTAssertTrue(SickNoteDocumentCompute.validate(filename: name), "should accept \(name)")
        }
    }

    /// `.jpe` conforms to `public.jpeg`, so the NSOpenPanel offers it — the
    /// validator must accept it too or the panel presents an unattachable file.
    func testAllowlistAcceptsJpeVariant() {
        XCTAssertTrue(SickNoteDocumentCompute.validate(filename: "scan.jpe"))
        XCTAssertTrue(SickNoteDocumentCompute.validate(filename: "SCAN.JPE"))
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

    // ── Upload-path containment (defense-in-depth vs a tampered DB row) ──

    func testSafeUploadRelativePathAcceptsNormalStoredPath() {
        XCTAssertEqual(
            SickNoteDocumentCompute.safeUploadRelativePath("sick-notes/42/abc.pdf"),
            "sick-notes/42/abc.pdf"
        )
    }

    func testSafeUploadRelativePathNormalizesInteriorDots() {
        XCTAssertEqual(
            SickNoteDocumentCompute.safeUploadRelativePath("sick-notes/42/./abc.pdf"),
            "sick-notes/42/abc.pdf"
        )
    }

    func testSafeUploadRelativePathRejectsTraversal() {
        for bad in [
            "../../../../etc/passwd",
            "sick-notes/../../secrets.pdf",
            "sick-notes/42/../../../Applications/Evil.app",
            "..",
        ] {
            XCTAssertNil(SickNoteDocumentCompute.safeUploadRelativePath(bad), "should reject \(bad)")
        }
    }

    func testSafeUploadRelativePathRejectsAbsoluteAndEmpty() {
        XCTAssertNil(SickNoteDocumentCompute.safeUploadRelativePath("/etc/passwd"))
        XCTAssertNil(SickNoteDocumentCompute.safeUploadRelativePath(""))
        XCTAssertNil(SickNoteDocumentCompute.safeUploadRelativePath("   "))
    }

    func testSafeUploadRelativePathAllowsInteriorParentThatStaysInRoot() {
        // "a/b/../c" stays within root → normalizes to "a/c".
        XCTAssertEqual(SickNoteDocumentCompute.safeUploadRelativePath("sick-notes/x/../42/abc.pdf"),
                       "sick-notes/42/abc.pdf")
    }
}
