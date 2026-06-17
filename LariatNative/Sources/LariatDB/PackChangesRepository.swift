import Foundation
import GRDB
import LariatModel

public enum PackChangeFilter: String, Sendable {
    case open, acknowledged, all
}

public struct PackChangeWithIngredient: Decodable, FetchableRecord, Sendable, Identifiable {
    public let id: Int64
    public let vendor: String
    public let sku: String
    public let prevPack: String?
    public let newPack: String?
    public let prevPrice: Double?
    public let newPrice: Double?
    public let detectedAt: String?
    public let acknowledged: Bool
    public let ingredient: String?
    public let priceDeltaPct: Double?

    enum CodingKeys: String, CodingKey {
        case id, vendor, sku, ingredient, acknowledged
        case prevPack = "prev_pack"
        case newPack = "new_pack"
        case prevPrice = "prev_price"
        case newPrice = "new_price"
        case detectedAt = "detected_at"
        case priceDeltaPct = "price_delta_pct"
    }
}

public struct AcknowledgePackChangeResult: Sendable {
    public let found: Bool
    public let wasAlreadyAcknowledged: Bool
    public let row: PackSizeChangeRow?
}

public struct PackSizeChangeRow: FetchableRecord, Decodable, Sendable {
    public let id: Int64
    public let vendor: String
    public let sku: String
    public let prevPack: String?
    public let newPack: String?
    public let prevPrice: Double?
    public let newPrice: Double?
    public let detectedAt: String?
    public let acknowledged: Bool

    enum CodingKeys: String, CodingKey {
        case id, vendor, sku, acknowledged
        case prevPack = "prev_pack"
        case newPack = "new_pack"
        case prevPrice = "prev_price"
        case newPrice = "new_price"
        case detectedAt = "detected_at"
    }
}

public struct PackChangesRepository {
    private let database: LariatWriteDatabase
    private let auditLogger: ManagementAuditLogger

    public init(database: LariatWriteDatabase, auditLogger: ManagementAuditLogger = ManagementAuditLogger()) {
        self.database = database
        self.auditLogger = auditLogger
    }

    public func unacknowledgedCount() throws -> Int {
        try database.pool.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM pack_size_changes WHERE acknowledged = 0") ?? 0
        }
    }

    public func list(
        filter: PackChangeFilter = .open,
        vendorPrefix: String? = nil,
        limit: Int = 200
    ) throws -> [PackChangeWithIngredient] {
        let capped = max(1, min(1000, limit))
        var whereClauses: [String] = []
        var args: [DatabaseValueConvertible] = []
        switch filter {
        case .open: whereClauses.append("psc.acknowledged = 0")
        case .acknowledged: whereClauses.append("psc.acknowledged = 1")
        case .all: break
        }
        if let v = vendorPrefix?.trimmingCharacters(in: .whitespacesAndNewlines), !v.isEmpty {
            whereClauses.append("LOWER(psc.vendor) LIKE LOWER(?)")
            args.append("\(v)%")
        }
        let whereSql = whereClauses.isEmpty ? "" : "WHERE \(whereClauses.joined(separator: " AND "))"
        let sql = """
          SELECT psc.id, psc.vendor, psc.sku,
                 psc.prev_pack, psc.new_pack,
                 psc.prev_price, psc.new_price,
                 psc.detected_at, psc.acknowledged,
                 vp.ingredient AS ingredient,
                 CASE
                   WHEN psc.prev_price IS NULL OR psc.new_price IS NULL OR psc.prev_price = 0 THEN NULL
                   ELSE (psc.new_price - psc.prev_price) / psc.prev_price
                 END AS price_delta_pct
            FROM pack_size_changes psc
            LEFT JOIN (
              SELECT vendor, sku, ingredient,
                     ROW_NUMBER() OVER (PARTITION BY vendor, sku ORDER BY id DESC) AS rn
                FROM vendor_prices
            ) vp ON vp.vendor = psc.vendor AND vp.sku = psc.sku AND vp.rn = 1
            \(whereSql)
           ORDER BY psc.detected_at DESC, psc.id DESC
           LIMIT ?
        """
        args.append(capped)
        return try database.pool.read { db in
            let rows = try Row.fetchAll(db, sql: sql, arguments: StatementArguments(args))
            return rows.map { row in
                PackChangeWithIngredient(
                    id: row["id"],
                    vendor: row["vendor"],
                    sku: row["sku"],
                    prevPack: row["prev_pack"],
                    newPack: row["new_pack"],
                    prevPrice: row["prev_price"],
                    newPrice: row["new_price"],
                    detectedAt: row["detected_at"],
                    acknowledged: (row["acknowledged"] as Int) == 1,
                    ingredient: row["ingredient"],
                    priceDeltaPct: row["price_delta_pct"]
                )
            }
        }
    }

    public func acknowledge(id: Int64, note: String?) throws -> AcknowledgePackChangeResult {
        var auditPayload: (PackSizeChangeRow, String?)?
        let result = try database.write { db -> AcknowledgePackChangeResult in
            guard let row = try PackSizeChangeRow.fetchOne(db, sql: "SELECT * FROM pack_size_changes WHERE id = ?", arguments: [id]) else {
                return AcknowledgePackChangeResult(found: false, wasAlreadyAcknowledged: false, row: nil)
            }
            if row.acknowledged {
                return AcknowledgePackChangeResult(found: true, wasAlreadyAcknowledged: true, row: row)
            }
            try db.execute(sql: "UPDATE pack_size_changes SET acknowledged = 1 WHERE id = ?", arguments: [id])
            let updated = PackSizeChangeRow(
                id: row.id, vendor: row.vendor, sku: row.sku,
                prevPack: row.prevPack, newPack: row.newPack,
                prevPrice: row.prevPrice, newPrice: row.newPrice,
                detectedAt: row.detectedAt, acknowledged: true
            )
            auditPayload = (row, note)
            return AcknowledgePackChangeResult(found: true, wasAlreadyAcknowledged: false, row: updated)
        }
        if let (row, note) = auditPayload {
            do {
                try auditLogger.logPackSizeAcknowledged(
                    packSizeChangesId: row.id,
                    vendor: row.vendor,
                    sku: row.sku,
                    prevPack: row.prevPack,
                    newPack: row.newPack,
                    note: note?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? note : nil
                )
            } catch {
                // Match web: DB ack stands; audit failure is logged only.
                fputs("pack-size ack audit write failed: \(error)\n", stderr)
            }
        }
        return result
    }
}
