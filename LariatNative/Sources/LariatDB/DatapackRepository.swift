import Foundation
import GRDB
import LariatModel

/// Read-only client for the Lariat Data Pack indexes — parity with the
/// lexical/direct-lookup/stats surface of `lib/datapackSearch.ts`.
///
/// The data pack lives off-tree: root = the `<dataDir>/lariat-data` symlink,
/// else `LARIAT_DATA_ROOT`. When neither resolves (common on machines
/// without the SSD), the repository is a NO-OP: `isAvailable == false`,
/// searches return `[]`, lookups return nil — never a throw at init.
///
/// Both databases open read-only (FTS db as the connection, source db
/// ATTACHed `AS src`) plus `PRAGMA query_only = ON` — the web's
/// belt-and-braces guarantee that API misuse can't mutate the indexes.
///
/// NOT PORTED (deliberate, documented in the plan doc): `semantic()` /
/// `hybrid()` / `prewarmDataPack()` — they require the BGE-small ONNX
/// embedding model (transformers.js) plus multi-GB vectors.npy buckets.
/// Native ships lexical BM25 + direct lookups + stats.
public final class DatapackRepository {
    private let queue: DatabaseQueue?
    public let dataRoot: String?

    public var isAvailable: Bool { queue != nil }

    /// Resolve the data root the same way the web does: the in-repo symlink
    /// at `<dataDir>/lariat-data` first, then `LARIAT_DATA_ROOT`.
    public static func resolveDataRoot(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) -> String? {
        let fm = FileManager.default
        let symlink = (resolveDataDirectory(env: env, cwd: cwd) as NSString)
            .appendingPathComponent("lariat-data")
        if fm.fileExists(atPath: symlink) {
            return (try? fm.destinationOfSymbolicLink(atPath: symlink))
                .map { dest in
                    (dest as NSString).isAbsolutePath
                        ? dest
                        : ((symlink as NSString).deletingLastPathComponent as NSString)
                            .appendingPathComponent(dest)
                } ?? symlink
        }
        if let envRoot = env["LARIAT_DATA_ROOT"], fm.fileExists(atPath: envRoot) {
            return envRoot
        }
        return nil
    }

    public convenience init(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) {
        self.init(dataRoot: Self.resolveDataRoot(env: env, cwd: cwd))
    }

    /// `dataRoot: nil` (or missing index files) → unavailable no-op client.
    public init(dataRoot: String?) {
        let fm = FileManager.default
        guard let dataRoot else {
            self.dataRoot = nil
            self.queue = nil
            return
        }
        let sqlitePath = (dataRoot as NSString)
            .appendingPathComponent("indexes/sqlite/lariat_data.db")
        let ftsPath = (dataRoot as NSString)
            .appendingPathComponent("indexes/search/fts/lariat_fts.db")
        guard fm.fileExists(atPath: sqlitePath), fm.fileExists(atPath: ftsPath) else {
            self.dataRoot = nil
            self.queue = nil
            return
        }

        var config = Configuration()
        config.readonly = true
        do {
            let queue = try DatabaseQueue(path: ftsPath, configuration: config)
            try queue.inDatabase { db in
                // Parameterized ATTACH — path may contain apostrophes
                // ("Sean's SSD"), same reasoning as the web client.
                try db.execute(sql: "ATTACH DATABASE ? AS src", arguments: [sqlitePath])
                try db.execute(sql: "PRAGMA query_only = ON")
            }
            self.dataRoot = dataRoot
            self.queue = queue
        } catch {
            self.dataRoot = nil
            self.queue = nil
        }
    }

    // ── FTS5 lexical search ─────────────────────────────────────────────

    /// Per-source FTS query templates — verbatim from `lib/datapackSearch.ts
    /// FTS_SQL` (fixed SQL so the prepared-statement cache hits; MATCH and
    /// LIMIT bound).
    private static let ftsSQL: [DatapackSource: String] = [
        .usda: """
            SELECT bm25(usda_foods_fts) AS score,
                   f.fdc_id           AS id,
                   f.description      AS title,
                   f.food_category    AS subtitle,
                   f.source_archive   AS extra
            FROM usda_foods_fts AS s
            JOIN src.usda_foods AS f ON f.fdc_id = s.rowid
            WHERE usda_foods_fts MATCH ?
            ORDER BY score
            LIMIT ?
            """,
        .off: """
            SELECT bm25(off_products_fts) AS score,
                   f.code         AS id,
                   f.product_name AS title,
                   f.brands       AS subtitle,
                   f.brand_owner  AS extra
            FROM off_products_fts AS s
            JOIN off_products_codes AS m ON m.fts_rowid = s.rowid
            JOIN src.off_products AS f ON f.code = m.code
            WHERE off_products_fts MATCH ?
            ORDER BY score
            LIMIT ?
            """,
        .wikibooks: """
            SELECT bm25(wikibooks_pages_fts) AS score,
                   f.page_id    AS id,
                   f.title      AS title,
                   f.slug       AS subtitle,
                   f.source_url AS extra
            FROM wikibooks_pages_fts AS s
            JOIN src.wikibooks_pages AS f ON f.page_id = s.rowid
            WHERE wikibooks_pages_fts MATCH ?
            ORDER BY score
            LIMIT ?
            """,
        .fda: """
            SELECT bm25(fda_food_code_sections_fts) AS score,
                   f.rowid                        AS id,
                   f.title                        AS title,
                   COALESCE(f.section_id, '')      AS subtitle,
                   COALESCE(f.chapter, f.annex, '') AS extra
            FROM fda_food_code_sections_fts AS s
            JOIN src.fda_food_code_sections AS f ON f.rowid = s.rowid
            WHERE fda_food_code_sections_fts MATCH ?
            ORDER BY score
            LIMIT ?
            """,
    ]

    /// BM25 lexical search over one source or `.all` (merged, sorted by
    /// ascending score — lower is better). `query` is a raw FTS5 MATCH
    /// expression; wrap user input with
    /// `DatapackSearchCompute.escapeFtsPhrase` first. Returns `[]` when the
    /// pack isn't available or the query is blank. Throws on FTS5 syntax
    /// errors (the route maps those to 400).
    public func fts(
        _ query: String, source: DatapackSource = .all, limit: Int? = nil
    ) throws -> [DatapackFtsHit] {
        guard let queue else { return [] }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        let clamped = DatapackSearchCompute.clampLibLimit(limit)

        if source == .all {
            var merged: [DatapackFtsHit] = []
            for s in DatapackSource.concrete {
                merged.append(contentsOf: try ftsOne(queue, source: s, query: trimmed, limit: clamped))
            }
            merged.sort { $0.score < $1.score }
            return merged
        }
        return try ftsOne(queue, source: source, query: trimmed, limit: clamped)
    }

    private func ftsOne(
        _ queue: DatabaseQueue, source: DatapackSource, query: String, limit: Int
    ) throws -> [DatapackFtsHit] {
        guard let sql = Self.ftsSQL[source] else { return [] }
        return try queue.read { db in
            try Row.fetchAll(db, sql: sql, arguments: [query, limit]).map { row in
                // `id` is INTEGER for usda/wikibooks/fda and TEXT for off —
                // stringify via storage to avoid a lossy typed conversion.
                let idValue: DatabaseValue = row["id"]
                let id: String
                switch idValue.storage {
                case .int64(let n): id = String(n)
                case .string(let s): id = s
                case .double(let d): id = JsValueFormat.numberString(d)
                default: id = ""
                }
                return DatapackFtsHit(
                    score: row["score"] as Double? ?? 0,
                    source: source,
                    hitId: id,
                    title: row["title"],
                    subtitle: row["subtitle"],
                    extra: row["extra"])
            }
        }
    }

    // ── Direct lookups ──────────────────────────────────────────────────

    public func usdaFood(fdcId: Int64) throws -> UsdaFood? {
        guard let queue else { return nil }
        return try queue.read { db in
            try UsdaFood.fetchOne(db,
                sql: "SELECT * FROM src.usda_foods WHERE fdc_id = ?", arguments: [fdcId])
        }
    }

    public func usdaNutrients(fdcId: Int64) throws -> [UsdaNutrient] {
        guard let queue else { return [] }
        return try queue.read { db in
            try UsdaNutrient.fetchAll(db, sql: """
                SELECT nutrient_id, nutrient_name, amount, unit_name
                FROM src.usda_nutrients
                WHERE fdc_id = ?
                ORDER BY nutrient_name
                """, arguments: [fdcId])
        }
    }

    public func offProduct(code: String) throws -> OffProduct? {
        guard let queue else { return nil }
        return try queue.read { db in
            try OffProduct.fetchOne(db,
                sql: "SELECT * FROM src.off_products WHERE code = ?", arguments: [code])
        }
    }

    public func fdaSection(sectionId: String) throws -> FdaSection? {
        guard let queue else { return nil }
        return try queue.read { db in
            try FdaSection.fetchOne(db,
                sql: "SELECT rowid, * FROM src.fda_food_code_sections WHERE section_id = ? LIMIT 1",
                arguments: [sectionId])
        }
    }

    public func fdaSection(rowid: Int64) throws -> FdaSection? {
        guard let queue else { return nil }
        return try queue.read { db in
            try FdaSection.fetchOne(db,
                sql: "SELECT rowid, * FROM src.fda_food_code_sections WHERE rowid = ?",
                arguments: [rowid])
        }
    }

    public func wikibooksPage(pageId: Int64) throws -> WikibooksPage? {
        guard let queue else { return nil }
        return try queue.read { db in
            try WikibooksPage.fetchOne(db,
                sql: "SELECT * FROM src.wikibooks_pages WHERE page_id = ?", arguments: [pageId])
        }
    }

    public func wikibooksPage(title: String) throws -> WikibooksPage? {
        guard let queue else { return nil }
        return try queue.read { db in
            try WikibooksPage.fetchOne(db,
                sql: "SELECT * FROM src.wikibooks_pages WHERE title = ? LIMIT 1", arguments: [title])
        }
    }

    // ── Stats ───────────────────────────────────────────────────────────

    private static let sqliteStatTables = [
        "usda_foods", "usda_nutrients", "off_products",
        "wikibooks_pages", "fda_food_code_sections", "off_allergens",
    ]
    private static let ftsStatTables = [
        "usda_foods_fts", "off_products_fts",
        "wikibooks_pages_fts", "fda_food_code_sections_fts",
    ]

    /// Row counts per indexed table; nil when the pack isn't available.
    public func stats() throws -> DatapackStats? {
        guard let queue else { return nil }
        return try queue.read { db in
            var sqlite: [String: Int] = [:]
            for table in Self.sqliteStatTables {
                sqlite[table] = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM src.\(table)") ?? 0
            }
            var fts: [String: Int] = [:]
            for table in Self.ftsStatTables {
                fts[table] = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM \(table)") ?? 0
            }
            return DatapackStats(sqlite: sqlite, fts: fts)
        }
    }
}
