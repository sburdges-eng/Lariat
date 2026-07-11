// LariatNative/Sources/LariatDB/SickNoteMigrator.swift
import Foundation
import LariatModel

/// One-time / on-launch sweep that encrypts any legacy plaintext sick-note file in place
/// (audit P0-6, §8). Filesystem-only: no DB access, no audit events, no file_path change.
/// Idempotent. Expected to be a no-op given the zero corpus at rollout.
public struct SickNoteMigrator {
    public init() {}

    public struct SweepResult: Equatable {
        public var encrypted: Int
        public var alreadyEncrypted: Int
        public var failed: Int
        public init(encrypted: Int = 0, alreadyEncrypted: Int = 0, failed: Int = 0) {
            self.encrypted = encrypted; self.alreadyEncrypted = alreadyEncrypted; self.failed = failed
        }
    }

    @discardableResult
    public func encryptLegacyFiles(dataDir: URL, key: SickNoteMediaKey) throws -> SweepResult {
        guard let keyId = key.keyIdData, let symKey = key.symmetricKey else {
            throw SickNoteKeyError.malformedKeyFile
        }
        let uploads = dataDir.appendingPathComponent("uploads")
        let root = uploads.appendingPathComponent("sick-notes")
        var result = SweepResult()
        guard let walker = FileManager.default.enumerator(at: root,
                includingPropertiesForKeys: [.isRegularFileKey]) else { return result }
        let base = uploads.standardizedFileURL.path + "/"
        for case let fileURL as URL in walker {
            guard (try? fileURL.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true,
                  !fileURL.lastPathComponent.hasSuffix(".tmp") else { continue }
            guard let data = try? Data(contentsOf: fileURL) else { result.failed += 1; continue }
            if SickNoteCrypto.isEncrypted(data) { result.alreadyEncrypted += 1; continue }
            let full = fileURL.standardizedFileURL.path
            // A prefix-check failure here must never fall back to a guessed AAD (the
            // filename alone) — sealing with the wrong AAD would permanently brick the
            // file's decryptability. Skip it and count it failed instead (audit hardening).
            guard full.hasPrefix(base) else { result.failed += 1; continue }
            let rel = String(full.dropFirst(base.count))
            do {
                let sealed = try SickNoteCrypto.seal(data, key: symKey, keyId: keyId, filePath: rel)
                let tmp = fileURL.deletingLastPathComponent().appendingPathComponent(".\(UUID().uuidString).tmp")
                try sealed.write(to: tmp, options: .atomic)
                _ = try FileManager.default.replaceItemAt(fileURL, withItemAt: tmp)
                try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
                result.encrypted += 1
            } catch {
                result.failed += 1
            }
        }
        return result
    }
}
