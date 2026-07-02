import Foundation
import GRDB
import LariatModel

/// Reads `dish_components` + `vendor_prices_history` (both web-owned tables in
/// the shared lariat.db) and feeds `MarginDeltasCompute` — the SQL half of the
/// `lib/marginDeltas.ts#listMarginDeltas` port. Mirrors the
/// `ManagementRollupRepository.loadPriceShocks` / `PriceShockSummary` precedent
/// that powers the sibling "Price moves" Command tile.
///
/// Read-only: goes through `LariatDatabase` (never `LariatWriteDatabase`); this
/// surface performs no regulated writes.
public struct MarginDeltasRepository {
    let database: LariatDatabase
    let locationId: String

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    public func load(options: MarginDeltaOptions) async throws -> [MarginDeltaRow] {
        let sinceModifier = "-\(options.windowDays) days"
        return try await database.pool.read { db in
            // Components scoped to location, ordered dish_name, id — the compute
            // relies on stable dish insertion order for its output ordering.
            let componentRows = try Row.fetchAll(db, sql: """
                SELECT dish_name, component_type, recipe_slug, vendor_ingredient, qty_per_serving
                  FROM dish_components
                 WHERE location_id = ?
                 ORDER BY dish_name, id
                """, arguments: [options.locationId])
            if componentRows.isEmpty { return [] }
            let components = componentRows.map { r in
                MarginDishComponent(
                    dishName: r["dish_name"],
                    componentType: r["component_type"],
                    recipeSlug: r["recipe_slug"],
                    vendorIngredient: r["vendor_ingredient"],
                    qtyPerServing: Self.decodeQty(r["qty_per_serving"]))
            }

            // Snapshots within the window, ordered ingredient, vendor, sku,
            // snapshot_at ASC, id ASC — so first-seen == baseline, last == latest.
            let snapRows = try Row.fetchAll(db, sql: """
                SELECT vendor, sku, ingredient, snapshot_at, unit_price
                  FROM vendor_prices_history
                 WHERE location_id = ?
                   AND snapshot_at >= datetime('now', ?)
                   AND vendor IS NOT NULL AND sku IS NOT NULL
                   AND unit_price IS NOT NULL AND ingredient IS NOT NULL
                 ORDER BY ingredient, vendor, sku, snapshot_at ASC, id ASC
                """, arguments: [options.locationId, sinceModifier])
            let snapshots = snapRows.map { r in
                MarginSnapshot(vendor: r["vendor"], sku: r["sku"], ingredient: r["ingredient"],
                               snapshotAt: r["snapshot_at"], unitPrice: r["unit_price"])
            }

            return MarginDeltasCompute.compute(components: components, snapshots: snapshots, options: options)
        }
    }

    /// Command-tile summary: total/up/down over the given window.
    /// Command passes 7 / 5 / 100 (lib/commandCenter.ts:366) — the defaults here.
    public func summary(windowDays: Int = 7, minPctMove: Double = 5, limit: Int = 100) async throws -> CommandCompute.MoveSummary {
        let rows = try await load(options: MarginDeltaOptions(
            locationId: locationId, windowDays: windowDays, minPctMove: minPctMove, limit: limit))
        return CommandCompute.MoveSummary(
            total: rows.count,
            up: rows.filter { $0.direction == .up }.count,
            down: rows.filter { $0.direction == .down }.count)
    }

    /// `qty_per_serving` is REAL in schema but may decode as Int for whole
    /// values on some rows; fall back to Int then NaN so the compute's
    /// non-finite/≤0 skip handles a genuinely missing/bad value.
    private static func decodeQty(_ value: DatabaseValue) -> Double {
        if let d = Double.fromDatabaseValue(value) { return d }
        if let i = Int.fromDatabaseValue(value) { return Double(i) }
        return .nan
    }
}
