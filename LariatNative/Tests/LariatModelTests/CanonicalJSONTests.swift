import XCTest
@testable import LariatModel

/// Mirrors tests/js/test-cloud-bridge-canonical.mjs — the Swift canonical
/// serializer must produce the same bytes as lib/cloudBridgeCanonical.ts.
final class CanonicalJSONTests: XCTestCase {
    func testSortsKeysRecursivelyNoWhitespace() throws {
        let v: JSONValue = .object(["b": .int(1), "a": .object(["d": .int(4), "c": .int(3)])])
        XCTAssertEqual(try CanonicalJSON.encode(v), #"{"a":{"c":3,"d":4},"b":1}"#)
    }
    func testDoesNotEscapeForwardSlash() throws {
        XCTAssertEqual(try CanonicalJSON.encode(.object(["p": .string("a/b")])), #"{"p":"a/b"}"#)
    }
    func testArrayOrderPreservedKeysSorted() throws {
        let v: JSONValue = .object(["rows": .array([.object(["y": .int(2), "x": .int(1)])])])
        XCTAssertEqual(try CanonicalJSON.encode(v), #"{"rows":[{"x":1,"y":2}]}"#)
    }
    func testDecodingNonIntegerNumberThrows() {
        XCTAssertThrowsError(try JSONDecoder().decode(JSONValue.self, from: Data("1.5".utf8)))
    }
    func testEscapesControlCharactersAndQuotes() throws {
        XCTAssertEqual(try CanonicalJSON.encode(.string("a\"\n")), #""a\"\n""#)
    }
    func testThrowsOnIntegerLikeObjectKey() {
        // JS reorders numeric-string keys numerically; the TS twin throws, so must this.
        let v: JSONValue = .object(["10": .int(1), "9": .int(2)])
        XCTAssertThrowsError(try CanonicalJSON.encode(v))
    }
}
