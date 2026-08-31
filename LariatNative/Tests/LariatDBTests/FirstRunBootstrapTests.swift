import XCTest
import GRDB
@testable import LariatDB

final class FirstRunBootstrapTests: XCTestCase {
    private var tmpHome: String!

    override func setUpWithError() throws {
        tmpHome = NSTemporaryDirectory() + "first-run-\(UUID().uuidString)"
        try FileManager.default.createDirectory(atPath: tmpHome, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(atPath: tmpHome)
    }

    private var supportDataDir: String {
        tmpHome + "/Library/Application Support/Lariat/data"
    }

    func testSeedsFreshDatabaseAtPackagedDefault() throws {
        let outcome = try FirstRunBootstrap.ensureDatabase(
            dataDir: supportDataDir, env: ["HOME": tmpHome])
        XCTAssertEqual(outcome, .seeded)

        let dbPath = supportDataDir + "/lariat.db"
        XCTAssertTrue(FileManager.default.fileExists(atPath: dbPath))

        let pool = try DatabasePool(path: dbPath)
        try pool.read { db in
            XCTAssertEqual(try SchemaMigrator.currentVersion(db), SchemaMigrator.expectedVersion)
            XCTAssertEqual(try SchemaMigrator.webSchemaMigrationsVersion(db), SchemaMigrator.webSchemaVersion)
            // The gate table a manager PIN preflight reads must exist and be empty.
            XCTAssertTrue(try db.tableExists("manager_pin_users"))
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM manager_pin_users"), 0)
            // The default location seed row rode in with the frozen schema.
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM locations"), 1)
        }
    }

    func testSecondCallIsNoOp() throws {
        _ = try FirstRunBootstrap.ensureDatabase(dataDir: supportDataDir, env: ["HOME": tmpHome])
        let again = try FirstRunBootstrap.ensureDatabase(dataDir: supportDataDir, env: ["HOME": tmpHome])
        XCTAssertEqual(again, .existingDatabase)
    }

    func testRefusesNonDefaultDirectory() throws {
        let elsewhere = tmpHome + "/somewhere/else"
        let outcome = try FirstRunBootstrap.ensureDatabase(
            dataDir: elsewhere, env: ["HOME": tmpHome])
        XCTAssertEqual(outcome, .notEligible)
        XCTAssertFalse(FileManager.default.fileExists(atPath: elsewhere + "/lariat.db"))
        // The fail-loud LariatWriteDatabase refusal is preserved for this path.
        XCTAssertThrowsError(try LariatWriteDatabase(path: elsewhere + "/lariat.db"))
    }

    func testExistingDatabaseIsNeverTouched() throws {
        // Simulate a web-owned DB already in place: seed once, note its bytes.
        _ = try FirstRunBootstrap.ensureDatabase(dataDir: supportDataDir, env: ["HOME": tmpHome])
        let dbPath = supportDataDir + "/lariat.db"
        let before = try FileManager.default.attributesOfItem(atPath: dbPath)[.modificationDate] as? Date
        let outcome = try FirstRunBootstrap.ensureDatabase(dataDir: supportDataDir, env: ["HOME": tmpHome])
        let after = try FileManager.default.attributesOfItem(atPath: dbPath)[.modificationDate] as? Date
        XCTAssertEqual(outcome, .existingDatabase)
        XCTAssertEqual(before, after)
    }
}
