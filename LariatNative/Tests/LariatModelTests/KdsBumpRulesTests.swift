import XCTest
@testable import LariatModel

/// Pure-rule parity port of `tests/js/test-kds-rules.mjs`.
///
/// Type-rejection cases from the oracle (`isStationSlug(42)`, `isStationSlug({})`,
/// `isIso8601Utc(1717000000)`, `validateBumpPayload('not an object')`, unknown-field
/// forward-compat) are N/A in Swift's typed API — the compiler rejects a non-String
/// where `String?` is required, and unknown fields cannot reach a typed struct — so
/// they are intentionally not forced here.
final class KdsBumpRulesTests: XCTestCase {
    // ── isStationSlug (oracle §isStationSlug) ──────────────────────────
    func testIsStationSlug() {
        // known v1 stations + unknown-but-well-formed lowercased slugs
        for s in ["grill", "sides", "bar", "expo", "cold-line", "a"] {
            XCTAssertTrue(KdsBumpRules.isStationSlug(s), "\(s) should be valid")
        }
        // mixed case + empty
        for s in ["Grill", "BAR", ""] { XCTAssertFalse(KdsBumpRules.isStationSlug(s)) }
        // null
        XCTAssertFalse(KdsBumpRules.isStationSlug(nil))
    }

    // ── isIso8601Utc (oracle §isIso8601Utc) ────────────────────────────
    func testIsIso8601Utc() {
        XCTAssertTrue(KdsBumpRules.isIso8601Utc("2026-05-04T18:42:11.000Z"))
        XCTAssertTrue(KdsBumpRules.isIso8601Utc(KdsBumpRules.nowIsoCanonical()))
        // non-canonical forms
        XCTAssertFalse(KdsBumpRules.isIso8601Utc("2026-05-04 18:42:11"))
        XCTAssertFalse(KdsBumpRules.isIso8601Utc("2026-05-04T18:42:11Z"))     // missing .000
        XCTAssertFalse(KdsBumpRules.isIso8601Utc("2026-05-04T18:42:11+00:00"))
        // garbage
        XCTAssertFalse(KdsBumpRules.isIso8601Utc(""))
        XCTAssertFalse(KdsBumpRules.isIso8601Utc("not a date"))
        XCTAssertFalse(KdsBumpRules.isIso8601Utc(nil))
    }

    /// Regression guard for a Foundation footgun: `ISO8601DateFormatter`'s
    /// fractional-second round-trip can floating-point-truncate on some versions
    /// (a `.123` reformatting as `.122`), which would spuriously reject a canonical
    /// `bumped_at` a real KDS client sends — web (V8 integer-ms) never does this.
    /// Empirically clean for the legacy formatter today; this pins it so a future
    /// Foundation change can't silently regress bump validation.
    func testIsIso8601UtcMillisecondRoundTrip() {
        let bases = ["2026-05-04T18:42:11", "2026-01-01T00:00:00", "2025-12-31T23:59:59"]
        for base in bases {
            for ms in 0..<1000 {
                let s = "\(base).\(String(format: "%03d", ms))Z"
                XCTAssertTrue(KdsBumpRules.isIso8601Utc(s), "canonical \(s) must round-trip")
            }
        }
    }

    // ── hashPin (oracle §hashPin) ──────────────────────────────────────
    func testHashPin() {
        // Salted PBKDF2 now (audit 2026-07-10 P0-3): non-deterministic, verifies.
        let h = KdsBumpRules.hashPin("1234")
        XCTAssertTrue(h.hasPrefix("p1$"))
        XCTAssertNotEqual(h, KdsBumpRules.hashPin("1234"))        // salted → distinct each call
        XCTAssertFalse(h.contains("1234"))                        // never echoes raw PIN
        XCTAssertTrue(PinHash.verify("1234", h))                  // verifies against the PIN
        XCTAssertFalse(PinHash.verify("1235", h))                 // distinguishes PINs
    }

    // ── validateBumpPayload (oracle §validateBumpPayload) ──────────────
    func testValidateBumpPayload() {
        // null/empty body → ok with all nils
        guard case .ok(nil, nil, nil) = KdsBumpRules.validateBumpPayload(bumpedAt: nil, station: nil, cookPin: nil) else {
            return XCTFail("empty payload should be ok")
        }
        // fully populated valid → round-trips
        let iso = "2026-05-04T18:42:11.000Z"
        guard case .ok(iso, "grill", "1234") = KdsBumpRules.validateBumpPayload(bumpedAt: iso, station: "grill", cookPin: "1234") else {
            return XCTFail("valid payload should round-trip")
        }
        // non-canonical bumped_at → invalid, error mentions bumped_at
        guard case .invalid(let r1) = KdsBumpRules.validateBumpPayload(bumpedAt: "2026-05-04 18:42:11", station: nil, cookPin: nil) else {
            return XCTFail("should reject non-canonical bumped_at")
        }
        XCTAssertTrue(r1.contains("bumped_at"))
        // mixed-case station → invalid, error mentions station
        guard case .invalid(let r2) = KdsBumpRules.validateBumpPayload(bumpedAt: nil, station: "Grill", cookPin: nil) else {
            return XCTFail("should reject mixed-case station")
        }
        XCTAssertTrue(r2.contains("station"))
        // empty cook_pin → invalid, error mentions cook_pin
        guard case .invalid(let r3) = KdsBumpRules.validateBumpPayload(bumpedAt: nil, station: nil, cookPin: "") else {
            return XCTFail("should reject empty cook_pin")
        }
        XCTAssertTrue(r3.contains("cook_pin"))
    }

    // ── bumpActionForExisting (oracle §bumpActionForExisting) ──────────
    func testBumpActionForExisting() {
        XCTAssertEqual(KdsBumpRules.bumpActionForExisting(hasExisting: false), .insert)
        XCTAssertEqual(KdsBumpRules.bumpActionForExisting(hasExisting: true), .correction)
    }
}
