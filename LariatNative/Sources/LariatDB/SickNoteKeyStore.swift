// LariatNative/Sources/LariatDB/SickNoteKeyStore.swift
import Foundation
import LariatModel

public enum SickNoteKeyError: Error, Equatable { case malformedKeyFile }

/// Reads/creates the sick-note media key file (audit P0-6, §6). 0600, atomic write,
/// sibling of uploads/ and audit/ (OUTSIDE uploads/ so backups never copy it).
public struct SickNoteKeyStore {
    public init() {}

    public func keyPath(dataDir: URL) -> URL {
        dataDir.appendingPathComponent("keys", isDirectory: true)
               .appendingPathComponent("sick-note-media.json")
    }

    public func loadOrCreate(dataDir: URL, now: Date = Date()) throws -> SickNoteMediaKey {
        let path = keyPath(dataDir: dataDir)
        if FileManager.default.fileExists(atPath: path.path) {
            guard let key = SickNoteMediaKey.parse(try Data(contentsOf: path)) else {
                throw SickNoteKeyError.malformedKeyFile
            }
            return key
        }
        let key = SickNoteMediaKey.generate(now: now)
        try write(key, to: path)
        return key
    }

    /// Used by the Keychain heal path: write a recovered key only if none exists on disk.
    public func writeIfAbsent(_ key: SickNoteMediaKey, dataDir: URL) throws {
        let path = keyPath(dataDir: dataDir)
        guard !FileManager.default.fileExists(atPath: path.path) else { return }
        try write(key, to: path)
    }

    private func write(_ key: SickNoteMediaKey, to path: URL) throws {
        try FileManager.default.createDirectory(at: path.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(key).write(to: path, options: .atomic) // temp+rename
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
    }
}
