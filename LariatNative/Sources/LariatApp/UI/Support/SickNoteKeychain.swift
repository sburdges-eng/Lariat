// LariatNative/Sources/LariatApp/UI/Support/SickNoteKeychain.swift
import Foundation
import LariatModel
import LariatDB
#if canImport(Security)
import Security
#endif

/// Recovery mirror for the sick-note media key (audit P0-6, §6). The key FILE is authoritative;
/// the Keychain is a best-effort recovery copy. Failures warn once and never block attach/view.
enum SickNoteKeychain {
    static let service = "com.lariat.sick-note-media-key"

    #if canImport(Security)
    static func load() -> SickNoteMediaKey? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return SickNoteMediaKey.parse(data)
    }

    static func store(_ key: SickNoteMediaKey) {
        guard let data = try? JSONEncoder().encode(key) else { return }
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.keyId,
        ]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        if status != errSecSuccess { warnOnce("keychain store failed: \(status)") }
    }
    #else
    static func load() -> SickNoteMediaKey? { nil }
    static func store(_ key: SickNoteMediaKey) {}
    #endif

    /// On launch: heal a missing key file from the Keychain, else mirror the file into the Keychain.
    static func healAndMirror(dataDir: URL) {
        let store = SickNoteKeyStore()
        let hasFile = FileManager.default.fileExists(atPath: store.keyPath(dataDir: dataDir).path)
        if !hasFile, let recovered = load() {
            try? store.writeIfAbsent(recovered, dataDir: dataDir)
            return
        }
        if hasFile, let onDisk = try? store.loadOrCreate(dataDir: dataDir), SickNoteKeychain.load() == nil {
            SickNoteKeychain.store(onDisk)
        }
    }

    private static var warned = false
    private static func warnOnce(_ msg: String) {
        if !warned { warned = true; FileHandle.standardError.write(Data("[sick-note-keychain] \(msg)\n".utf8)) }
    }
}
