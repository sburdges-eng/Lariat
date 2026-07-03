import XCTest
@testable import LariatModel

/// Audit fix (shell F4): `StationCatalog.load()` used to fail with an opaque
/// Foundation/DecodingError that `try?` in the shell swallowed entirely, so a
/// single broken cache file silently nilled the whole catalog and the 86 /
/// Stations boards blamed the write database. These tests pin the new
/// `StationCatalogError` contract: the error names the exact file at fault and
/// carries an actionable reason.
final class StationCatalogLoadTests: XCTestCase {
    private var dir = ""
    private var cache = ""

    override func setUpWithError() throws {
        dir = NSTemporaryDirectory() + "station-catalog-fixture-" + UUID().uuidString
        cache = (dir as NSString).appendingPathComponent("cache")
        try FileManager.default.createDirectory(atPath: cache, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(atPath: dir)
    }

    private func write(_ name: String, _ json: String) throws {
        try json.write(
            toFile: (cache as NSString).appendingPathComponent(name),
            atomically: true,
            encoding: .utf8
        )
    }

    private func writeValidFixtures() throws {
        try write("stations.json", """
        [{"id":"grill","name":"Grill","line":"hot","line_check_key":"grill"}]
        """)
        try write("line_checks.json", """
        {"grill":["Check flat-top temp"]}
        """)
        try write("recipes.json", """
        [{"slug":"brisket","name":"Brisket","sub_recipes":["rub"]}]
        """)
    }

    func testLoadsValidCatalog() throws {
        try writeValidFixtures()
        let catalog = try StationCatalog.load(env: ["LARIAT_DATA_DIR": dir], cwd: dir)
        XCTAssertEqual(catalog.stations.map(\.id), ["grill"])
        XCTAssertEqual(catalog.lineCheckTemplates["grill"], ["Check flat-top temp"])
        XCTAssertEqual(catalog.recipes.map(\.slug), ["brisket"])
    }

    func testMissingFileNamesTheFile() throws {
        try writeValidFixtures()
        try FileManager.default.removeItem(
            atPath: (cache as NSString).appendingPathComponent("stations.json")
        )
        XCTAssertThrowsError(
            try StationCatalog.load(env: ["LARIAT_DATA_DIR": dir], cwd: dir)
        ) { error in
            guard let catalogError = error as? StationCatalogError else {
                return XCTFail("expected StationCatalogError, got \(error)")
            }
            XCTAssertEqual(catalogError.file, "stations.json")
            guard case .unreadable = catalogError else {
                return XCTFail("expected .unreadable, got \(catalogError)")
            }
            XCTAssertTrue(
                catalogError.localizedDescription.contains("stations.json"),
                "message must name the file: \(catalogError.localizedDescription)"
            )
        }
    }

    func testMalformedRecipesNamesTheFileAndReason() throws {
        try writeValidFixtures()
        try write("recipes.json", "{ not json ]")
        XCTAssertThrowsError(
            try StationCatalog.load(env: ["LARIAT_DATA_DIR": dir], cwd: dir)
        ) { error in
            guard let catalogError = error as? StationCatalogError else {
                return XCTFail("expected StationCatalogError, got \(error)")
            }
            XCTAssertEqual(catalogError.file, "recipes.json")
            guard case .undecodable = catalogError else {
                return XCTFail("expected .undecodable, got \(catalogError)")
            }
            XCTAssertTrue(
                catalogError.localizedDescription.contains("recipes.json"),
                "message must name the file: \(catalogError.localizedDescription)"
            )
        }
    }

    func testWrongShapeNamesTheFile() throws {
        try writeValidFixtures()
        // Valid JSON, wrong shape: line_checks must be {key: [items]}.
        try write("line_checks.json", """
        {"grill": "not-an-array"}
        """)
        XCTAssertThrowsError(
            try StationCatalog.load(env: ["LARIAT_DATA_DIR": dir], cwd: dir)
        ) { error in
            guard let catalogError = error as? StationCatalogError,
                  case .undecodable = catalogError else {
                return XCTFail("expected .undecodable StationCatalogError, got \(error)")
            }
            XCTAssertEqual(catalogError.file, "line_checks.json")
        }
    }
}
