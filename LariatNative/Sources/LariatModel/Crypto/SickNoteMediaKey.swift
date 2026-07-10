import Foundation
import CryptoKit

/// Versioned sick-note media key value type (audit P0-6).
/// On-disk JSON shape: {"v":1,"key_id":"<32 hex>","key":"<base64 32 bytes>","created_at":"<ISO-8601>"}
public struct SickNoteMediaKey: Codable, Equatable, Sendable {
    public let v: Int
    public let keyId: String   // 32 hex chars = 16 bytes
    public let key: String     // base64, 32 bytes
    public let createdAt: String

    enum CodingKeys: String, CodingKey {
        case v
        case keyId = "key_id"
        case key
        case createdAt = "created_at"
    }

    public static let currentVersion = 1

    public var keyIdData: Data? {
        let d = Self.dataFromHex(keyId)
        return d?.count == 16 ? d : nil
    }
    public var symmetricKey: SymmetricKey? {
        guard let d = Data(base64Encoded: key), d.count == 32 else { return nil }
        return SymmetricKey(data: d)
    }

    /// Fail-closed: nil on any malformed field. Never returns a guessed key.
    public static func parse(_ json: Data) -> SickNoteMediaKey? {
        guard let k = try? JSONDecoder().decode(SickNoteMediaKey.self, from: json) else { return nil }
        guard k.v == currentVersion, k.keyIdData != nil, k.symmetricKey != nil else { return nil }
        return k
    }

    public static func generate(now: Date) -> SickNoteMediaKey {
        var rng = SystemRandomNumberGenerator()
        let keyBytes = Data((0..<32).map { _ in UInt8.random(in: 0...255, using: &rng) })
        let idBytes = Data((0..<16).map { _ in UInt8.random(in: 0...255, using: &rng) })
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return SickNoteMediaKey(v: currentVersion,
                                keyId: hexFromData(idBytes),
                                key: keyBytes.base64EncodedString(),
                                createdAt: iso.string(from: now))
    }

    static func hexFromData(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }
    static func dataFromHex(_ s: String) -> Data? {
        let chars = Array(s)
        guard chars.count % 2 == 0 else { return nil }
        var out = Data(capacity: chars.count / 2)
        var i = 0
        while i < chars.count {
            guard let byte = UInt8(String(chars[i...(i + 1)]), radix: 16) else { return nil }
            out.append(byte); i += 2
        }
        return out
    }
}
