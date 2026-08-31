import XCTest
@testable import LariatDB

final class DataDirectoryTests: XCTestCase {
    func testAbsoluteDataDir() {
        XCTAssertEqual(resolveDataDirectory(env: ["LARIAT_DATA_DIR": "/srv/lariat"], cwd: "/work"), "/srv/lariat")
    }

    func testRelativeDataDir() {
        XCTAssertEqual(resolveDataDirectory(env: ["LARIAT_DATA_DIR": "var/db"], cwd: "/work"), "/work/var/db")
    }

    func testAuditOverride() {
        XCTAssertEqual(resolveManagementAuditPath(env: ["LARIAT_AUDIT_PATH": "/tmp/audit.jsonl"], cwd: "/work"), "/tmp/audit.jsonl")
    }

    func testDefaultAuditPath() {
        let p = resolveManagementAuditPath(env: [:], cwd: "/work")
        XCTAssertTrue(p.hasSuffix("data/audit/management-actions.jsonl"))
    }

    func testWalksUpToRepoDataWhenScriptsMarkerPresent() {
        let dir = resolveDataDirectory(
            env: [:],
            cwd: "/repo/LariatNative",
            fileExists: { $0 == "/repo/scripts/beo_cascade_cli.py" }
        )
        XCTAssertEqual(dir, "/repo/data")
    }

    func testFallsBackToApplicationSupportWhenPackaged() {
        let dir = resolveDataDirectory(
            env: ["HOME": "/Users/chef"],
            cwd: "/",
            fileExists: { path in
                path == "/Users/chef/Library/Application Support/Lariat/data/lariat.db"
            }
        )
        XCTAssertEqual(dir, "/Users/chef/Library/Application Support/Lariat/data")
    }

    /// H8 first-run: a Finder launch (cwd "/") on a machine with NOTHING —
    /// no dev repo, no Application Support tree, no /data — must still land
    /// on the packaged Application Support default so FirstRunBootstrap can
    /// create it, not on an unwritable "/data".
    func testPrefersApplicationSupportWhenNothingExists() {
        let dir = resolveDataDirectory(
            env: ["HOME": "/Users/chef"],
            cwd: "/",
            fileExists: { _ in false }
        )
        XCTAssertEqual(dir, "/Users/chef/Library/Application Support/Lariat/data")
    }

    /// A shell launch from a directory that has its own data/ keeps using it —
    /// the first-run fallback must not steal existing local-dir setups.
    func testKeepsCwdDataWhenItExists() {
        let dir = resolveDataDirectory(
            env: ["HOME": "/Users/chef"],
            cwd: "/work",
            fileExists: { $0 == "/work/data" }
        )
        XCTAssertEqual(dir, "/work/data")
    }
}
