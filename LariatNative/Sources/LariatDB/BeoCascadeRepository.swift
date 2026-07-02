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
    public let engineError: String?

    public init(
        eventId: Int64,
        orderGuide: [CascadeOrderGuideRow],
        prepDemands: [CascadePrepDemandRow],
        unmapped: [CascadeUnmappedRow],
        engineError: String?
    ) {
        self.eventId = eventId
        self.orderGuide = orderGuide
        self.prepDemands = prepDemands
        self.unmapped = unmapped
        self.engineError = engineError
    }
}

/// Per-event cascade — parity with `GET /api/beo/cascade`
/// (`app/api/beo/cascade/route.js`). Location scoping: beo_line_items has NO
/// location_id column — the event's location_id is verified first, then its
/// line items load unscoped.
///
/// WATCH (plan doc): web PR #369 touches cascade conversions + on-hand
/// wiring. Re-sync this repository + `BeoCascadeClient` if it merges.
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

        let lineItems: [CascadeLineItem] = try await database.pool.read { db in
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
            return rows.map { CascadeLineItem(itemName: $0["item_name"], quantity: $0["quantity"]) }
        }

        do {
            // BEO quantities are individual item counts for pricing
            // (unit_cost × qty), not recipe batch counts — qtyInYieldUnits
            // stops the engine multiplying by yield (web parity).
            let result = try await client.cascadeFromLineItems(lineItems, qtyInYieldUnits: true)
            return BeoCascadeOutcome(
                eventId: eventId,
                orderGuide: result.orderGuide,
                prepDemands: result.prepDemands,
                unmapped: result.unmapped,
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
