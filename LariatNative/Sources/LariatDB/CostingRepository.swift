import Foundation
import GRDB
import LariatModel

/// READ-ONLY repository for the Costing screen (`app/costing/page.jsx`).
///
/// Fetches:
///   1. Latest variance snapshot   — reuses P0 `AccountingVariance` record + SQL pattern
///   2. Latest dish-coverage       — reuses P0 `DishCoverageSnapshot` record + SQL pattern
///   3. Aggregated sales lines     — for menu engineering + ABC computation
///   4. Variance trend rows        — for `getVarianceTrend` (28-day window, period_end column)
///
/// No aggregation or classification is performed here; that is `CostingCompute`'s job.
/// All queries are location-scoped via `locationId`.
///
/// ── Reuse note ────────────────────────────────────────────────────────────────
/// Queries 1 and 2 are deliberately identical to `ManagementRollupRepository.load()`'s
/// variance and coverage fetches (same SQL, same record types). We do NOT call
/// ManagementRollupRepository to avoid coupling two repositories; the SQL is a
/// one-liner each and the record types live in LariatModel/Records.swift.
public struct CostingRepository {
    let database: LariatDatabase
    let locationId: String

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    public func fetch() async throws -> CostingBundle {
        try await database.pool.read { db in

            // 1. Latest variance snapshot (reuse P0 AccountingVariance record)
            //    Mirrors ManagementRollupRepository.load() variance fetch.
            //    SQL: SELECT * FROM accounting_variance WHERE location_id=?
            //           ORDER BY snapshot_at DESC, id DESC LIMIT 1
            let latestVariance = try AccountingVariance.fetchOne(db,
                sql: """
                    SELECT * FROM accounting_variance
                     WHERE location_id = ?
                     ORDER BY snapshot_at DESC, id DESC
                     LIMIT 1
                    """,
                arguments: [locationId])

            // 2. Latest dish-coverage snapshot (reuse P0 DishCoverageSnapshot record)
            //    Mirrors ManagementRollupRepository.load() coverage fetch.
            //    SQL: SELECT * FROM dish_coverage_snapshots WHERE location_id=?
            //           ORDER BY snapshot_at DESC, id DESC LIMIT 1
            let latestCoverage = try DishCoverageSnapshot.fetchOne(db,
                sql: """
                    SELECT * FROM dish_coverage_snapshots
                     WHERE location_id = ?
                     ORDER BY snapshot_at DESC, id DESC
                     LIMIT 1
                    """,
                arguments: [locationId])

            // 3. Aggregated sales lines for menu engineering + ABC.
            //    Mirrors the SELECT in computeMenuEngineering() (lib/menuEngineering.ts):
            //      SELECT item_name, SUM(quantity_sold) AS qty, SUM(net_sales) AS rev
            //        FROM sales_lines WHERE location_id=? GROUP BY item_name
            //    Extended with AVG(cost_per_unit) for the native cost bridge.
            //    Filtered quantity_sold > 0 to skip TOTAL/footer rows (mirrors
            //    cleanedSalesRows() in lib/dishCostBridge.ts which drops zero-qty rows).
            //    Ordered rev DESC to match the analytics top-item convention (stable order).
            let salesLines = try CostingSalesLine.fetchAll(db,
                sql: """
                    SELECT item_name,
                           SUM(quantity_sold)  AS qty,
                           SUM(net_sales)      AS rev,
                           AVG(cost_per_unit)  AS cost_per_unit
                      FROM sales_lines
                     WHERE location_id = ?
                       AND quantity_sold > 0
                     GROUP BY item_name
                     ORDER BY rev DESC
                    """,
                arguments: [locationId])

            // 4. Variance trend rows — 28-day window relative to MAX(period_end).
            //    Mirrors getVarianceTrend() in lib/varianceTrend.ts:
            //      Step 1: find MAX(period_end) to anchor the window.
            //      Step 2: select rows where period_end >= (MAX - windowDays).
            //    Uses period_end column (added in T10 fixture extension).
            //    Rows without period_end (P0 snapshot rows) are excluded via IS NOT NULL.
            let latestPeriodEnd = try String.fetchOne(db,
                sql: """
                    SELECT MAX(period_end) FROM accounting_variance
                     WHERE location_id = ? AND period_end IS NOT NULL
                    """,
                arguments: [locationId])

            let varianceTrendRows: [CostingVarianceTrendRow]
            if let latest = latestPeriodEnd {
                // Compute cutoff: windowDays before latest period_end.
                // Use SQLite date arithmetic to stay in DB and avoid Swift Date parsing.
                varianceTrendRows = try CostingVarianceTrendRow.fetchAll(db,
                    sql: """
                        SELECT period_start, period_end, variance_amount, variance_pct
                          FROM accounting_variance
                         WHERE location_id = ?
                           AND period_end IS NOT NULL
                           AND period_end >= date(?, '-28 days')
                         ORDER BY period_end ASC
                        """,
                    arguments: [locationId, latest])
            } else {
                varianceTrendRows = []
            }

            return CostingBundle(
                latestVariance:     latestVariance,
                latestCoverage:     latestCoverage,
                salesLines:         salesLines,
                varianceTrendRows:  varianceTrendRows
            )
        }
    }
}
