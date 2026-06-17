import XCTest
@testable import LariatModel

final class StaffCatalogTests: XCTestCase {
    func testFiltersInactiveAndJunkStaff() throws {
        let dir = NSTemporaryDirectory() + "staff-fixture-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let cache = (dir as NSString).appendingPathComponent("cache")
        try FileManager.default.createDirectory(atPath: cache, withIntermediateDirectories: true)
        let json = """
        [
          {"id":"tyler_chambers","first":"Tyler","last":"Chambers","active":true},
          {"id":"non_usable_employee","first":"Bad","last":"Row","active":true},
          {"id":"ghost","first":"Ghost","last":"Cook","active":false}
        ]
        """
        try json.write(toFile: (cache as NSString).appendingPathComponent("staff.json"), atomically: true, encoding: .utf8)

        let rows = try StaffCatalog.load(env: ["LARIAT_DATA_DIR": dir], cwd: dir)
        XCTAssertEqual(rows.map(\.id), ["tyler_chambers"])
        XCTAssertEqual(rows.first?.displayName, "Tyler Chambers")
    }
}
