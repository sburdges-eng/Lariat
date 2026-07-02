import Foundation
import GRDB
import LariatModel

/// READ-ONLY repository for the menu-engineering hub board
/// (`app/menu-engineering/page.tsx`). Fetches:
///   1. Raw aggregated sales — the page's SQL has NO quantity_sold filter;
///      TOTAL/TOTALS footer noise is dropped downstream by
///      `DishCostBridge.cleanedSalesRows` (exactly like the web).
///   2. Dish-cost bridge inputs — via `CostingRepository.fetchBridgeInputs`
///      (single owner of that SQL; do not duplicate it).
///   3. "Compute Engine Last Ran" — latest `margin_snapshots.snapshot_at`
///      (page.tsx L85-95); nil when the table is missing (pre-compute-engine
///      DB copies) or empty.
///
/// No compute is performed here; the ViewModel runs
/// `DishCostBridge.buildDishComponentMap` + `computeMenuEngineering` +
/// `computeDishCoverage` on the bundle.
public struct MenuEngineeringBundle {
    public let sales: [BridgeSalesRow]
    public let bridgeInputs: CostingRepository.DishBridgeInputs
    public let lastComputeRun: String?
}

public struct MenuEngineeringRepository {
    let database: LariatDatabase
    let locationId: String

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    public func fetch() async throws -> MenuEngineeringBundle {
        let loc = locationId
        return try await database.pool.read { db in
            // Web SQL (lib/menuEngineering.ts L60-67): plain GROUP BY, no
            // qty filter, no ORDER BY (the page sorts after classification).
            let sales: [BridgeSalesRow] = try Row.fetchAll(db,
                sql: """
                    SELECT item_name, SUM(quantity_sold) AS qty, SUM(net_sales) AS rev
                      FROM sales_lines
                     WHERE location_id = ?
                     GROUP BY item_name
                    """,
                arguments: [loc]
            ).map { r in
                BridgeSalesRow(itemName: r["item_name"], qty: r["qty"] ?? 0, rev: r["rev"] ?? 0)
            }

            let inputs = try CostingRepository.fetchBridgeInputs(db: db, locationId: loc)

            var lastRun: String?
            if try db.tableExists("margin_snapshots") {
                lastRun = try String.fetchOne(db,
                    sql: """
                        SELECT snapshot_at FROM margin_snapshots
                         WHERE location_id = ? ORDER BY id DESC LIMIT 1
                        """,
                    arguments: [loc])
            }

            return MenuEngineeringBundle(sales: sales, bridgeInputs: inputs, lastComputeRun: lastRun)
        }
    }
}
