// LariatNative/Sources/LariatModel/Compute/SickNoteTempStore.swift
import Foundation

/// Where a decrypted sick-note is transiently written for the OS viewer (audit P0-6, §7/§12).
/// Path logic is pure/testable; the App layer does the writes + sweeps.
public enum SickNoteTempStore {
    public static let directoryName = "LariatSickNotes"

    public static func directory(base: URL = FileManager.default.temporaryDirectory) -> URL {
        base.appendingPathComponent(directoryName, isDirectory: true)
    }
    public static func fileURL(uuid: String, ext: String,
                               base: URL = FileManager.default.temporaryDirectory) -> URL {
        directory(base: base).appendingPathComponent("\(uuid).\(ext.lowercased())")
    }
    public static func isStale(modifiedAt: Date, now: Date, ttlSeconds: TimeInterval = 3600) -> Bool {
        now.timeIntervalSince(modifiedAt) > ttlSeconds
    }
}
