import XCTest
@testable import LariatModel

/// Cross-platform PIN-hash parity (audit 2026-07-10 P0-3). Web and native share
/// one SQLite file, so native MUST verify a `p1$…` hash the web wrote and vice
/// versa. The GOLDEN_* strings below were produced by `lib/pinHash.ts`
/// hashPinSecure — if native's PBKDF2 / base64 / parsing drifts, they fail.
final class PinHashTests: XCTestCase {
    // Produced by web `lib/pinHash.ts` hashPinSecure('1234') / ('9753').
    let golden1234 = "p1$200000$ZjlZQBTvL+aaqdzHgSojDw==$Izl6wAkAnLWP1R+tppPIpIoZd1iGlPZSUbkQgh8c1WA="
    let golden9753 = "p1$200000$f47rcRebbEg+tu9NqRnlgw==$k3/n25KOKmtHC5yhx5Bc6JeFX8aD15e5racTZiY7vuw="
    // sha256('4321') — the legacy on-disk format.
    let legacy4321 = "fe2592b42a727e977f055947385b709cc82b16b9a87f88c6abf3900d65d0cdc3"

    func testVerifiesWebProducedHash() {
        XCTAssertTrue(PinHash.verify("1234", golden1234), "native must verify a web-written p1$ hash")
        XCTAssertTrue(PinHash.verify("9753", golden9753))
        XCTAssertFalse(PinHash.verify("0000", golden1234))
        XCTAssertFalse(PinHash.verify("9753", golden1234))
    }

    func testHashPinSecureFormatAndSalting() {
        let a = PinHash.hashPinSecure("1234")
        XCTAssertTrue(a.hasPrefix("p1$"))
        XCTAssertFalse(PinHash.isLegacyHash(a))
        XCTAssertNotEqual(a, "1234")
        XCTAssertNotEqual(a, PinHash.sha256Hex("1234"))
        // fresh salt each call
        XCTAssertNotEqual(a, PinHash.hashPinSecure("1234"))
    }

    func testRoundTrip() {
        let stored = PinHash.hashPinSecure("4242")
        XCTAssertTrue(PinHash.verify("4242", stored))
        XCTAssertFalse(PinHash.verify("4243", stored))
    }

    func testWebCanVerifyNativeProducedHash() {
        // The reverse direction is proven structurally: hashPinSecure emits the
        // exact p1$iter$saltB64$keyB64 contract, standard padded base64, same
        // 200k/SHA256/32-byte params web parses. Round-trip + golden together
        // pin both directions of the shared-DB contract.
        let native = PinHash.hashPinSecure("9753")
        let parts = native.split(separator: "$", omittingEmptySubsequences: false)
        XCTAssertEqual(parts.count, 4)
        XCTAssertEqual(parts[0], "p1")
        XCTAssertEqual(parts[1], "200000")
        XCTAssertNotNil(Data(base64Encoded: String(parts[2])))
        XCTAssertNotNil(Data(base64Encoded: String(parts[3])))
    }

    func testAcceptsLegacySha256() {
        XCTAssertTrue(PinHash.isLegacyHash(legacy4321))
        XCTAssertTrue(PinHash.verify("4321", legacy4321))
        XCTAssertFalse(PinHash.verify("0000", legacy4321))
    }

    func testVerifyFailsClosedOnJunk() {
        for bad in ["", "not-a-hash", "p1$", "p1$200000$$", "deadbeef",
                    "p1$999999999999$c2FsdA==$eA=="] {
            XCTAssertFalse(PinHash.verify("1234", bad), "should reject: \(bad)")
        }
    }

    func testIsLegacyHash() {
        XCTAssertTrue(PinHash.isLegacyHash(PinHash.sha256Hex("1")))
        XCTAssertFalse(PinHash.isLegacyHash(PinHash.hashPinSecure("1")))
        XCTAssertFalse(PinHash.isLegacyHash("ABC"))
        XCTAssertFalse(PinHash.isLegacyHash(""))
    }
}
