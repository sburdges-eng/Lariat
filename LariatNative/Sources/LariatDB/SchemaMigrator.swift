import Foundation
import GRDB

public enum SchemaMigratorError: Error, LocalizedError {
    /// Mirrors `assertCriticalSchemas` in `lib/db.ts` — a table exists but is
    /// missing required columns (legacy/partial-deploy drift). Fail loud at
    /// migrate time instead of a cryptic "no such column" later.
    case schemaDrift(table: String, missing: [String], found: [String])
    /// The bundled `frozen_schema.sql` resource could not be located.
    case resourceMissing

    public var errorDescription: String? {
        switch self {
        case .schemaDrift(let table, let missing, let found):
            return "schema drift on '\(table)': missing columns \(missing). Found: \(found). "
                + "A legacy/partial-deploy table is shadowing the current schema; "
                + "inspect the DB and either drop+recreate the table or add a migration."
        case .resourceMissing:
            return "SchemaMigrator: bundled resource frozen_schema.sql not found. "
                + "Ensure the LariatDB target ships Sources/LariatDB/Resources as a copied resource."
        }
    }
}

/// Phase C2 — native replay of the web app's schema, so a fresh database built
/// by native is schema-identical to one built by the web (`lib/db.ts
/// initSchema()`); the normalized `sqlite_master` diff is empty (see
/// `SchemaMigrator­Tests` + `SchemaDump`).
///
/// APPROACH — replay the web's canonical *frozen* schema, not its statement
/// history. Phase C freezes the web migration list (the schema stops evolving
/// web-side; see the activation doc), so the single source of truth is the DDL
/// the web actually produces. `scripts/dump-fresh-schema.mjs --executable`
/// captures that (every `sqlite_master` object as a re-entrant
/// `CREATE … IF NOT EXISTS`, plus `INSERT OR IGNORE` seed rows) into the
/// committed resource `Resources/frozen_schema.sql`. Replaying it is
/// byte-parity by construction and re-entrant, so it is also a no-op against an
/// already-migrated web DB. This deliberately avoids hand-transcribing
/// `initSchema()`'s ~70 order- and guard-sensitive `migrateLegacyColumns`
/// `ALTER`s, which would be fragile for zero schema benefit once frozen.
/// Splitting the frozen schema into granular authored migrations (the spec's
/// eventual "migration history" shape) is a documented post-freeze refinement.
///
/// STATUS (build phase, pre-flip): the migrator EXISTS and is test-proven, but
/// the web remains the schema owner. Nothing native invokes this against
/// `data/lariat.db` yet — `LariatWriteDatabase` still refuses to create/migrate.
/// The flip steps (freeze `lib/db.ts` migrations, web-edge `schema_version`
/// refusal handshake, single-DDL-writer rule) are documented in
/// `docs/superpowers/specs/2026-07-03-lariat-native-phase-c2-c3-activation.md`
/// and only happen after the C4 reconciliation window.
public struct SchemaMigrator {

    /// Ordered GRDB migration identifiers. One migration: replay the frozen
    /// web schema. (Grows if the post-freeze granular-migration refinement
    /// lands; `expectedVersion` tracks the count.)
    public static let migrationIdentifiers: [String] = [
        "c2-001-web-frozen-schema",
    ]

    /// The version this build stamps into `PRAGMA user_version` after a
    /// successful migrate. Grows monotonically with the migration list.
    public static var expectedVersion: Int { migrationIdentifiers.count }

    /// Parity with `SCHEMA_VERSION` in `lib/db.ts` (the web's monotonic marker
    /// recorded in the `schema_migrations` table, replayed by the seed rows in
    /// `frozen_schema.sql`).
    public static let webSchemaVersion = 3

    public init() {}

    /// Replay the frozen web schema. Idempotent: GRDB records the applied
    /// migration and skips it on re-run, and every statement is itself
    /// re-entrant (`IF NOT EXISTS` / `INSERT OR IGNORE`), so running against an
    /// ALREADY-migrated web database is a schema no-op.
    public func migrate(_ writer: some DatabaseWriter) throws {
        var migrator = DatabaseMigrator()
        Self.registerMigrations(into: &migrator)
        try migrator.migrate(writer)
        try writer.write { db in
            // Web parity: assertCriticalSchemas runs on every open.
            try Self.assertCriticalSchemas(db)
            try db.execute(sql: "PRAGMA user_version = \(Self.expectedVersion)")
        }
    }

    /// Read the native version stamp (`PRAGMA user_version`; 0 = never
    /// stamped by this migrator).
    public static func currentVersion(_ db: Database) throws -> Int {
        try Int.fetchOne(db, sql: "PRAGMA user_version") ?? 0
    }

    /// Read the web's monotonic marker (`SELECT MAX(version) FROM
    /// schema_migrations`); nil when the table does not exist yet.
    public static func webSchemaMigrationsVersion(_ db: Database) throws -> Int? {
        guard try db.tableExists("schema_migrations") else { return nil }
        return try Int.fetchOne(db, sql: "SELECT MAX(version) FROM schema_migrations")
    }

    // MARK: - Registration

    static func registerMigrations(into migrator: inout DatabaseMigrator) {
        // `.deferred` foreign-key checks: the frozen schema's `CREATE TABLE`s
        // carry forward FK references; under `.deferred` GRDB disables FK
        // enforcement during the migration and runs a full `foreign_key_check`
        // at the end. The only seed rows (default location, schema_migrations)
        // have no FK dependencies, so the end check has nothing to fault.
        migrator.registerMigration("c2-001-web-frozen-schema", foreignKeyChecks: .deferred) { db in
            try db.execute(sql: Self.frozenSchemaSQL())
        }
    }

    /// The committed frozen web schema (re-entrant DDL + seeds). Regenerate via
    /// `node scripts/dump-fresh-schema.mjs --executable > …/Resources/frozen_schema.sql`.
    static func frozenSchemaSQL() throws -> String {
        guard let url = Bundle.module.url(forResource: "frozen_schema", withExtension: "sql", subdirectory: "Resources")
            ?? Bundle.module.url(forResource: "frozen_schema", withExtension: "sql")
        else {
            throw SchemaMigratorError.resourceMissing
        }
        return try String(contentsOf: url, encoding: .utf8)
    }

    // MARK: - assertCriticalSchemas (port of lib/db.ts)

    static func assertCriticalSchemas(_ db: Database) throws {
        let requirements: [(table: String, required: [String])] = [
            ("ingredient_yields", ["ingredient_key", "yield_pct", "loss_factor", "source", "notes", "updated_at"]),
            ("manager_pin_users", ["location_id", "name", "pin_hash", "role", "is_active", "created_at", "updated_at", "disabled_at"]),
            ("ingredient_densities", ["ingredient_key", "g_per_ml", "source", "updated_at"]),
            ("ingredient_unit_weights", ["ingredient_key", "unit", "g_per_unit", "source", "updated_at"]),
            ("vendor_catch_weights", ["vendor", "sku", "catalog_wt_lb", "tare_lb", "source", "updated_at"]),
            ("pack_size_changes", ["id", "vendor", "sku", "prev_pack", "new_pack", "prev_price", "new_price", "detected_at", "acknowledged"]),
            ("ingredient_masters", ["master_id", "canonical_name", "category", "preferred_vendor", "quality_locked", "quality_lock_reason", "last_reviewed"]),
            ("receiving_log", ["id", "shift_date", "location_id", "vendor", "category", "item", "vendor_sku", "master_id", "match_status", "match_reason", "reading_f", "required_max_f", "package_ok", "expiration_date", "received_qty", "received_unit", "status", "rejection_reason"]),
            ("inventory_updates", ["id", "shift_date", "item", "master_id", "delta", "direction", "note", "cook_id", "location_id", "receiving_log_id"]),
            ("performance_reviews", ["id", "cook_name", "cook_uuid", "review_date", "punctuality_score", "technique_score", "speed_score", "notes", "reviewer_name", "location_id", "created_at"]),
            ("gold_stars", ["id", "cook_name", "reason", "stars", "awarded_date", "location_id", "created_at", "deleted_at", "deleted_by"]),
            ("lari_conversation_turns", ["schemaVersion", "id", "location_id", "cook_id", "conversation_session_id", "user_content", "assistant_content", "manager_tier", "created_at", "expires_at"]),
            ("prep_par", ["id", "location_id", "station_id", "recipe_slug", "ingredient", "target_qty", "unit", "sort_order", "note", "created_at", "updated_at"]),
        ]
        for (table, required) in requirements {
            let cols = try columnNames(db, table)
            if cols.isEmpty { continue }  // table not created — fine
            let missing = required.filter { !cols.contains($0) }
            if !missing.isEmpty {
                throw SchemaMigratorError.schemaDrift(table: table, missing: missing, found: cols)
            }
        }
    }

    /// `PRAGMA table_info` column names; empty when the table is missing.
    static func columnNames(_ db: Database, _ table: String) throws -> [String] {
        try Row.fetchAll(db, sql: "PRAGMA table_info(\(table))").map { $0["name"] as String }
    }
}
