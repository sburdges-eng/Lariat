import Foundation
import GRDB
import LariatModel

/// H8 first-run polish: a double-clicked Lariat.app on a machine with no
/// database gets a working (empty) board instead of the degrade tile, seeded
/// from the bundled C2 frozen schema (PACKAGING.md "first-run seed").
///
/// Scope guard: this ONLY creates a database at the packaged Application
/// Support default (`~/Library/Application Support/Lariat/data`). Every other
/// location — a dev repo's `data/`, an explicit `LARIAT_DATA_DIR` — keeps the
/// fail-loud "run the web app first" refusal in `LariatWriteDatabase`, so a
/// typo'd env var cannot silently manufacture a second database. An existing
/// database is never touched: the pre-flip rule that the web owns schema and
/// migrations (SchemaMigrator STATUS note) still holds — seeding happens only
/// where no database exists for anyone to own.
public enum FirstRunBootstrap {
    public enum Outcome: Equatable {
        /// lariat.db already present — nothing done.
        case existingDatabase
        /// Fresh database created and migrated from the bundled frozen schema.
        case seeded
        /// Not the packaged Application Support default — refused to create.
        case notEligible
    }

    @discardableResult
    public static func ensureDatabase(
        dataDir: String,
        env: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) throws -> Outcome {
        let dbPath = (dataDir as NSString).appendingPathComponent("lariat.db")
        if fileManager.fileExists(atPath: dbPath) { return .existingDatabase }

        guard let support = applicationSupportLariatRoot(env: env),
              dataDir == (support as NSString).appendingPathComponent("data")
        else { return .notEligible }

        try fileManager.createDirectory(atPath: dataDir, withIntermediateDirectories: true)
        var config = Configuration()
        config.foreignKeysEnabled = true
        let pool = try DatabasePool(path: dbPath, configuration: config)
        do {
            try SchemaMigrator().migrate(pool)
        } catch {
            // This file was created moments ago by this call — remove the
            // partial seed so the next launch retries cleanly instead of
            // trusting a half-built database.
            try? pool.close()
            for suffix in ["", "-wal", "-shm"] {
                try? fileManager.removeItem(atPath: dbPath + suffix)
            }
            throw error
        }
        try? pool.close()
        return .seeded
    }
}
