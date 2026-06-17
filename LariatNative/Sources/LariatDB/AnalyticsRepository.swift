import Foundation
import GRDB
import LariatModel

/// READ-ONLY repository that fetches all raw row-sets required by the Analytics
/// page (`app/analytics/page.jsx`). All queries are location-scoped.
///
/// SQL mirrors the page exactly — no aggregation is performed here; that is
/// `AnalyticsCompute.summarize`'s responsibility.
public struct AnalyticsRepository {
    let database: LariatDatabase
    let locationId: String

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    public func fetch() async throws -> AnalyticsBundle {
        return try await database.pool.read { db in

            // 1. Daily revenue trend — current period (comparison_group = 1)
            //    JS: SELECT shift_date, net_sales, orders, guests
            //          FROM toast_sales_daily WHERE location_id=? AND comparison_group=1
            //          ORDER BY shift_date
            let daily = try AnalyticsDailyRow.fetchAll(db,
                sql: """
                    SELECT shift_date, net_sales, orders, guests
                      FROM toast_sales_daily
                     WHERE location_id = ? AND comparison_group = 1
                     ORDER BY shift_date
                    """,
                arguments: [locationId])

            // 2. Day-of-week comparison — current (group=1) and prior (group=2)
            //    JS: SELECT day_of_week, net_sales, orders, guests
            //          FROM toast_sales_dow WHERE location_id=? AND comparison_group=1
            let dowCurrent = try AnalyticsDowRow.fetchAll(db,
                sql: """
                    SELECT day_of_week, net_sales, orders, guests
                      FROM toast_sales_dow
                     WHERE location_id = ? AND comparison_group = 1
                    """,
                arguments: [locationId])

            let dowPrior = try AnalyticsDowRow.fetchAll(db,
                sql: """
                    SELECT day_of_week, net_sales, orders, guests
                      FROM toast_sales_dow
                     WHERE location_id = ? AND comparison_group = 2
                    """,
                arguments: [locationId])

            // 3. Hourly revenue curve — current (group=1) and prior (group=2)
            //    JS: SELECT hour_24, label, net_sales, orders, guests
            //          FROM toast_sales_hour WHERE location_id=? AND comparison_group=1
            //          ORDER BY hour_24
            let hourlyCurrent = try AnalyticsHourlyRow.fetchAll(db,
                sql: """
                    SELECT hour_24, label, net_sales, orders, guests
                      FROM toast_sales_hour
                     WHERE location_id = ? AND comparison_group = 1
                     ORDER BY hour_24
                    """,
                arguments: [locationId])

            let hourlyPrior = try AnalyticsHourlyRow.fetchAll(db,
                sql: """
                    SELECT hour_24, label, net_sales, orders, guests
                      FROM toast_sales_hour
                     WHERE location_id = ? AND comparison_group = 2
                     ORDER BY hour_24
                    """,
                arguments: [locationId])

            // 4. Monthly Shamrock spend
            //    JS: SELECT month, shamrock_total_spend FROM spend_monthly
            //          WHERE location_id=? ORDER BY month
            let spend = try AnalyticsSpendRow.fetchAll(db,
                sql: """
                    SELECT month, shamrock_total_spend
                      FROM spend_monthly
                     WHERE location_id = ?
                     ORDER BY month
                    """,
                arguments: [locationId])

            // 5. Top selling items (up to 20)
            //    JS: SELECT item_name, SUM(quantity_sold) as qty, SUM(net_sales) as rev
            //          FROM sales_lines WHERE location_id=? GROUP BY item_name
            //          ORDER BY rev DESC LIMIT 20
            let top = try AnalyticsTopItem.fetchAll(db,
                sql: """
                    SELECT item_name, SUM(quantity_sold) AS qty, SUM(net_sales) AS rev
                      FROM sales_lines
                     WHERE location_id = ?
                     GROUP BY item_name
                     ORDER BY rev DESC
                     LIMIT 20
                    """,
                arguments: [locationId])

            // 6. Prior-period total revenue (comparison_group = 2)
            //    JS: SELECT SUM(net_sales) as rev FROM toast_sales_daily
            //          WHERE location_id=? AND comparison_group=2
            //    `dailyPrior?.rev || 0` → default to 0 when nil
            let priorRevRow = try AnalyticsPriorRev.fetchOne(db,
                sql: """
                    SELECT SUM(net_sales) AS rev
                      FROM toast_sales_daily
                     WHERE location_id = ? AND comparison_group = 2
                    """,
                arguments: [locationId])
            let dailyPriorRev = priorRevRow?.rev ?? 0.0

            // 7. Date range from current period (LIMIT 1)
            //    JS: SELECT date_range FROM toast_sales_daily
            //          WHERE location_id=? AND comparison_group=1 LIMIT 1
            let dateRangeRow = try AnalyticsDateRange.fetchOne(db,
                sql: """
                    SELECT date_range
                      FROM toast_sales_daily
                     WHERE location_id = ? AND comparison_group = 1
                     LIMIT 1
                    """,
                arguments: [locationId])
            let dateRange = dateRangeRow?.dateRange

            return AnalyticsBundle(
                daily: daily,
                dowCurrent: dowCurrent,
                dowPrior: dowPrior,
                hourlyCurrent: hourlyCurrent,
                hourlyPrior: hourlyPrior,
                spend: spend,
                top: top,
                dailyPriorRev: dailyPriorRev,
                dateRange: dateRange
            )
        }
    }
}
