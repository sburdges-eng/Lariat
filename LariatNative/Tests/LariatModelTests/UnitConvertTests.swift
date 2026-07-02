import XCTest
@testable import LariatModel

final class UnitConvertTests: XCTestCase {
    func testNormalizeSynonyms() {
        XCTAssertEqual(UnitConvert.normalizeUnit("Pounds"), "lb")
        XCTAssertEqual(UnitConvert.normalizeUnit(" TSP "), "tsp")
        XCTAssertEqual(UnitConvert.normalizeUnit("fl oz"), "floz")
        XCTAssertEqual(UnitConvert.normalizeUnit(nil), "")
        XCTAssertEqual(UnitConvert.normalizeUnit("cups"), "cup")
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
}
