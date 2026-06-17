import XCTest
import GRDB
@testable import LariatModel

final class PinVerifierTests: XCTestCase {
    func testSha256MatchesNode() {
        let hash = PinHash.sha256Hex("1357")
        XCTAssertEqual(hash.count, 64)
    }

    func testFormatRejectsShortPin() {
        XCTAssertNotNil(PinHash.validateFormat("12"))
    }

    func testVerifyManagerUser() throws {
        let dbQueue = try DatabaseQueue()
        try dbQueue.write { db in
            try db.execute(sql: """
              CREATE TABLE manager_pin_users (
                id INTEGER PRIMARY KEY, location_id TEXT, name TEXT, role TEXT,
                pin_hash TEXT, is_active INTEGER, created_at TEXT, updated_at TEXT, disabled_at TEXT);
              INSERT INTO manager_pin_users (id, location_id, name, role, pin_hash, is_active)
                VALUES (1, 'default', 'Pat', 'manager', ?, 1);
            """, arguments: [PinHash.sha256Hex("1357")])
        }
        let user = try dbQueue.read { db in
            try PinVerifier().verify(pin: "1357", db: db, locationId: "default", env: [:])
        }
        XCTAssertEqual(user.name, "Pat")
    }

    func testLariatPinOverride() throws {
        let dbQueue = try DatabaseQueue()
        let user = try dbQueue.read { db in
            try PinVerifier().verify(pin: "9999", db: db, env: ["LARIAT_PIN": "9999"])
        }
        XCTAssertEqual(user.role, "owner")
    }

    func testWrongPinThrows() throws {
        let dbQueue = try DatabaseQueue()
        try dbQueue.write { db in
            try db.execute(sql: """
              CREATE TABLE manager_pin_users (
                id INTEGER PRIMARY KEY, location_id TEXT, name TEXT, role TEXT,
                pin_hash TEXT, is_active INTEGER);
              INSERT INTO manager_pin_users VALUES (1,'default','Pat','manager',?,1);
            """, arguments: [PinHash.sha256Hex("1357")])
        }
        XCTAssertThrowsError(try dbQueue.read { db in
            try PinVerifier().verify(pin: "9999", db: db, env: [:])
        })
    }

    func testGateNotConfigured() throws {
        let dbQueue = try DatabaseQueue()
        let on = try dbQueue.read { db in try PinVerifier().gateConfigured(db: db, env: [:]) }
        XCTAssertFalse(on)
    }
}
