import Foundation
import Security

public enum UuidV7 {
    public static func generate(nowMs: UInt64 = UInt64(Date().timeIntervalSince1970 * 1000)) -> String {
        var buf = [UInt8](repeating: 0, count: 16)
        buf[0] = UInt8((nowMs >> 40) & 0xff)
        buf[1] = UInt8((nowMs >> 32) & 0xff)
        buf[2] = UInt8((nowMs >> 24) & 0xff)
        buf[3] = UInt8((nowMs >> 16) & 0xff)
        buf[4] = UInt8((nowMs >> 8) & 0xff)
        buf[5] = UInt8(nowMs & 0xff)
        // Random tail from the system CSPRNG, matching lib/uuid.ts's
        // crypto.randomBytes(10). SecRandomCopyBytes is the documented
        // Security-framework entropy source; using it makes the cryptographic
        // guarantee explicit rather than relying on the (undocumented) fact
        // that SystemRandomNumberGenerator is CSPRNG-backed on Apple platforms.
        // The deterministic ms/version/variant bytes are untouched — pinned by
        // UuidV7Tests against tests/fixtures/uuidv7_timestamp.json.
        var tail = [UInt8](repeating: 0, count: 10)
        guard SecRandomCopyBytes(kSecRandomDefault, tail.count, &tail) == errSecSuccess else {
            // Unreachable in practice; crash rather than mint a weak PK / op_id.
            fatalError("UuidV7.generate: SecRandomCopyBytes failed to draw entropy")
        }
        for i in 0..<10 { buf[6 + i] = tail[i] }
        buf[6] = (buf[6] & 0x0f) | 0x70
        buf[8] = (buf[8] & 0x3f) | 0x80
        let hex = buf.map { String(format: "%02x", $0) }.joined()
        return "\(hex.prefix(8))-\(hex.dropFirst(8).prefix(4))-\(hex.dropFirst(12).prefix(4))-\(hex.dropFirst(16).prefix(4))-\(hex.dropFirst(20))"
    }
}
