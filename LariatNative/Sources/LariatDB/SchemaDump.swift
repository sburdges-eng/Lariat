import Foundation
import GRDB

/// Normalized schema/seed dumps used by the Phase C2 schema-parity tests and
/// (later) the C4 reconciliation tooling.
///
/// This is the Swift mirror of the normalization in
/// `scripts/dump-fresh-schema.mjs` — the two MUST stay in sync:
///  - objects from `sqlite_master` with non-NULL `sql`,
///  - `sqlite_*` internals and GRDB's `grdb_migrations` bookkeeping excluded,
///  - whitespace runs collapsed to a single space, trimmed,
///  - `IF NOT EXISTS ` stripped (case-insensitive),
///  - one line per object: `<type>|<name>|<normalized sql>`, sorted.
public enum SchemaDump {

    /// Normalized one-line-per-object schema dump, sorted. Diffing two of
    /// these (or one against the committed web baseline fixture) is the
    /// C2 "schema parity" check.
    public static func normalizedLines(_ db: Database) throws -> [String] {
        let rows = try Row.fetchAll(
            db,
            sql: """
                SELECT type, name, sql FROM sqlite_master
                 WHERE sql IS NOT NULL
                   AND name NOT LIKE 'sqlite_%'
                   AND name <> 'grdb_migrations'
                """
        )
        return rows.map { row in
            let type: String = row["type"]
            let name: String = row["name"]
            let sql: String = row["sql"]
            return "\(type)|\(name)|\(normalize(sql))"
        }
        .sorted()
    }

    /// Deterministic seed-row dump: every user table that has rows, with
    /// timestamp columns excluded. Mirrors `dump-fresh-schema.mjs --seeds`.
    /// Line shape: `<table>|col=value|col=value|…`, rows sorted per table,
    /// tables in sorted order.
    public static func seedLines(_ db: Database) throws -> [String] {
        let tables = try String.fetchAll(
            db,
            sql: """
                SELECT name FROM sqlite_master
                 WHERE type = 'table'
                   AND sql IS NOT NULL
                   AND name NOT LIKE 'sqlite_%'
                   AND name <> 'grdb_migrations'
                 ORDER BY name
                """
        )
        let excluded: Set<String> = ["created_at", "updated_at", "applied_at", "imported_at"]
        var out: [String] = []
        for table in tables {
            let count = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM \"\(table)\"") ?? 0
            if count == 0 { continue }
            let cols = try Row.fetchAll(db, sql: "PRAGMA table_info(\"\(table)\")")
                .map { $0["name"] as String }
                .filter { !excluded.contains($0) }
            let select = cols.map { "\"\($0)\"" }.joined(separator: ", ")
            let rows = try Row.fetchAll(db, sql: "SELECT \(select) FROM \"\(table)\"")
            let rendered = rows.map { row in
                cols.map { "\($0)=\(render(row[$0]))" }.joined(separator: "|")
            }
            .sorted()
            out.append(contentsOf: rendered.map { "\(table)|\($0)" })
        }
        return out
    }

    /// Whitespace + `IF NOT EXISTS` normalization; see the type doc comment.
    static func normalize(_ sql: String) -> String {
        var s = sql.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        s = s.replacingOccurrences(of: "IF NOT EXISTS ", with: "", options: .caseInsensitive)
        return s
    }

    /// Value rendering matching JavaScript's `String(value)` for the value
    /// shapes better-sqlite3 produces (integral REALs print without `.0`).
    private static func render(_ value: DatabaseValue) -> String {
        switch value.storage {
        case .null:
            return "NULL"
        case .int64(let i):
            return String(i)
        case .double(let d):
            if d == d.rounded(), abs(d) < 1e15 {
                return String(Int64(d))
            }
            return String(d)
        case .string(let s):
            return s
        case .blob(let data):
            return "<blob \(data.count) bytes>"
        }
    }
}
