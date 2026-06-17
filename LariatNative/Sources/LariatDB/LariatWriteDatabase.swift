import Foundation
import GRDB

public enum LariatWriteDatabaseError: Error, LocalizedError {
    case databaseFileMissing(String)

    public var errorDescription: String? {
        switch self {
        case .databaseFileMissing(let path):
            return "lariat.db not found at \(path) — run the web app first"
        }
    }
}

/// Writable GRDB pool over the shared lariat.db. The web app owns schema and
/// migrations — this NEVER migrates. Refuses to create a new empty database file.
public struct LariatWriteDatabase {
    public let pool: DatabasePool

    public init(path: String = resolveDatabasePath()) throws {
        guard FileManager.default.fileExists(atPath: path) else {
            throw LariatWriteDatabaseError.databaseFileMissing(path)
        }
        var config = Configuration()
        config.readonly = false
        config.busyMode = .timeout(5.0)
        config.foreignKeysEnabled = true
        self.pool = try DatabasePool(path: path, configuration: config)
    }

    public func write<T>(_ block: (Database) throws -> T) throws -> T {
        try pool.write(block)
    }
}
