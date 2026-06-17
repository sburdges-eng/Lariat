import Foundation
import GRDB

/// Writable GRDB pool over the shared lariat.db. The web app owns schema and
/// migrations — this NEVER migrates. Use only for explicit manager write paths (P1b+).
public struct LariatWriteDatabase {
    public let pool: DatabasePool

    public init(path: String = resolveDatabasePath()) throws {
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
