import XCTest
@testable import LariatModel

final class SickNoteMediaKeyTests: XCTestCase {
    func testGenerateRoundTripsThroughJSON() throws {
        let key = SickNoteMediaKey.generate(now: Date(timeIntervalSince1970: 1_700_000_000))
        XCTAssertEqual(key.v, 1)
        XCTAssertEqual(key.keyIdData?.count, 16)
        XCTAssertNotNil(key.symmetricKey)
        let json = try JSONEncoder().encode(key)
        XCTAssertTrue(String(data: json, encoding: .utf8)!.contains("\"key_id\""))
        XCTAssertEqual(SickNoteMediaKey.parse(json), key)
    }

    func testParseFailsClosed() {
        XCTAssertNil(SickNoteMediaKey.parse(Data("not json".utf8)))
        // unsupported version
        XCTAssertNil(SickNoteMediaKey.parse(Data(#"{"v":2,"key_id":"404142434445464748494a4b4c4d4e4f","key":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=","created_at":"x"}"#.utf8)))
        // bad hex key_id and wrong-length key both reject
        XCTAssertNil(SickNoteMediaKey.parse(Data(#"{"v":1,"key_id":"zz","key":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=","created_at":"x"}"#.utf8)))
        XCTAssertNil(SickNoteMediaKey.parse(Data(#"{"v":1,"key_id":"404142434445464748494a4b4c4d4e4f","key":"AAA=","created_at":"x"}"#.utf8)))
        // +-prefixed pairs are non-hex and must reject: UInt8(_:radix:) accepts a leading '+'
        XCTAssertNil(SickNoteMediaKey.parse(Data(#"{"v":1,"key_id":"+0+1+2+3+4+5+6+7+8+9+a+b+c+d+e+f","key":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=","created_at":"x"}"#.utf8)))
    }
}
