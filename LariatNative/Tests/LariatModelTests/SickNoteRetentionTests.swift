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
