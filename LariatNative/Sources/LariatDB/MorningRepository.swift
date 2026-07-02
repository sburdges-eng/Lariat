import Foundation
import GRDB
import LariatModel

// Read-only port of the query half of `lib/morningDigest.ts` (`buildMorningDigest`).
//
// The morning digest is an AGGREGATE READ — no writes, no audit. The web GET
// /api/morning returns this JSON; the web POST only fires a Slack webhook (no DB
// mutation), so nothing here goes through LariatWriteDatabase / AuditedWriteRunner.
//
// This repository reuses CommandRepository for the command-summary half, then runs
// the 4 morning-specific SELECTs (86 board, certs, maintenance, BEO prep) plus the
// price-shock ranking. The derivation (day-window filters, section shaping, Slack
// text, alerts) is MorningCompute's job — this layer is queries only.
public struct MorningRepository {
    let database: LariatDatabase
    let locationId: String

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    /// Run every SELECT the digest needs (beyond the CommandBundle) and pack a MorningBundle.
    public func fetch(today: String) async throws -> MorningBundle {
        try await database.pool.read { db in
            // ── 86 board: active (unresolved) items this shift, id DESC, limit 10 ──
            let eightySixItems = try MorningEightySixItem.fetchAll(db,
                sql: """
                    SELECT item, reason, quantity, station_id, created_at
                      FROM eighty_six
                     WHERE location_id = ? AND shift_date = ? AND resolved_at IS NULL
                     ORDER BY id DESC
                     LIMIT 10
                    """,
                arguments: [locationId, today])
            let eightySixCount = try Int.fetchOne(db,
                sql: """
                    SELECT COUNT(*)
                      FROM eighty_six
                     WHERE location_id = ? AND shift_date = ? AND resolved_at IS NULL
                    """,
                arguments: [locationId, today]) ?? 0

            // ── Price shocks: windowDays 7, minPctMove 5, limit 10 ────────────────
            let priceShocks = Self.loadPriceShocks(db, locationId: locationId)

            // ── Certs: active, non-null expires_on, expires_on ASC then cook_id ASC ─
            // Day-window filter (0…7) happens in MorningCompute.
            let certRows = try MrnCertRow.fetchAll(db,
                sql: """
                    SELECT cook_id, cert_label, cert_type, expires_on
                      FROM staff_certifications
                     WHERE location_id = ?
                       AND active = 1
                       AND expires_on IS NOT NULL
                     ORDER BY expires_on ASC, cook_id ASC
                    """,
                arguments: [locationId])

            // ── Maintenance: schedule ⋈ equipment, next_due ASC then name ASC ─────
            // days_until <= 0 filter happens in MorningCompute.
            let maintenanceRows = try MrnMaintenanceRow.fetchAll(db,
                sql: """
                    SELECT e.name AS equipment_name, s.task, s.frequency, s.next_due
                      FROM equipment_maintenance_schedule s
                      JOIN equipment e ON e.id = s.equipment_id
                     WHERE s.location_id = ?
                       AND e.location_id = ?
                       AND s.next_due IS NOT NULL
                     ORDER BY s.next_due ASC, e.name ASC
                    """,
                arguments: [locationId, locationId])

            // ── BEO prep: events on/after today with open prep tasks, limit 10 ────
            let beoRows = try MrnBeoRow.fetchAll(db,
                sql: """
                    SELECT e.id AS event_id,
                           e.title,
                           e.event_date,
                           e.event_time,
                           COALESCE(e.guest_count, 0) AS guest_count,
                           SUM(CASE WHEN COALESCE(t.done, 0) = 0 THEN 1 ELSE 0 END) AS open_tasks,
                           SUM(CASE WHEN COALESCE(t.done, 0) = 1 THEN 1 ELSE 0 END) AS done_tasks,
                           COUNT(t.id) AS total_tasks
                      FROM beo_events e
                      LEFT JOIN beo_prep_tasks t
                        ON t.event_id = e.id
                       AND t.location_id = e.location_id
                     WHERE e.location_id = ?
                       AND e.event_date >= ?
                       AND COALESCE(e.status, '') NOT IN ('cancelled', 'canceled')
                     GROUP BY e.id, e.title, e.event_date, e.event_time, e.guest_count
                    HAVING SUM(CASE WHEN COALESCE(t.done, 0) = 0 THEN 1 ELSE 0 END) > 0
                     ORDER BY e.event_date ASC, COALESCE(e.event_time, '00:00') ASC
                     LIMIT 10
                    """,
                arguments: [locationId, today])

            return MorningBundle(
                eightySixItems: eightySixItems,
                eightySixCount: eightySixCount,
                priceShocks: priceShocks,
                certRows: certRows,
                maintenanceRows: maintenanceRows,
                beoRows: beoRows)
        }
    }
}

// MARK: - Price shocks (full listPriceShocks port, windowDays 7 / minPct 5 / limit 10)

extension MorningRepository {
    /// Port of `listPriceShocks(db, { windowDays:7, minPctMove:5, limit:10 })` from
    /// lib/vendorPricesRepo.ts, returning the ranked MorningPriceShock items the digest
    /// surfaces (vendor/sku/ingredient/delta_pct). Baseline = oldest snapshot in the
    /// 7-day window; latest = live vendor_prices overlay; delta% = (latest-base)/base*100.
    /// Rows with < 2 points or non-positive baseline are skipped. Sorted by |delta| DESC.
    static func loadPriceShocks(_ db: Database, locationId: String) -> [MorningPriceShock] {
        let sinceModifier = "-7 days"
        let minPctMove: Double = 5.0
        let limit = 10
        do {
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

            struct Group {
                var vendor: String
                var sku: String
                var ingredient: String
                var baselinePrice: Double
                var latestPrice: Double
                var pointCount: Int
            }
            var groups: [String: Group] = [:]
            var order: [String] = []  // preserve first-seen order for stable output before sort
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
                    groups[key] = Group(vendor: vendor, sku: sku, ingredient: ingredient,
                                        baselinePrice: unitPrice, latestPrice: unitPrice, pointCount: 1)
                    order.append(key)
                }
            }

            // Live overlay: the current vendor_prices row is the authoritative latest.
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

            var out: [MorningPriceShock] = []
            for key in order {
                guard let g = groups[key] else { continue }
                guard g.pointCount >= 2, g.baselinePrice > 0 else { continue }
                let delta = (g.latestPrice - g.baselinePrice) / g.baselinePrice * 100.0
                guard abs(delta) >= minPctMove else { continue }
                out.append(MorningPriceShock(vendor: g.vendor, sku: g.sku,
                                             ingredient: g.ingredient, deltaPct: delta))
            }
            out.sort { abs($0.deltaPct) > abs($1.deltaPct) }
            return Array(out.prefix(limit))
        } catch {
            return []
        }
    }
}
