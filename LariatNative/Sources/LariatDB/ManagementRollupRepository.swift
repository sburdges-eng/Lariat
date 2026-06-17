import Foundation
import GRDB
import LariatModel

public struct AccountingVarianceView: Equatable {
    public let theoreticalCogs: Double
    public let actualCogs: Double
    public let variancePct: Double?
    public let snapshotAt: String?
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
    /// Approximate depletion-exception count: counts dishes with no `dish_components` rows
    /// (the `no_dish_components` reason only). Full `listDepletionExceptions` resolver parity
    /// (recipe_missing_yield, cross_dim_unit_mismatch, invalid_qty) is deferred to Task 10.
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
            // Per-tile degrade: optional sub-queries must not fail the whole screen.
            let v = try? AccountingVariance.fetchOne(db,
                sql: "SELECT * FROM accounting_variance WHERE location_id = ? ORDER BY snapshot_at DESC, id DESC LIMIT 1",
                arguments: [locationId])
            let c = try? DishCoverageSnapshot.fetchOne(db,
                sql: "SELECT * FROM dish_coverage_snapshots WHERE location_id = ? ORDER BY snapshot_at DESC, id DESC LIMIT 1",
                arguments: [locationId])
            let unack = (try? Int.fetchOne(db,
                sql: "SELECT COUNT(*) FROM pack_size_changes WHERE acknowledged = 0")) ?? 0

            return RollupSnapshot(
                variance: v.map { AccountingVarianceView(theoreticalCogs: $0.theoreticalCogs, actualCogs: $0.actualCogs, variancePct: $0.variancePct, snapshotAt: $0.snapshotAt) },
                coverage: c.map { DishCoverageView(coveragePct: $0.coveragePct, totalDishes: $0.totalDishes, coveredDishes: $0.coveredDishes) },
                unacknowledgedPackSizeChanges: unack,
                lastCostingIngest: Self.loadCostingIngest(db),
                priceShocks: Self.loadPriceShocks(db, locationId: locationId),
                depletionExceptionCount: Self.loadDepletionExceptionCount(db, locationId: locationId))
        }
    }
}



// MARK: - Per-tile loaders (failures degrade individual tiles, not the screen)

private extension ManagementRollupRepository {

    /// Parse ingest_runs.started_at — supports SQLite datetime, ISO8601, and fractional seconds.
    static func parseIngestStartedAt(_ startedAt: String) -> Date? {
        let normalized: String
        if startedAt.hasSuffix("Z") {
            normalized = startedAt
        } else if startedAt.contains("T") {
            normalized = startedAt + "Z"
        } else if let range = startedAt.range(of: " ") {
            normalized = startedAt.replacingCharacters(in: range, with: "T") + "Z"
        } else {
            normalized = startedAt + "Z"
        }

        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: normalized) { return d }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let d = plain.date(from: normalized) { return d }

        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone(secondsFromGMT: 0)
        for pattern in ["yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'"] {
            df.dateFormat = pattern
            if let d = df.date(from: normalized) { return d }
        }
        return nil
    }

    static func loadCostingIngest(_ db: Database) -> CostingIngestView? {
        guard let row = try? Row.fetchOne(db,
            sql: """
                SELECT id, kind, started_at, finished_at, rows_in, rows_out, status
                  FROM ingest_runs
                 WHERE kind = 'costing'
                 ORDER BY started_at DESC, id DESC
                 LIMIT 1
                """) else { return nil }
        let startedAt: String = row["started_at"]
        let status: String? = row["status"]
        var ageMinutes: Int? = nil
        if let t = parseIngestStartedAt(startedAt) {
            let elapsed = Date().timeIntervalSince(t)
            if elapsed.isFinite {
                ageMinutes = max(0, Int(elapsed / 60))
            }
        }
        return CostingIngestView(lastRunAt: startedAt, lastStatus: status, ageMinutes: ageMinutes)
    }

    static func loadPriceShocks(_ db: Database, locationId: String) -> PriceShockSummary? {
        do {
            let sinceModifier = "-7 days"
            let minPctMove: Double = 5.0
            let limit = 100
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
                let ingredient: String = row["ingredient"] as String? ?? ""
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
                let ingredient: String = row["ingredient"] as String? ?? ""
                let unitPrice: Double = row["unit_price"]
                let key = "\(vendor)|\(sku)|\(ingredient)"
                if var g = groups[key] {
                    g.latestPrice = unitPrice
                    groups[key] = g
                }
            }

            var shockRows: [(deltaPct: Double, direction: String)] = []
            for g in groups.values {
                guard g.pointCount >= 2, g.baselinePrice > 0 else { continue }
                let delta = (g.latestPrice - g.baselinePrice) / g.baselinePrice * 100.0
                guard abs(delta) >= minPctMove else { continue }
                shockRows.append((deltaPct: delta, direction: delta > 0 ? "up" : "down"))
            }
            shockRows.sort { abs($0.deltaPct) > abs($1.deltaPct) }
            let capped = shockRows.prefix(limit)
            return PriceShockSummary(
                total: capped.count,
                up: capped.filter { $0.direction == "up" }.count,
                down: capped.filter { $0.direction == "down" }.count)
        } catch {
            return nil
        }
    }

    static func loadDepletionExceptionCount(_ db: Database, locationId: String) -> Int {
        do {
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
        } catch {
            return 0
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
