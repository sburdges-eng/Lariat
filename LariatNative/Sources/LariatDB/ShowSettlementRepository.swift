import Foundation
import GRDB
import LariatModel

/// Per-show settlement — behavior parity with `lib/settlementRepo.ts` and
/// the `/api/shows/[id]/{deal,settlement}` routes. MONEY-CRITICAL:
/// integer cents at every boundary inside the repo; legacy REAL columns
/// (box_office_lines.face_price/fees, toast_sales_daily.net_sales) are
/// rounded at the read boundary; ONLY the vs bonus floors
/// (venue-favorable, in `DealPointsCompute.computeTalentPayout`).
///
/// Talent payouts are regulated cash custody → the deal upsert posts to the
/// `audit_events` DB stream inside the same transaction; the action is
/// `insert` on first write and `correction` on every subsequent write.
/// `actor_source` comes from the caller's `RegulatedWriteContext`
/// (`native_mac`; web tags `manager_ui` — established native divergence).
public struct ShowSettlementRepository {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?
    private let locationId: String

    public init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.locationId = locationId
    }

    // ── GET /deal ─────────────────────────────────────────────────────

    /// The stored deal, or nil when none has been entered yet.
    public func getDeal(showId: Int64) async throws -> DealPoint? {
        let loc = locationId
        return try await readDB.pool.read { db in
            guard let row = try ShowDealRow.fetchOne(
                db,
                sql: """
                  SELECT guarantee_cents, vs_pct_after_costs, costs_off_top_json, buyout_cents
                    FROM show_deals WHERE show_id = ? AND location_id = ?
                  """,
                arguments: [showId, loc]
            ) else { return nil }
            return try DealPointsCompute.parseDeal(row)
        }
    }

    // ── PUT /deal ─────────────────────────────────────────────────────

    /// UPSERT the deal + audit in one tx. Validation (the web 422 contract)
    /// throws BEFORE the transaction opens — nothing is written.
    public func upsertDeal(
        showId: Int64,
        deal: DealPoint,
        cookId: String,
        context: RegulatedWriteContext,
        notes: String? = nil
    ) throws {
        if let error = DealPointsCompute.validateDeal(deal) {
            throw SettlementError.validation(error)
        }
        // Route parity: empty cookId falls back to 'unknown'.
        let effectiveCookId = cookId.isEmpty ? "unknown" : cookId
        let writeDB = try requireWriteDB()
        let costsJson = Self.costsJSON(deal.costsOffTop)
        let loc = locationId

        try AuditedWriteRunner.perform(db: writeDB) { db in
            let existingId = try Int64.fetchOne(
                db,
                sql: "SELECT id FROM show_deals WHERE show_id = ? AND location_id = ?",
                arguments: [showId, loc]
            )

            try db.execute(
                sql: """
                  INSERT INTO show_deals
                    (show_id, location_id, guarantee_cents, vs_pct_after_costs,
                     costs_off_top_json, buyout_cents, notes, updated_at, updated_by_cook_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
                  ON CONFLICT(show_id, location_id) DO UPDATE SET
                    guarantee_cents    = excluded.guarantee_cents,
                    vs_pct_after_costs = excluded.vs_pct_after_costs,
                    costs_off_top_json = excluded.costs_off_top_json,
                    buyout_cents       = excluded.buyout_cents,
                    notes              = excluded.notes,
                    updated_at         = datetime('now'),
                    updated_by_cook_id = excluded.updated_by_cook_id
                  """,
                arguments: [
                    showId, loc, deal.guaranteeCents, deal.vsPctAfterCosts,
                    costsJson, deal.buyoutCents, notes, effectiveCookId,
                ]
            )

            let dealId: Int64
            if let existingId {
                dealId = existingId
            } else {
                guard let newId = try Int64.fetchOne(
                    db,
                    sql: "SELECT id FROM show_deals WHERE show_id = ? AND location_id = ?",
                    arguments: [showId, loc]
                ) else {
                    throw ShowsWriteError.persistenceFailed
                }
                dealId = newId
            }

            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "show_deal",
                entityId: dealId,
                action: existingId != nil ? .correction : .insert,
                actorCookId: effectiveCookId,
                actorSource: context.actorSource,
                payloadJSON: Self.dealPayloadJSON(deal, notes: notes),
                shiftDate: context.shiftDate,
                locationId: loc
            ))
        }
    }

    // ── GET /settlement ───────────────────────────────────────────────

    /// Read-only join across shows + show_deals + box_office_lines +
    /// toast_sales_daily; pure payout math. Throws `.showNotFound`.
    public func getSettlement(showId: Int64) async throws -> SettlementSummary {
        let loc = locationId
        return try await readDB.pool.read { db in
            try Self.settlement(db, showId: showId, locationId: loc)
        }
    }

    static func settlement(_ db: Database, showId: Int64, locationId: String) throws -> SettlementSummary {
        let showRow = try Row.fetchOne(
            db,
            sql: "SELECT id, band_name, show_date FROM shows WHERE id = ? AND location_id = ?",
            arguments: [showId, locationId]
        )
        guard let showRow else { throw SettlementError.showNotFound(showId) }
        let showDate: String = showRow["show_date"]

        let dealRow = try ShowDealRow.fetchOne(
            db,
            sql: """
              SELECT guarantee_cents, vs_pct_after_costs, costs_off_top_json, buyout_cents
                FROM show_deals WHERE show_id = ? AND location_id = ?
              """,
            arguments: [showId, locationId]
        )
        let deal = try dealRow.map { try DealPointsCompute.parseDeal($0) }
            ?? DealPointsCompute.emptyDeal()

        let ticketRows = try Row.fetchAll(
            db,
            sql: """
              SELECT source, qty, face_price, fees
                FROM box_office_lines
               WHERE show_id = ? AND location_id = ?
              """,
            arguments: [showId, locationId]
        )
        var bySource: [BoxOfficeSource: SettlementSummary.SourceRollup] =
            Dictionary(uniqueKeysWithValues: BoxOfficeSource.allCases.map {
                ($0, SettlementSummary.SourceRollup(qty: 0, grossCents: 0))
            })
        var grossCents = 0
        var feesCents = 0
        for r in ticketRows {
            let qty: Int = r["qty"]
            let face: Double = r["face_price"] ?? 0
            let fees: Double = r["fees"] ?? 0
            // Round REAL dollars to Int cents at the read boundary.
            // NOTE (web parity): fees are multiplied by qty HERE — the
            // tonight rollup counts them once per line. Ported faithfully.
            let lineGross = Int(jsRound(face * Double(qty) * 100))
            let lineFees = Int(jsRound(fees * Double(qty) * 100))
            grossCents += lineGross
            feesCents += lineFees
            if let src = BoxOfficeSource(rawValue: r["source"]) {
                bySource[src]!.qty += qty
                bySource[src]!.grossCents += lineGross
            }
        }
        let netCents = grossCents - feesCents

        let toastRow = try Row.fetchOne(
            db,
            sql: """
              SELECT
                COALESCE(SUM(net_sales), 0) AS net_sales,
                COALESCE(SUM(orders),    0) AS orders,
                COALESCE(SUM(guests),    0) AS guests,
                COUNT(*)                    AS rows_found
              FROM toast_sales_daily
              WHERE shift_date = ? AND location_id = ?
              """,
            arguments: [showDate, locationId]
        )
        let toastNetSales: Double = toastRow?["net_sales"] ?? 0

        let payout = DealPointsCompute.computeTalentPayout(
            deal: deal, ticketRevenueCents: grossCents
        )
        let costsOffTopCents = deal.costsOffTop.reduce(0) { $0 + $1.cents }
        let netDoorCents = netCents - costsOffTopCents - payout.totalCents

        return SettlementSummary(
            show: SettlementSummary.Show(
                id: showRow["id"], bandName: showRow["band_name"],
                date: showDate, locationId: locationId
            ),
            deal: deal,
            ticketing: SettlementSummary.Ticketing(
                grossCents: grossCents, feesCents: feesCents,
                netCents: netCents, bySource: bySource
            ),
            toast: SettlementSummary.Toast(
                totalCents: Int(jsRound(toastNetSales * 100)),
                ordersCount: toastRow?["orders"] ?? 0,
                guestsCount: toastRow?["guests"] ?? 0,
                attributionDate: showDate,
                rowsFound: toastRow?["rows_found"] ?? 0
            ),
            talent: payout,
            costsOffTopCents: costsOffTopCents,
            netDoorCents: netDoorCents,
            computedAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    // ── helpers ───────────────────────────────────────────────────────

    /// `JSON.stringify(deal.costsOffTop)` — [{label, cents}] camelCase-free.
    static func costsJSON(_ costs: [DealCost]) -> String {
        let arr = costs.map { ["label": $0.label, "cents": $0.cents] as [String: Any] }
        guard let data = try? JSONSerialization.data(withJSONObject: arr),
              let s = String(data: data, encoding: .utf8) else {
            return "[]"
        }
        return s
    }

    /// Audit payload — the DealPoint DTO with the web's camelCase keys
    /// (`JSON.stringify(deal)` parity), plus `notes` when present.
    static func dealPayloadJSON(_ deal: DealPoint, notes: String?) -> String {
        var dict: [String: Any] = [
            "guaranteeCents": deal.guaranteeCents,
            "vsPctAfterCosts": deal.vsPctAfterCosts as Any? ?? NSNull(),
            "costsOffTop": deal.costsOffTop.map {
                ["label": $0.label, "cents": $0.cents] as [String: Any]
            },
            "buyoutCents": deal.buyoutCents,
        ]
        if let notes { dict["notes"] = notes }
        guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]),
              let s = String(data: data, encoding: .utf8) else {
            return "{\"_audit_serialization_error\":true}"
        }
        return s
    }

    /// JS `Math.round` — half toward +infinity.
    static func jsRound(_ x: Double) -> Double {
        (x + 0.5).rounded(.down)
    }

    private func requireWriteDB() throws -> LariatWriteDatabase {
        guard let writeDB else {
            throw ShowsWriteError.persistenceFailed
        }
        return writeDB
    }
}
