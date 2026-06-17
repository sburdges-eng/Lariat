import GRDB

// MARK: - SchemaVersionState

/// The result of probing a SQLite database for a schema version marker.
///
/// The Lariat web app uses additive `ALTER TABLE` migrations with no version
/// tracking (no `PRAGMA user_version` writes, no `schema_migrations` table in
/// the base install). The guard therefore degrades gracefully on absence rather
/// than crashing — callers should treat `.unknown` as "read what's available."
public enum SchemaVersionState: Equatable {
    /// A version marker was found. The associated value is either the
    /// `user_version` pragma value or the row count of `schema_migrations`.
    case known(Int)
    /// No reliable version marker was present (user_version == 0 and no
    /// `schema_migrations` table). Callers should degrade gracefully.
    case unknown
}

// MARK: - SchemaVersionGuard

/// A read-only probe that inspects a GRDB `Database` connection for the
/// presence of a schema version marker. Never writes or migrates.
public enum SchemaVersionGuard {

    /// Probe `db` for a schema version marker and return the resulting state.
    ///
    /// Resolution order:
    /// 1. Check `PRAGMA user_version`. If non-zero → `.known(userVersion)`.
    /// 2. Check for a `schema_migrations` table in `sqlite_master`. If present
    ///    → `.known(rowCount)` (row count as a proxy for migration depth).
    /// 3. Nothing found → `.unknown`.
    ///
    /// This function is intentionally non-throwing: any SQLite error while
    /// reading the marker is caught and mapped to `.unknown`.
    ///
    /// - Parameter db: A GRDB `Database` connection (read-only is fine).
    /// - Returns: `.known(n)` when a marker is present; `.unknown` otherwise.
    public static func probe(_ db: Database) -> SchemaVersionState {
        // 1. PRAGMA user_version (SQLite built-in — always present, defaults to 0)
        if let version = try? Int.fetchOne(db, sql: "PRAGMA user_version"),
           version > 0 {
            return .known(version)
        }

        // 2. schema_migrations table presence + row count
        if let tableExists = try? Bool.fetchOne(
            db,
            sql: "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
        ), tableExists {
            let rowCount = (try? Int.fetchOne(db, sql: "SELECT COUNT(*) FROM schema_migrations")) ?? 0
            return .known(rowCount)
        }

        // 3. No marker found — degrade gracefully
        return .unknown
    }
}
