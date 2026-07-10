import XCTest
import CryptoKit
@testable import LariatModel

final class SickNoteCryptoTests: XCTestCase {
    // Fixed vectors so the LSN1 layout is pinned across impls (Node parity lands later).
    let keyData = Data(base64Encoded: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")! // 32 bytes 0x00..0x1f
    let keyId   = Data((0..<16).map { UInt8($0 + 0x40) })                                // 16 bytes 0x40..0x4f
    let nonce   = Data((0..<12).map { UInt8($0 + 0x80) })                                // 12 bytes 0x80..0x8b
    let path    = "sick-notes/12/3f2a.pdf"
    let plain   = Data("%PDF-1.4 hello".utf8)

    func testRoundTripsWithFixedNonce() throws {
        let key = SymmetricKey(data: keyData)
        let blob = try SickNoteCrypto.seal(plain, key: key, keyId: keyId, filePath: path, nonceOverride: nonce)
        XCTAssertTrue(SickNoteCrypto.isEncrypted(blob))
        // layout: 4 magic + 16 keyId + 12 nonce + ciphertext + 16 tag
        XCTAssertEqual(blob.prefix(4), Data("LSN1".utf8))
        XCTAssertEqual(blob.subdata(in: 4..<20), keyId)
        XCTAssertEqual(blob.subdata(in: 20..<32), nonce)
        XCTAssertEqual(blob.count, 32 + plain.count + 16)
        let out = try SickNoteCrypto.open(blob, key: key, keyId: keyId, filePath: path)
        XCTAssertEqual(out, plain)
    }

    func testOpenFailsClosed() throws {
        let key = SymmetricKey(data: keyData)
        let blob = try SickNoteCrypto.seal(plain, key: key, keyId: keyId, filePath: path, nonceOverride: nonce)
        // wrong AAD (moved to another row) -> auth failure
        XCTAssertThrowsError(try SickNoteCrypto.open(blob, key: key, keyId: keyId, filePath: "sick-notes/99/x.pdf")) {
            XCTAssertEqual($0 as? SickNoteCrypto.CryptoError, .authenticationFailed)
        }
        // wrong keyId
        XCTAssertThrowsError(try SickNoteCrypto.open(blob, key: key, keyId: Data(repeating: 0, count: 16), filePath: path)) {
            XCTAssertEqual($0 as? SickNoteCrypto.CryptoError, .keyIdMismatch)
        }
        // truncated / not LSN1
        XCTAssertThrowsError(try SickNoteCrypto.open(Data([1,2,3]), key: key, keyId: keyId, filePath: path)) {
            XCTAssertEqual($0 as? SickNoteCrypto.CryptoError, .badFormat)
        }
        XCTAssertFalse(SickNoteCrypto.isEncrypted(Data("%PDF-".utf8)))
    }
}
