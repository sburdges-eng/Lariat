import XCTest
@testable import LariatModel

final class LocationScopeTests: XCTestCase {
    func testDefault() {
        XCTAssertEqual(LocationScope.resolve(env: [:]), "default")
    }

    func testFromEnv() {
        XCTAssertEqual(LocationScope.resolve(env: ["LARIAT_LOCATION_ID": "venue-2"]), "venue-2")
    }
}
