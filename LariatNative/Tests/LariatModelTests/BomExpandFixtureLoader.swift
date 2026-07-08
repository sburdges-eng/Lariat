// BomExpandFixtureLoader — decodes the golden BomExpand parity fixtures under
// Tests/Fixtures/BomExpand/*.json (the Python->Swift oracle) and exposes them
// as typed values for BomExpandComputeTests.
//
// Fixtures are located relative to this source file (#filePath) rather than via
// Bundle.module, because LariatModelTests declares no bundled resources and the
// fixtures live in the shared Tests/Fixtures/ directory.

import Foundation
import XCTest
@testable import LariatModel

/// A `[name, unit, value]` triple as stored in `leaves`/`nodes` arrays.
struct FixtureTriple: Decodable {
    let name: String
    let unit: String
    let value: Double

    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        name = try c.decode(String.self)
        unit = try c.decode(String.self)
        value = try c.decode(Double.self)
    }
}

/// A `[slug, qty, unit]` demand triple.
struct FixtureDemand: Decodable {
    let slug: String
    let qty: Double
    let unit: String

    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        slug = try c.decode(String.self)
        qty = try c.decode(Double.self)
        unit = try c.decode(String.self)
    }

    var tuple: (String, Double, String) { (slug, qty, unit) }
}

struct FixtureManifestWarning: Decodable {
    let recipe: String
    let subSlug: String
    let issue: String

    enum CodingKeys: String, CodingKey {
        case recipe
        case subSlug = "sub_slug"
        case issue
    }
}

struct FixtureInput: Decodable {
    let slug: String?
    let qty: Double?
    let unit: String?
    let mode: String
    let collectWarnings: Bool?
    let demands: [FixtureDemand]?

    enum CodingKeys: String, CodingKey {
        case slug, qty, unit, mode, demands
        case collectWarnings = "collect_warnings"
    }
}

struct FixtureExpect: Decodable {
    let leaves: [FixtureTriple]?
    let nodes: [FixtureTriple]?
    let tolerancePlaces: Int?
    let error: String?
    let messageContains: [String]?
    let sampleMessage: String?
    let warningStrings: [String]?
    let warningObjects: [FixtureManifestWarning]?
    let warningCount: Int?
    let warningContains: [String]?
    let warningPairs: [[String]]?

    enum CodingKeys: String, CodingKey {
        case leaves, nodes, error, warnings
        case tolerancePlaces = "tolerance_places"
        case messageContains = "message_contains"
        case sampleMessage = "sample_message"
        case warningCount = "warning_count"
        case warningContains = "warning_contains"
        case warningPairs = "warning_pairs"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        leaves = try c.decodeIfPresent([FixtureTriple].self, forKey: .leaves)
        nodes = try c.decodeIfPresent([FixtureTriple].self, forKey: .nodes)
        tolerancePlaces = try c.decodeIfPresent(Int.self, forKey: .tolerancePlaces)
        error = try c.decodeIfPresent(String.self, forKey: .error)
        messageContains = try c.decodeIfPresent([String].self, forKey: .messageContains)
        sampleMessage = try c.decodeIfPresent(String.self, forKey: .sampleMessage)
        warningCount = try c.decodeIfPresent(Int.self, forKey: .warningCount)
        warningContains = try c.decodeIfPresent([String].self, forKey: .warningContains)
        warningPairs = try c.decodeIfPresent([[String]].self, forKey: .warningPairs)
        // `warnings` is polymorphic: [String] for graceful-skip fixtures, or
        // [{recipe, sub_slug, issue}] for find_manifest_warnings fixtures.
        if let strings = (try? c.decodeIfPresent([String].self, forKey: .warnings)) ?? nil {
            warningStrings = strings
            warningObjects = nil
        } else if let objects = (try? c.decodeIfPresent([FixtureManifestWarning].self, forKey: .warnings)) ?? nil {
            warningStrings = nil
            warningObjects = objects
        } else {
            warningStrings = nil
            warningObjects = nil
        }
    }
}

struct BomExpandFixture: Decodable {
    let schemaVersion: Int
    let id: String
    let sourceTest: String
    let manifest: [String: RecipeManifest]
    let input: FixtureInput
    let expect: FixtureExpect

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case id
        case sourceTest = "source_test"
        case manifest, input, expect
    }
}

enum BomExpandFixtures {
    /// Directory holding the golden fixtures, resolved from this file's path.
    static var directory: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // Tests/LariatModelTests
            .deletingLastPathComponent()   // Tests
            .appendingPathComponent("Fixtures")
            .appendingPathComponent("BomExpand")
    }

    static func load(_ id: String) throws -> BomExpandFixture {
        let url = directory.appendingPathComponent("\(id).json")
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(BomExpandFixture.self, from: data)
    }
}
