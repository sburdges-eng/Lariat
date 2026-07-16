import Foundation
import GRDB
import LariatModel

/// The `/api/beo/cascade` payload: order guide + prep demands + unmapped for
/// one event. `engineError` mirrors the web route's error-inside-a-200
/// behavior (banner, not failure) when the cascade engine can't run.
public struct BeoCascadeOutcome: Equatable, Sendable {
    public let eventId: Int64
    public let orderGuide: [CascadeOrderGuideRow]
    public let prepDemands: [CascadePrepDemandRow]
    public let unmapped: [CascadeUnmappedRow]
    public let manifestWarnings: [CascadeManifestWarningRow]
    /// Graceful-degradation notices from the engine (bad unit / unknown
    /// sub-recipe / cycle) — a recipe dropped from the order guide + prep board
    /// instead of aborting. Mirrors `CascadeResult.warnings`; dropping it
    /// silently under-orders and under-preps. May be empty.
    public let warnings: [String]
    public let engineError: String?

    public init(
        eventId: Int64,
        orderGuide: [CascadeOrderGuideRow],
        prepDemands: [CascadePrepDemandRow],
        unmapped: [CascadeUnmappedRow],
        manifestWarnings: [CascadeManifestWarningRow] = [],
        warnings: [String] = [],
        engineError: String?
    ) {
        self.eventId = eventId
        self.orderGuide = orderGuide
        self.prepDemands = prepDemands
        self.unmapped = unmapped
        self.manifestWarnings = manifestWarnings
        self.warnings = warnings
        self.engineError = engineError
    }
}

/// Per-event cascade — parity with `GET /api/beo/cascade`
/// (`app/api/beo/cascade/route.js`). Location scoping: beo_line_items has NO
/// location_id column — the event's location_id is verified first, then its
/// line items load unscoped. On-hand: the latest inventory count for the
/// location is loaded and passed to the engine (to_order = total_needed −
/// on_hand), scoped to the event's location.
///
/// Deferred (not yet ported): the engine's `on_hand_unapplied[]` /
/// `manifest_warnings[]` observability arrays are not surfaced here.
public struct BeoCascadeRepository {
    private let database: LariatDatabase
    private let client: BeoCascadeClient

    public init(database: LariatDatabase, client: BeoCascadeClient = BeoCascadeClient()) {
        self.database = database
        self.client = client
    }

    public func cascade(
        eventId: Int64,
        locationId: String = LocationScope.resolve()
    ) async throws -> BeoCascadeOutcome {
        guard eventId > 0 else {
            throw BeoWriteError.badRequest("event_id required")
        }

        let (lineItems, inventory): ([CascadeLineItem], [CascadeInventoryRow]) = try await database.pool.read { db in
            // Verify the event exists and belongs to the requested location.
            // Same message for missing and wrong-location events — no
            // cross-location leak.
            guard let eventLocation = try String.fetchOne(
                db,
                sql: "SELECT location_id FROM beo_events WHERE id = ?",
                arguments: [eventId]
            ), eventLocation == locationId else {
                throw BeoWriteError.notFound("event not found")
            }
            let rows = try Row.fetchAll(
                db,
                sql: "SELECT item_name, quantity FROM beo_line_items WHERE event_id = ?",
                arguments: [eventId]
            )
            let items = rows.map { CascadeLineItem(itemName: $0["item_name"], quantity: $0["quantity"]) }

            // Load the latest inventory count for this location so the engine
            // can subtract on-hand stock (to_order = total_needed − on_hand).
            // beo_line_items has no location_id, but the count tables do —
            // scope the count to the event's already-verified location.
            let invRows = try Row.fetchAll(
                db,
                sql: """
                    SELECT ingredient, unit, on_hand_qty
                      FROM inventory_count_lines
                     WHERE on_hand_qty IS NOT NULL
                       AND count_id = (
                         SELECT id FROM inventory_counts
                          WHERE location_id = ?
                          ORDER BY count_date DESC, id DESC
                          LIMIT 1
                       )
                    """,
                arguments: [locationId]
            )
            let inv = invRows.map {
                CascadeInventoryRow(
                    ingredient: $0["ingredient"],
                    unit: $0["unit"] ?? "",
                    onHand: $0["on_hand_qty"] ?? 0
                )
            }
            return (items, inv)
        }

        do {
            // BEO quantities are individual item counts for pricing
            // (unit_cost × qty), not recipe batch counts — qtyInYieldUnits
            // stops the engine multiplying by yield (web parity).
            let result = try await client.cascadeFromLineItems(
                lineItems,
                qtyInYieldUnits: true,
                inventory: inventory
            )
            return BeoCascadeOutcome(
                eventId: eventId,
                orderGuide: result.orderGuide,
                prepDemands: result.prepDemands,
                unmapped: result.unmapped,
                manifestWarnings: result.manifestWarnings,
                warnings: result.warnings,
                engineError: nil
            )
        } catch let error as CascadeError {
            // Engine/data condition — consistent shape with banner info
            // (web returns 200 with an error string, not a failure).
            return BeoCascadeOutcome(
                eventId: eventId, orderGuide: [], prepDemands: [], unmapped: [],
                engineError: error.message
            )
        }
    }
}
