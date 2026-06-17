import Foundation
import CryptoKit

/// Mirrors `lib/tempPin.ts` `hashPin` — SHA-256 hex of UTF-8 PIN.
public enum PinHash {
    public static let minLength = 4
    public static let maxLength = 6

    public static func validateFormat(_ pin: String) -> String? {
        if pin.count < minLength { return "PIN too short" }
        if pin.count > maxLength { return "PIN too long" }
        if pin.unicodeScalars.contains(where: { !CharacterSet.decimalDigits.contains($0) }) {
            return "PIN must be digits only"
        }
        return nil
    }

    public static func sha256Hex(_ pin: String) -> String {
        let data = Data(pin.utf8)
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}
