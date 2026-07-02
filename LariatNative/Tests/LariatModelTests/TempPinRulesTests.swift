import XCTest
@testable import LariatModel

/// Value-parity port of `tests/js/test-temp-pin-rules.mjs` for the issuance
/// side of `lib/tempPin.ts` (`TempPinRules` + the shared `PinHash`).
final class TempPinRulesTests: XCTestCase {
    // ── hashPin ─────────────────────────────────────────────────────────

    func testHashReturns64CharHex() {
        let h = PinHash.sha256Hex("1234")
        XCTAssertEqual(h.count, 64)
        XCTAssertTrue(h.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil)
    }

    func testHashIsDeterministic() {
        XCTAssertEqual(PinHash.sha256Hex("842715"), PinHash.sha256Hex("842715"))
    }

    func testHashDistinguishesAdjacentPins() {
        XCTAssertNotEqual(PinHash.sha256Hex("1234"), PinHash.sha256Hex("1235"))
    }

    func testHashDoesNotEchoRawPin() {
        XCTAssertFalse(PinHash.sha256Hex("1234").contains("1234"))
    }

    /// Byte-exact parity with Node's `createHash('sha256')` — this constant is
    /// the SHA-256 of '9999' pinned in tests/js/test-temp-pin-routes.mjs, so a
    /// PIN hashed on either side authenticates on the other.
    func testHashMatchesNodeCryptoByteForByte() {
        XCTAssertEqual(
            PinHash.sha256Hex("9999"),
            "888df25ae35772424a560c7152a1de794440e0ea5cfee62828333a456a506e05"
        )
    }

    // ── validatePinFormat ───────────────────────────────────────────────

    func testValidateFormatAcceptsFourAndSixDigits() {
        XCTAssertNil(PinHash.validateFormat("1234"))
        XCTAssertNil(PinHash.validateFormat("123456"))
    }

    func testValidateFormatRejectsTooShortTooLongNonDigit() {
        XCTAssertTrue(PinHash.validateFormat("123")?.lowercased().contains("short") == true)
        XCTAssertTrue(PinHash.validateFormat("1234567")?.lowercased().contains("long") == true)
        XCTAssertTrue(PinHash.validateFormat("12a4")?.lowercased().contains("digits") == true)
    }

    func testPinLengthConstants() {
        XCTAssertEqual(PinHash.minLength, 4)
        XCTAssertEqual(PinHash.maxLength, 6)
    }

    // ── isExpired ───────────────────────────────────────────────────────

    func testIsExpiredFalseForFuture() {
        let future = TempPinRules.canonicalISO(from: Date().addingTimeInterval(60))
        XCTAssertFalse(TempPinRules.isExpired(future))
    }

    func testIsExpiredTrueForPast() {
        let past = TempPinRules.canonicalISO(from: Date().addingTimeInterval(-60))
        XCTAssertTrue(TempPinRules.isExpired(past))
    }

    func testIsExpiredTrueOnEqualBoundary() {
        // Any non-future moment is expired (expired-on-equal).
        let t = "2026-05-04T19:00:00.000Z"
        let exact = AuditLogCompute.parseTimestamp(t)!
        XCTAssertTrue(TempPinRules.isExpired(t, now: exact))
    }

    func testIsExpiredAcceptsExplicitNowDeterministically() {
        let t = "2026-05-04T19:00:00.000Z"
        let before = AuditLogCompute.parseTimestamp("2026-05-04T18:59:59.999Z")!
        let after = AuditLogCompute.parseTimestamp("2026-05-04T19:00:00.001Z")!
        XCTAssertFalse(TempPinRules.isExpired(t, now: before))
        XCTAssertTrue(TempPinRules.isExpired(t, now: after))
    }

    func testIsExpiredFailClosedOnMalformedValue() {
        XCTAssertTrue(TempPinRules.isExpired("not a date"))
        XCTAssertTrue(TempPinRules.isExpired(""))
    }

    // ── parseScopes / serializeScopes / hasScope ────────────────────────

    func testParseScopesParsesJSONArray() {
        XCTAssertEqual(TempPinVerifier.parseScopes(#"["beo.fire_at_edit"]"#), ["beo.fire_at_edit"])
    }

    func testParseScopesFailClosedOnNilEmptyMalformed() {
        XCTAssertEqual(TempPinVerifier.parseScopes(nil), [])
        XCTAssertEqual(TempPinVerifier.parseScopes(""), [])
        XCTAssertEqual(TempPinVerifier.parseScopes("not json"), [])
        XCTAssertEqual(TempPinVerifier.parseScopes("{}"), [])
    }

    func testParseScopesDropsNonStringEntries() {
        XCTAssertEqual(
            TempPinVerifier.parseScopes(#"["beo.fire_at_edit", 42, null]"#),
            ["beo.fire_at_edit"]
        )
    }

    func testSerializeScopesRoundTrips() throws {
        let original = ["beo.fire_at_edit"]
        XCTAssertEqual(TempPinVerifier.parseScopes(try TempPinRules.serializeScopes(original)), original)
        XCTAssertEqual(TempPinVerifier.parseScopes(try TempPinRules.serializeScopes([])), [])
    }

    func testSerializeScopesRejectsUnknownScope() {
        XCTAssertThrowsError(try TempPinRules.serializeScopes(["not.a.real.scope"])) { error in
            guard case TempPinWriteError.validation(let msg) = error else {
                return XCTFail("expected validation error")
            }
            XCTAssertTrue(msg.lowercased().contains("unknown scope"))
        }
    }

    func testHasScope() {
        XCTAssertTrue(TempPinVerifier.hasScope(["beo.fire_at_edit"], "beo.fire_at_edit"))
        XCTAssertFalse(TempPinVerifier.hasScope(["beo.fire_at_edit"], "kds.bump"))
        XCTAssertFalse(TempPinVerifier.hasScope([], "beo.fire_at_edit"))
    }

    // ── KNOWN_SCOPES ────────────────────────────────────────────────────

    /// EXACT list parity with `lib/tempPin.ts` KNOWN_SCOPES — order included.
    /// If the web adds a scope, this must be updated in lockstep.
    func testKnownScopesMatchesWebListExactly() {
        XCTAssertEqual(TempPinRules.knownScopes, [
            "beo.fire_at_edit",
            "event.box_office",
            "event.sound_config",
            "event.stage_setup",
            "haccp.back_date",
            "menu.prep_history",
            "menu.specials_edit",
            "pic.sick_worker",
            "pic.staff_certs",
        ])
        XCTAssertTrue(TempPinRules.isKnownScope("beo.fire_at_edit"))
        XCTAssertFalse(TempPinRules.isKnownScope("not.real"))
    }

    // ── isCanonicalIso (issue-route guard) ──────────────────────────────

    func testCanonicalISOAcceptsToISOStringForm() {
        XCTAssertTrue(TempPinRules.isCanonicalISO("2026-07-02T10:00:00.000Z"))
        let roundTrip = TempPinRules.canonicalISO(from: Date())
        XCTAssertTrue(TempPinRules.isCanonicalISO(roundTrip))
    }

    func testCanonicalISORejectsNonCanonicalForms() {
        XCTAssertFalse(TempPinRules.isCanonicalISO("2026-07-02T10:00:00Z"))       // no millis
        XCTAssertFalse(TempPinRules.isCanonicalISO("2026-07-02 10:00:00"))        // space form
        XCTAssertFalse(TempPinRules.isCanonicalISO("2026-07-02"))                 // date only
        XCTAssertFalse(TempPinRules.isCanonicalISO("garbage"))
        XCTAssertFalse(TempPinRules.isCanonicalISO(""))
    }
}
