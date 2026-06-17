import Foundation
import GRDB
import LariatModel

public struct AccountingVarianceView: Equatable {
    public let theoreticalCogs: Double
    public let actualCogs: Double
    public let variancePct: Double?
}

public struct DishCoverageView: Equatable {
    public let coveragePct: Double?
    public let totalDishes: Int?
    public let coveredDishes: Int?
}

/// B3 — last costing ingest run, with age in whole minutes since started_at.
/// Mirrors readLastCostingIngest() in lib/costingBenchmarks.mjs.
public struct CostingIngestView: Equatable {
    public let lastRunAt: String
    public let lastStatus: String?
    public let ageMinutes: Int?
}

/// Price-shock summary (7-day window, ≥5% move, limit 100).
/// Mirrors readPriceShockSummary() in app/management/page.jsx which calls
/// listPriceShocks(db, { location_id, windowDays:7, minPctMove:5, limit:100 }).
public struct PriceShockSummary: Equatable {
    public let total: Int
    public let up: Int
    public let down: Int
}

public struct RollupSnapshot: Equatable {
    public let variance: AccountingVarianceView?
    public let coverage: DishCoverageView?
    public let unacknowledgedPackSizeChanges: Int
    /// B3 — nil when no costing run exists in ingest_runs.
    public let lastCostingIngest: CostingIngestView?
    /// Price shocks over 7-day / 5% threshold; nil on query error.
    public let priceShocks: PriceShockSummary?
    /// Count of unresolved depletion exceptions (limit 100). Mirror of
    /// listDepletionExceptions(db, { location_id, limit:100 }).length.
    public let depletionExceptionCount: Int
}

public struct ManagementRollupRepository {
    let database: LariatDatabase
    let locationId: String

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    public func load() async throws -> RollupSnapshot {
        try await database.pool.read { db in
            let v = try AccountingVariance.fetchOne(db,
                sql: "SELECT * FROM accounting_variance WHERE location_id = ? ORDER BY snapshot_at DESC, id DESC LIMIT 1",
                arguments: [locationId])
            let c = try DishCoverageSnapshot.fetchOne(db,
                sql: "SELECT * FROM dish_coverage_snapshots WHERE location_id = ? ORDER BY snapshot_at DESC, id DESC LIMIT 1",
                arguments: [locationId])
            let unack = try Int.fetchOne(db,
                sql: "SELECT COUNT(*) FROM pack_size_changes WHERE acknowledged = 0") ?? 0

            // B3 — costing ingest freshness.
            // Mirrors readLastCostingIngest() in lib/costingBenchmarks.mjs.
            // ingest_runs has no location_id; scoped at application layer (matches web).
            let ingestView: CostingIngestView? = try {
                guard let row = try Row.fetchOne(db,
                    sql: """
                        SELECT id, kind, started_at, finished_at, rows_in, rows_out, status
                          FROM ingest_runs
                         WHERE kind = 'costing'
                         ORDER BY started_at DESC, id DESC
                         LIMIT 1
                        """) else { return nil }
                let startedAt: String = row["started_at"]
                let status: String? = row["status"]
                // Append 'Z' if absent so Date parsing treats it as UTC, not local time.
                // (matches the JS: /Z$/.test(row.started_at) ? row.started_at : `${row.started_at}Z`)
                // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" (space separator, no T/Z).
                // Normalize to ISO 8601 with T separator and Z suffix before parsing.
                let normalized: String
                if startedAt.hasSuffix("Z") {
                    normalized = startedAt
                } else {
                    // Replace first space with 'T' to satisfy ISO8601DateFormatter
                    normalized = startedAt.replacingOccurrences(of: " ", with: "T", options: [], range: startedAt.range(of: " ")) + "Z"
                }
                var ageMinutes: Int? = nil
                let fmt = ISO8601DateFormatter()
                if let t = fmt.date(from: normalized) {
                    let elapsed = Date().timeIntervalSince(t)
                    if elapsed.isFinite {
                        ageMinutes = max(0, Int(elapsed / 60))
                    }
                }
                return CostingIngestView(lastRunAt: startedAt, lastStatus: status, ageMinutes: ageMinutes)
            }()

            // Price-shock summary.
            // Mirrors readPriceShockSummary(db, locationId) → listPriceShocks(db, {
            //   location_id, windowDays:7, minPctMove:5, limit:100 })
            // SQL unions vendor_prices_history (within 7-day window) with vendor_prices (live),
            // groups by (vendor, sku, ingredient), computes delta_pct, filters |delta| >= 5%.
            let priceShocks: PriceShockSummary? = try {
                let sinceModifier = "-7 days"
                let minPctMove: Double = 5.0
                let limit = 100
                // Collect all in-window rows ordered ascending (oldest first per group).
                struct PriceRow: FetchableRecord {
                    let vendor: String
                    let sku: String
                    let ingredient: String
                    let snapshotAt: String
                    let unitPrice: Double
                    init(row: Row) {
                        vendor = row["vendor"]
                        sku = row["sku"]
                        ingredient = row["ingredient"]
                        snapshotAt = row["snapshot_at"]
                        unitPrice = row["unit_price"]
                    }
                }
                let rows = try Row.fetchAll(db,
                    sql: """
                        SELECT vendor, sku, ingredient, snapshot_at, unit_price
                          FROM (
                            SELECT vendor, sku, ingredient,
                                   snapshot_at, unit_price,
                                   0 AS source_order, id AS row_order
                              FROM vendor_prices_history
                             WHERE location_id = ?
                               AND snapshot_at >= datetime('now', ?)
                               AND vendor IS NOT NULL
                               AND sku IS NOT NULL
                               AND unit_price IS NOT NULL
                            UNION ALL
                            SELECT vendor, sku, ingredient,
                                   COALESCE(imported_at, datetime('now')) AS snapshot_at,
                                   unit_price,
                                   1 AS source_order, id AS row_order
                              FROM vendor_prices
                             WHERE location_id = ?
                               AND COALESCE(imported_at, datetime('now')) >= datetime('now', ?)
                               AND vendor IS NOT NULL
                               AND sku IS NOT NULL
                               AND unit_price IS NOT NULL
                          )
                         ORDER BY vendor, sku, ingredient,
                                  snapshot_at ASC, source_order ASC, row_order ASC
                        """,
                    arguments: [locationId, sinceModifier, locationId, sinceModifier])

                // Group by (vendor|sku|ingredient): track baseline (first) and latest (last).
                typealias GroupKey = String
                struct Group {
                    var baselinePrice: Double
                    var latestPrice: Double
                    var pointCount: Int
                }
                var groups: [GroupKey: Group] = [:]
                for row in rows {
                    let vendor: String = row["vendor"]
                    let sku: String = row["sku"]
                    let ingredient: String = row["ingredient"]
                    let unitPrice: Double = row["unit_price"]
                    let key = "\(vendor)|\(sku)|\(ingredient)"
                    if var g = groups[key] {
                        g.latestPrice = unitPrice
                        g.pointCount += 1
                        groups[key] = g
                    } else {
                        groups[key] = Group(baselinePrice: unitPrice, latestPrice: unitPrice, pointCount: 1)
                    }
                }

                // Live vendor_prices overlay: update latestPrice for groups already in window.
                let liveRows = try Row.fetchAll(db,
                    sql: """
                        SELECT vendor, sku, ingredient, unit_price
                          FROM vendor_prices
                         WHERE location_id = ?
                           AND vendor IS NOT NULL AND sku IS NOT NULL AND unit_price IS NOT NULL
                        """,
                    arguments: [locationId])
                for row in liveRows {
                    let vendor: String = row["vendor"]
                    let sku: String = row["sku"]
                    let ingredient: String = row["ingredient"]
                    let unitPrice: Double = row["unit_price"]
                    let key = "\(vendor)|\(sku)|\(ingredient)"
                    if var g = groups[key] {
                        g.latestPrice = unitPrice
                        groups[key] = g
                    }
                }

                // Compute shocks: require ≥2 data points, baseline > 0, |delta| ≥ minPctMove.
                var shockRows: [(deltaPct: Double, direction: String)] = []
                for g in groups.values {
                    guard g.pointCount >= 2, g.baselinePrice > 0 else { continue }
                    let delta = (g.latestPrice - g.baselinePrice) / g.baselinePrice * 100.0
                    guard abs(delta) >= minPctMove else { continue }
                    shockRows.append((deltaPct: delta, direction: delta > 0 ? "up" : "down"))
                }
                // Sort by absolute delta DESC, cap at limit.
                shockRows.sort { abs($0.deltaPct) > abs($1.deltaPct) }
                let capped = shockRows.prefix(limit)
                let total = capped.count
                let up = capped.filter { $0.direction == "up" }.count
                let down = capped.filter { $0.direction == "down" }.count
                return PriceShockSummary(total: total, up: up, down: down)
            }()

            // Depletion exception count.
            // Mirrors listDepletionExceptions(db, { location_id, limit:100 }).length
            // in app/management/page.jsx. We replicate the resolver logic:
            // scan unique dish names from sales_lines, check dish_components; those
            // with NO matching component row are counted as exceptions.
            let depletionExceptionCount: Int = try {
                // Collect distinct non-empty item_names with quantity_sold > 0.
                let names = try String.fetchAll(db,
                    sql: """
                        SELECT DISTINCT TRIM(item_name) AS item_name
                          FROM sales_lines
                         WHERE location_id = ?
                           AND quantity_sold > 0
                           AND item_name IS NOT NULL
                           AND TRIM(item_name) != ''
                        """,
                    arguments: [locationId])
                var count = 0
                for name in names {
                    let hasComponents = try Int.fetchOne(db,
                        sql: """
                            SELECT COUNT(*) FROM dish_components
                             WHERE LOWER(TRIM(dish_name)) = LOWER(TRIM(?))
                               AND location_id = ?
                            """,
                        arguments: [name, locationId]) ?? 0
                    if hasComponents == 0 { count += 1 }
                }
                return count
            }()

            return RollupSnapshot(
                variance: v.map { AccountingVarianceView(theoreticalCogs: $0.theoreticalCogs, actualCogs: $0.actualCogs, variancePct: $0.variancePct) },
                coverage: c.map { DishCoverageView(coveragePct: $0.coveragePct, totalDishes: $0.totalDishes, coveredDishes: $0.coveredDishes) },
                unacknowledgedPackSizeChanges: unack,
                lastCostingIngest: ingestView,
                priceShocks: priceShocks,
                depletionExceptionCount: depletionExceptionCount)
        }
    }
}

extension ManagementRollupRepository {
    /// Re-queries every `interval`. SwiftUI consumes this to refresh tiles, since the
    /// web app writes the shared DB from another process (GRDB ValueObservation can't see that).
    public func stream(every interval: Duration = .seconds(3)) -> AsyncStream<RollupSnapshot> {
        AsyncStream { continuation in
            let task = Task {
                while !Task.isCancelled {
                    if let snap = try? await load() { continuation.yield(snap) }
                    try? await Task.sleep(for: interval)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
