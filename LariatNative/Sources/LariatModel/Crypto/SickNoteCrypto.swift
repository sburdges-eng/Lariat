import Foundation
import CryptoKit

/// LSN1 authenticated envelope for sick-note PHI files (audit P0-6).
/// Layout: "LSN1"(4) ‖ keyId(16) ‖ nonce(12) ‖ ciphertext ‖ tag(16).
/// AAD = the row's relative file_path bytes, binding a ciphertext to its slot.
public enum SickNoteCrypto {
    public static let magic = Data("LSN1".utf8)
    static let keyIdBytes = 16
    static let nonceBytes = 12
    static let tagBytes = 16
    static let headerBytes = 4 + 16 + 12 // = 32

    public enum CryptoError: Error, Equatable {
        case badFormat
        case keyIdMismatch
        case authenticationFailed
    }

    public static func isEncrypted(_ blob: Data) -> Bool {
        blob.count >= magic.count && blob.prefix(magic.count) == magic
    }

    /// `nonceOverride` exists ONLY for deterministic golden-vector tests; production seals with a fresh nonce.
    public static func seal(_ plaintext: Data, key: SymmetricKey, keyId: Data,
                            filePath: String, nonceOverride: Data? = nil) throws -> Data {
        guard keyId.count == keyIdBytes else { throw CryptoError.badFormat }
        let nonce: AES.GCM.Nonce
        if let n = nonceOverride {
            guard n.count == nonceBytes, let parsed = try? AES.GCM.Nonce(data: n) else { throw CryptoError.badFormat }
            nonce = parsed
        } else {
            nonce = AES.GCM.Nonce()
        }
        let box = try AES.GCM.seal(plaintext, using: key, nonce: nonce, authenticating: Data(filePath.utf8))
        var out = Data()
        out.append(magic)
        out.append(keyId)
        out.append(Data(box.nonce))
        out.append(box.ciphertext)
        out.append(box.tag)
        return out
    }

    public static func open(_ blob: Data, key: SymmetricKey, keyId: Data, filePath: String) throws -> Data {
        guard blob.count >= headerBytes + tagBytes, isEncrypted(blob) else { throw CryptoError.badFormat }
        let base = blob.startIndex
        let fileKeyId = blob.subdata(in: (base + 4)..<(base + 20))
        guard fileKeyId == keyId else { throw CryptoError.keyIdMismatch }
        let nonceData = blob.subdata(in: (base + 20)..<(base + 32))
        let tagStart = blob.endIndex - tagBytes
        let cipher = blob.subdata(in: (base + 32)..<tagStart)
        let tag = blob.subdata(in: tagStart..<blob.endIndex)
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonceData), ciphertext: cipher, tag: tag)
            return try AES.GCM.open(box, using: key, authenticating: Data(filePath.utf8))
        } catch {
            throw CryptoError.authenticationFailed
        }
    }
}
