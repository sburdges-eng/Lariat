import XCTest
@testable import LariatModel

final class UnitConvertTests: XCTestCase {
    func testNormalizeSynonyms() {
        XCTAssertEqual(UnitConvert.normalizeUnit("Pounds"), "lb")
        XCTAssertEqual(UnitConvert.normalizeUnit(" TSP "), "tsp")
        XCTAssertEqual(UnitConvert.normalizeUnit("fl oz"), "floz")
        XCTAssertEqual(UnitConvert.normalizeUnit(nil), "")
        XCTAssertEqual(UnitConvert.normalizeUnit("cups"), "cup")
        XCTAssertEqual(UnitConvert.normalizeUnit("c"), "cup")
        XCTAssertEqual(UnitConvert.normalizeUnit("#"), "lb")
    }
    func testUnitDimension() {
        XCTAssertEqual(UnitConvert.unitDimension("oz"), "weight")
        XCTAssertEqual(UnitConvert.unitDimension("cup"), "volume")
        XCTAssertEqual(UnitConvert.unitDimension("ea"), "count")
        XCTAssertNil(UnitConvert.unitDimension("furlong"))
    }
    func testConvertIdentity() {
        XCTAssertEqual(UnitConvert.convertQty(5, from: "ea", to: "each", gPerMl: nil), 5)
        XCTAssertEqual(UnitConvert.convertQty(0, from: "cup", to: "cup", gPerMl: nil), 0)
    }
    func testConvertSameDimVolume() {
        // 1 tsp → cup: tsp=4.92892159 ml, cup=236.5882365 ml → 0.0208333...
        let r = UnitConvert.convertQty(1, from: "tsp", to: "cup", gPerMl: nil)
        XCTAssertNotNil(r)
        XCTAssertEqual(r!, 4.92892159 / 236.5882365, accuracy: 1e-12)
    }
    func testConvertCrossDimWithoutDensityIsNil() {
        XCTAssertNil(UnitConvert.convertQty(1, from: "oz", to: "cup", gPerMl: nil))
    }
    func testConvertCountRefusesBeyondIdentity() {
        XCTAssertNil(UnitConvert.convertQty(1, from: "ea", to: "oz", gPerMl: nil))
    }
    func testConvertUnknownUnitIsNil() {
        XCTAssertNil(UnitConvert.convertQty(1, from: "furlong", to: "oz", gPerMl: nil))
    }
    func testNonFiniteIsNil() {
        XCTAssertNil(UnitConvert.convertQty(.nan, from: "oz", to: "g", gPerMl: nil))
    }

    // MARK: - Shared Python↔JS parity fixture
    //
    // `tests/fixtures/unit_convert_parity.json` is the Python-authoritative
    // oracle that lib/unitConvert.mjs is already pinned to (tests/js/
    // test-unit-convert-parity.mjs). UnitConvert.swift claims to mirror that JS
    // costing converter, so it must reproduce every row — a divergence here
    // skews costing/variance numbers both apps read from the shared DB. (This is
    // the COSTING converter, ml/g base; distinct from BomExpandCompute.convertQty,
    // whose coarser qt/lb tables intentionally differ — see
    // docs/superpowers/specs/2026-07-07-bom-unit-table-diff.md.)

    private struct ParityRow: Decodable {
        let qty: Double
        let fromUnit: String?  // JSON null → a null-unit rejection case
        let toUnit: String?
        let gPerMl: Double?
        let expected: Double?  // JSON null → convertQty must return nil

        enum CodingKeys: String, CodingKey {
            case qty, expected
            case fromUnit = "from_unit"
            case toUnit = "to_unit"
            case gPerMl = "g_per_ml"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            if let n = try? c.decode(Double.self, forKey: .qty) {
                qty = n
            } else {
                // Non-finite qty is serialized as a sentinel string.
                switch try c.decode(String.self, forKey: .qty) {
                case "nan": qty = .nan
                case "inf": qty = .infinity
                case "-inf": qty = -.infinity
                case let other:
                    throw DecodingError.dataCorruptedError(
                        forKey: .qty, in: c, debugDescription: "bad qty sentinel: \(other)")
                }
            }
            fromUnit = try c.decodeIfPresent(String.self, forKey: .fromUnit)
            toUnit = try c.decodeIfPresent(String.self, forKey: .toUnit)
            gPerMl = try c.decodeIfPresent(Double.self, forKey: .gPerMl)
            expected = try c.decodeIfPresent(Double.self, forKey: .expected)
        }
    }

    private func loadParityRows() throws -> [ParityRow] {
        // <root>/LariatNative/Tests/LariatModelTests/<thisfile> → up 4 → <root>
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { url.deleteLastPathComponent() }
        url.appendPathComponent("tests/fixtures/unit_convert_parity.json")
        return try JSONDecoder().decode([ParityRow].self, from: Data(contentsOf: url))
    }

    func testMatchesSharedPythonJsParityFixture() throws {
        let rows = try loadParityRows()
        XCTAssertGreaterThanOrEqual(rows.count, 40, "fixture should carry the full parity set")
        for (i, row) in rows.enumerated() {
            let actual = UnitConvert.convertQty(
                row.qty, from: row.fromUnit, to: row.toUnit, gPerMl: row.gPerMl)
            let label = "row \(i): convertQty(\(row.qty), \(row.fromUnit ?? "nil")→\(row.toUnit ?? "nil"), "
                + "gPerMl=\(String(describing: row.gPerMl)))"
            guard let expected = row.expected else {
                XCTAssertNil(actual, "\(label) should reject (nil), got \(String(describing: actual))")
                continue
            }
            guard let actual else {
                XCTFail("\(label) expected \(expected), got nil")
                continue
            }
            if expected == 0 {
                XCTAssertEqual(actual, 0, "\(label) expected exact 0, got \(actual)")
            } else {
                let scale = Swift.max(1, abs(expected))
                XCTAssertLessThan(
                    abs(actual - expected) / scale, 1e-12,
                    "\(label) expected \(expected), got \(actual)")
            }
        }
    }
}
