import XCTest
@testable import LariatModel

/// Phase C3 — pins the canonical `actor_source` taxonomy to the shared,
/// language-neutral fixture `tests/fixtures/actor_source_canonical.json`, the
/// single source of truth. The web reconciler constant
/// (`scripts/phase-c-reconcile.mjs :: CANONICAL_ACTOR_SOURCES`, the C4 checker)
/// is pinned to the same fixture by `tests/js/test-actor-source-parity.mjs`, so
/// the native enum and the web set cannot drift apart without the fixture — and
/// therefore both gates — changing in lockstep. To add a value: update the
/// fixture, this enum, and the web constant together.
final class ActorSourceTests: XCTestCase {

    private struct CanonicalFixture: Decodable { let values: [String] }

    /// Load the shared cross-language SSOT (17 web surfaces + 2 native = 19).
    private func loadCanonicalSet() throws -> Set<String> {
        // <root>/LariatNative/Tests/LariatModelTests/<thisfile> → up 4 → <root>
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { url.deleteLastPathComponent() }
        url.appendPathComponent("tests/fixtures/actor_source_canonical.json")
        let data = try Data(contentsOf: url)
        return Set(try JSONDecoder().decode(CanonicalFixture.self, from: data).values)
    }

    func testCanonicalSetMatchesSharedFixture() throws {
        let fixture = try loadCanonicalSet()
        XCTAssertEqual(
            ActorSource.canonicalRawValues, fixture,
            "ActorSource enum drifted from tests/fixtures/actor_source_canonical.json"
        )
        XCTAssertEqual(ActorSource.allCases.count, fixture.count)
    }

    func testNativeWriterLiteralsAreMembers() {
        // The values RegulatedWriteContext already writes must be canonical.
        XCTAssertTrue(ActorSource.isCanonical(RegulatedWriteContext.nativeMacActorSource))
        XCTAssertTrue(ActorSource.isCanonical(RegulatedWriteContext.nativeCookActorSource))
        XCTAssertEqual(ActorSource.nativeMac.rawValue, RegulatedWriteContext.nativeMacActorSource)
        XCTAssertEqual(ActorSource.nativeCook.rawValue, RegulatedWriteContext.nativeCookActorSource)
    }

    func testIsCanonicalRejectsUnknownAndDocCommentOnlyValues() {
        XCTAssertFalse(ActorSource.isCanonical("export"))   // doc-comment only, never written
        XCTAssertFalse(ActorSource.isCanonical(""))
        XCTAssertFalse(ActorSource.isCanonical("web_ui"))
    }

    func testRawValuesRoundTrip() {
        for source in ActorSource.allCases {
            XCTAssertEqual(ActorSource(rawValue: source.rawValue), source)
        }
    }
}
