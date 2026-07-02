import Foundation
import GRDB
import LariatModel

/// Reads `accounting_variance`, `vendor_prices_history`, `dish_components`,
/// `audit_events`, `inventory_counts`/`inventory_count_lines`, and `sales_lines`
/// (all web-owned tables in the shared lariat.db) and feeds
/// `VarianceAttributionCompute` — the SQL half of the
/// `lib/varianceAttribution.ts#buildVarianceAttribution` port. Mirrors the
/// `MarginDeltasRepository` / `PriceShockRepository` read-only + in-Swift-normalize
/// precedent.
///
/// Read-only: goes through `LariatDatabase` (never `LariatWriteDatabase`); this
/// surface performs no regulated writes. Pure read board — no PIN gate (the web
/// route has no in-route PIN either; it is gated only by /costing middleware).
public struct VarianceAttributionRepository {
    let database: LariatDatabase
    let locationId: String

    private static let caveat =
        "Attribution is directional: these sections are evidence of what changed " +
        "inside the window, not a reconciliation — they need not sum to the variance delta."

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    public func load(from: String? = nil, to: String? = nil) async throws -> VarianceAttributionResult {
        try await database.pool.read { db in
            let hasFrom = (from?.isEmpty == false)
            let hasTo = (to?.isEmpty == false)

            var baselineRow: VarianceAttrRow?
            var currentRow: VarianceAttrRow?
            var recentCount = 0

            if hasFrom, hasTo {
                baselineRow = try Self.variancePeriodByEnd(db, locationId: locationId, periodEnd: from!)
                currentRow = try Self.variancePeriodByEnd(db, locationId: locationId, periodEnd: to!)
            } else if !hasFrom, !hasTo {
                let recent = try Self.recentPeriods(db, locationId: locationId, limit: 2)
                recentCount = recent.count
                if recent.count >= 2 {
                    currentRow = try Self.variancePeriodByEnd(db, locationId: locationId, periodEnd: recent[0].periodEnd)
                    baselineRow = try Self.variancePeriodByEnd(db, locationId: locationId, periodEnd: recent[1].periodEnd)
                }
            }
            // else: exactly one of from/to set — selectWindow handles the "both required" guard.

            let selection = VarianceAttributionCompute.selectWindow(
                baseline: baselineRow, current: currentRow,
                hasFrom: hasFrom, hasTo: hasTo, from: from, to: to, recentCount: recentCount)

            switch selection {
            case .failed(let reason):
                return VarianceAttributionResult(
                    ok: false, reason: reason, locationId: locationId,
                    window: VarianceAttrWindow(from: nil, to: nil),
                    variance: VarianceAttrDelta(baseline: nil, current: nil, deltaAmount: nil, deltaPct: nil),
                    priceMoves: [], compositionChanges: [], countCorrections: [], unresolvedDepletions: [],
                    unresolvedNote: nil, unattributed: true, caveat: Self.caveat)

            case .ok(let window, let delta):
                let windowFrom = window.from!, windowTo = window.to!

                let snaps = try Self.priceSnaps(db, locationId: locationId, from: windowFrom, to: windowTo)
                let linked = try Self.linkedIngredients(db, locationId: locationId)
                let priceMoves = VarianceAttributionCompute.priceMoves(snaps: snaps, linkedIngredients: linked)

                let compRowsWindowed = try Self.compositionRowsWindowed(db, locationId: locationId, from: windowFrom, to: windowTo)
                let compositionChanges = VarianceAttributionCompute.compositionChanges(rows: compRowsWindowed, from: windowFrom, to: windowTo)

                let audits = try Self.auditRows(db, locationId: locationId, from: windowFrom, to: windowTo)
                let closed = try Self.closedCountRows(db, locationId: locationId, from: windowFrom, to: windowTo)
                let countCorrections = VarianceAttributionCompute.countCorrections(audits: audits, closed: closed)

                let allComponents = try Self.allComponents(db, locationId: locationId)
                let dateLikeCount = try Self.dateLikeSalesCount(db, locationId: locationId)
                let totalCount = try Self.totalSalesCount(db, locationId: locationId)
                let salesRows = try Self.salesRows(db, locationId: locationId)
                let unresolved = VarianceAttributionCompute.unresolvedDepletions(
                    sales: salesRows, components: allComponents, from: windowFrom, to: windowTo,
                    dateLikeCount: dateLikeCount, totalCount: totalCount)

                let unattributed = priceMoves.isEmpty && compositionChanges.isEmpty
                    && countCorrections.isEmpty && unresolved.items.isEmpty

                return VarianceAttributionResult(
                    ok: true, reason: nil, locationId: locationId,
                    window: window, variance: delta,
                    priceMoves: priceMoves, compositionChanges: compositionChanges,
                    countCorrections: countCorrections, unresolvedDepletions: unresolved.items,
                    unresolvedNote: unresolved.note, unattributed: unattributed, caveat: Self.caveat)
            }
        }
    }

    // MARK: - SQL (5 SELECTs feeding the four sections, plus window resolution SQL)

    private static func recentPeriods(_ db: Database, locationId: String, limit: Int) throws -> [VarianceAttrRow] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT period_start, period_end FROM accounting_variance
             WHERE location_id = ? AND period_end IS NOT NULL
             ORDER BY period_end DESC, id DESC
             LIMIT ?
            """, arguments: [locationId, limit])
        return rows.map { r in
            VarianceAttrRow(periodStart: r["period_start"], periodEnd: r["period_end"],
                theoreticalCogs: nil, actualCogs: nil, varianceAmount: nil, variancePct: nil)
        }
    }

    private static func variancePeriodByEnd(_ db: Database, locationId: String, periodEnd: String) throws -> VarianceAttrRow? {
        guard let r = try Row.fetchOne(db, sql: """
            SELECT period_start, period_end, theoretical_cogs, actual_cogs, variance_amount, variance_pct
              FROM accounting_variance
             WHERE location_id = ? AND period_end = ?
             ORDER BY id DESC
             LIMIT 1
            """, arguments: [locationId, periodEnd]) else { return nil }
        return VarianceAttrRow(
            periodStart: r["period_start"], periodEnd: r["period_end"],
            theoreticalCogs: r["theoretical_cogs"], actualCogs: r["actual_cogs"],
            varianceAmount: r["variance_amount"], variancePct: r["variance_pct"])
    }

    private static func priceSnaps(_ db: Database, locationId: String, from: String, to: String) throws -> [PriceSnapRow] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT vendor, sku, ingredient, unit_price, snapshot_at
              FROM vendor_prices_history
             WHERE location_id = ?
               AND date(snapshot_at) > ? AND date(snapshot_at) <= ?
             ORDER BY snapshot_at ASC, rowid ASC
            """, arguments: [locationId, from, to])
        return rows.map { r in
            PriceSnapRow(vendor: r["vendor"], sku: r["sku"], ingredient: r["ingredient"],
                unitPrice: r["unit_price"], snapshotAt: r["snapshot_at"])
        }
    }

    private static func linkedIngredients(_ db: Database, locationId: String) throws -> Set<String> {
        let rows = try Row.fetchAll(db, sql: """
            SELECT DISTINCT vendor_ingredient FROM dish_components
             WHERE location_id = ? AND component_type = 'vendor_item'
               AND vendor_ingredient IS NOT NULL
            """, arguments: [locationId])
        return Set(rows.compactMap { $0["vendor_ingredient"] as String? })
    }

    private static func compositionRowsWindowed(_ db: Database, locationId: String, from: String, to: String) throws -> [CompRow] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT dish_name, component_type, recipe_slug, vendor_ingredient,
                   qty_per_serving, unit, created_at, updated_at
              FROM dish_components
             WHERE location_id = ?
               AND (
                 (created_at IS NOT NULL AND date(created_at) > ? AND date(created_at) <= ?)
                 OR (updated_at IS NOT NULL AND date(updated_at) > ? AND date(updated_at) <= ?)
               )
             ORDER BY COALESCE(updated_at, created_at) DESC
             LIMIT ?
            """, arguments: [locationId, from, to, from, to, VarianceAttributionCompute.sectionLimit])
        return rows.map(Self.compRow)
    }

    private static func allComponents(_ db: Database, locationId: String) throws -> [CompRow] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT dish_name, component_type, recipe_slug, vendor_ingredient,
                   qty_per_serving, unit, created_at, updated_at
              FROM dish_components
             WHERE location_id = ?
            """, arguments: [locationId])
        return rows.map(Self.compRow)
    }

    private static func compRow(_ r: Row) -> CompRow {
        CompRow(dishName: r["dish_name"], componentType: r["component_type"],
            recipeSlug: r["recipe_slug"], vendorIngredient: r["vendor_ingredient"],
            qtyPerServing: r["qty_per_serving"], unit: r["unit"],
            createdAt: r["created_at"], updatedAt: r["updated_at"])
    }

    private static func auditRows(_ db: Database, locationId: String, from: String, to: String) throws -> [AuditRow] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT entity, entity_id, action, actor_cook_id, payload_json, created_at
              FROM audit_events
             WHERE location_id = ?
               AND entity IN ('inventory_counts', 'inventory_count_lines')
               AND action IN ('update', 'correction', 'delete')
               AND date(created_at) > ? AND date(created_at) <= ?
             ORDER BY created_at DESC
             LIMIT ?
            """, arguments: [locationId, from, to, VarianceAttributionCompute.sectionLimit])
        return rows.map { r in
            AuditRow(entity: r["entity"], entityId: r["entity_id"], action: r["action"],
                actorCookId: r["actor_cook_id"], payloadJson: r["payload_json"], createdAt: r["created_at"])
        }
    }

    private static func closedCountRows(_ db: Database, locationId: String, from: String, to: String) throws -> [ClosedCountRow] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT c.id, c.label, c.count_date, c.closed_at,
                   (SELECT COUNT(*) FROM inventory_count_lines l
                     WHERE l.count_id = c.id AND l.location_id = c.location_id) AS lines
              FROM inventory_counts c
             WHERE c.location_id = ?
               AND c.closed_at IS NOT NULL
               AND date(c.closed_at) > ? AND date(c.closed_at) <= ?
             ORDER BY c.closed_at DESC
             LIMIT ?
            """, arguments: [locationId, from, to, VarianceAttributionCompute.sectionLimit])
        return rows.map { r in
            ClosedCountRow(id: r["id"], label: r["label"], countDate: r["count_date"],
                closedAt: r["closed_at"], lines: r["lines"])
        }
    }

    private static func dateLikeSalesCount(_ db: Database, locationId: String) throws -> Int {
        try Int.fetchOne(db, sql: """
            SELECT COUNT(*) FROM sales_lines
             WHERE location_id = ? AND period_label GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            """, arguments: [locationId]) ?? 0
    }

    private static func totalSalesCount(_ db: Database, locationId: String) throws -> Int {
        try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM sales_lines WHERE location_id = ?", arguments: [locationId]) ?? 0
    }

    private static func salesRows(_ db: Database, locationId: String) throws -> [SalesLineRow] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT item_name, period_label, quantity_sold, net_sales
              FROM sales_lines
             WHERE location_id = ?
            """, arguments: [locationId])
        return rows.map { r in
            SalesLineRow(itemName: r["item_name"], periodLabel: r["period_label"],
                quantitySold: r["quantity_sold"], netSales: r["net_sales"])
        }
    }
}
