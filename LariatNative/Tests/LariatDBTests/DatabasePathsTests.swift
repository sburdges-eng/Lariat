import XCTest
@testable import LariatDB

final class DatabasePathsTests: XCTestCase {
    func testHonorsEnvAbsolute() {
        let p = resolveDatabasePath(env: ["LARIAT_DATA_DIR": "/srv/lariat"], cwd: "/work")
        XCTAssertEqual(p, "/srv/lariat/lariat.db")
    }
    func testEnvRelativeResolvesAgainstCwd() {
        let p = resolveDatabasePath(env: ["LARIAT_DATA_DIR": "var/db"], cwd: "/work")
        XCTAssertEqual(p, "/work/var/db/lariat.db")
    }
    func testDefaultsToCwdData() {
        let p = resolveDatabasePath(env: [:], cwd: "/work")
        XCTAssertEqual(p, "/work/data/lariat.db")
    }
    func testWhitespaceOnlyEnvFallsBackToDefault() {
        let p = resolveDatabasePath(env: ["LARIAT_DATA_DIR": "   "], cwd: "/work")
        XCTAssertEqual(p, "/work/data/lariat.db")
    }
}
