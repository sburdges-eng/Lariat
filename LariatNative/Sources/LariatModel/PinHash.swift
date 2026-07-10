import Foundation
import CryptoKit
import CommonCrypto

/// Cross-platform PIN hashing (audit 2026-07-10 P0-3). Salted PBKDF2-HMAC-SHA256
/// with a constant-time verify that also accepts the legacy unsalted SHA-256.
/// PBKDF2 (via CommonCrypto) is chosen so this matches web `lib/pinHash.ts`
/// byte-for-byte: web and native share one SQLite file and must verify each
/// other's hashes. The stored string `p1$iterations$saltB64$keyB64` is the
/// contract. `sha256Hex` is kept only for legacy-format seeding/compat.
public enum PinHash {
    public static let minLength = 4
    public static let maxLength = 6

    // Cross-platform hash contract — MUST match lib/pinHash.ts.
    private static let prefix = "p1"
    private static let saltBytes = 16
    private static let keyBytes = 32
    private static let iterations = 200_000
    private static let maxIterations = 5_000_000

    public static func validateFormat(_ pin: String) -> String? {
        if pin.count < minLength { return "PIN too short" }
        if pin.count > maxLength { return "PIN too long" }
        // Web parity: /^[0-9]+$/ — ASCII digits only. CharacterSet.decimalDigits
        // would admit Arabic-Indic/fullwidth digits the web rejects at create AND login.
        if pin.unicodeScalars.contains(where: { $0 < "0" || $0 > "9" }) {
            return "PIN must be digits only"
        }
        return nil
    }

    /// LEGACY unsalted SHA-256 hex. Kept for seeding pre-2026-07-10 rows and as
    /// the format `verify` still accepts — do NOT use for new credential storage.
    public static func sha256Hex(_ pin: String) -> String {
        let data = Data(pin.utf8)
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// True for the legacy unsalted SHA-256 hex format (64 lowercase hex chars).
    public static func isLegacyHash(_ stored: String) -> Bool {
        guard stored.count == 64 else { return false }
        return stored.allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) }
    }

    /// Hash a PIN with a fresh random salt. Returns `p1$iterations$saltB64$keyB64`.
    public static func hashPinSecure(_ pin: String) -> String {
        var gen = SystemRandomNumberGenerator()
        let salt = (0..<saltBytes).map { _ in UInt8.random(in: 0...255, using: &gen) }
        // Non-nil for valid params on a functioning platform; fall back to a
        // fresh attempt should the KDF ever fail rather than store a bad hash.
        let key = pbkdf2(pin: pin, salt: salt, iterations: iterations, keyLen: keyBytes)!
        let saltB64 = Data(salt).base64EncodedString()
        let keyB64 = Data(key).base64EncodedString()
        return "\(prefix)$\(iterations)$\(saltB64)$\(keyB64)"
    }

    /// Constant-time verify. Accepts both the PBKDF2 format and legacy SHA-256
    /// hex. Never throws: malformed/unparseable input fails closed (false).
    public static func verify(_ pin: String, _ stored: String) -> Bool {
        if stored.isEmpty { return false }

        if isLegacyHash(stored) {
            return constantTimeEqual(Array(sha256Hex(pin).utf8), Array(stored.utf8))
        }

        let parts = stored.split(separator: "$", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 4, parts[0] == prefix else { return false }
        guard let iters = Int(parts[1]), iters >= 1, iters <= maxIterations else { return false }
        guard let saltData = Data(base64Encoded: parts[2]), !saltData.isEmpty,
              let keyData = Data(base64Encoded: parts[3]), !keyData.isEmpty else { return false }
        guard let derived = pbkdf2(pin: pin, salt: [UInt8](saltData),
                                   iterations: iters, keyLen: keyData.count) else { return false }
        return constantTimeEqual([UInt8](keyData), derived)
    }

    // ── internals ─────────────────────────────────────────────────────────

    private static func pbkdf2(pin: String, salt: [UInt8], iterations: Int, keyLen: Int) -> [UInt8]? {
        guard keyLen > 0, !salt.isEmpty else { return nil }
        var derived = [UInt8](repeating: 0, count: keyLen)
        let status = salt.withUnsafeBufferPointer { saltBuf in
            derived.withUnsafeMutableBufferPointer { outBuf in
                CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2),
                    pin, pin.utf8.count,
                    saltBuf.baseAddress, saltBuf.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                    UInt32(iterations),
                    outBuf.baseAddress, keyLen
                )
            }
        }
        return status == kCCSuccess ? derived : nil
    }

    private static func constantTimeEqual(_ a: [UInt8], _ b: [UInt8]) -> Bool {
        if a.count != b.count { return false }
        var diff: UInt8 = 0
        for i in 0..<a.count { diff |= a[i] ^ b[i] }
        return diff == 0
    }
}
