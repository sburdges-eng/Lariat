import XCTest
@testable import LariatModel

/// Phase C3 — pins the canonical `actor_source` taxonomy. The exact set is
/// mirrored by `scripts/phase-c-reconcile.mjs :: CANONICAL_ACTOR_SOURCES`
/// (the C4 checker); if this list changes, that constant must change too.
final class ActorSourceTests: XCTestCase {

    /// The frozen canonical set (17 web surfaces + 2 native writers = 19).
    private let expected: Set<String> = [
        "api", "beo_client_share", "box_office", "cook_ui", "dice_ingest",
        "kds_app", "kds_login", "kitchen_assistant", "kitchen_assistant_undo",
        "management_ui", "manager_pin", "manager_ui", "pic_ui", "prism_backfill",
        "receiving_closed_loop", "receiving_match_resolution", "sales_depletion",
        "native_cook", "native_mac",
    ]

    func testCanonicalSetMatchesTheFrozenList() {
        XCTAssertEqual(ActorSource.canonicalRawValues, expected)
        XCTAssertEqual(ActorSource.allCases.count, expected.count)
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
