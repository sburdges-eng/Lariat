import Foundation
import GRDB

/// Read-only GRDB pool over the shared lariat.db. The web app owns the schema and
/// migrations — this NEVER writes or migrates. WAL allows concurrent web-side writes.
public struct LariatDatabase {
    public let pool: DatabasePool

    public init(path: String = resolveDatabasePath()) throws {
        var config = Configuration()
        config.readonly = true
        config.busyMode = .timeout(5.0)            // wait out web-side write locks
        config.foreignKeysEnabled = true
        self.pool = try DatabasePool(path: path, configuration: config)
    }
}
