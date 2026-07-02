import Foundation
import GRDB
import LariatModel

/// Read-only accessors over `beo_prep_history` — parity with
/// `lib/beoPrepHistory.ts` plus the `GET /api/beo/prep-history` route
/// behavior (50-item request cap). Pure logic (limit clamping, amount
/// parsing, median, recipe matching, item cleaning) lives in
/// `BeoPrepHistoryCompute`.
///
/// Web gate: master PIN or temp-PIN scope `menu.prep_history`. Reads stay
/// open natively (native precedent; writes don't exist on this surface).
public struct BeoPrepHistoryRepository: Sendable {
    private let database: LariatDatabase

    /// Route-level cap (`MAX_ITEMS_PER_REQUEST` in prep-history/route.js).
    public static let maxItemsPerRequest = 50

    public init(database: LariatDatabase) {
        self.database = database
    }

    /// `getItemPrepHistory` — case-insensitive EXACT match per item; items
    /// with no history are omitted. Applies the route's 50-item slice first.
    public func itemPrepHistory(
        items: [String],
        limit: Int? = nil,
        locationId: String = LocationScope.resolve()
    ) async throws -> [BeoPrepHistoryMatch] {
        let capped = Array(items.prefix(Self.maxItemsPerRequest))
        let cleaned = BeoPrepHistoryCompute.cleanedItems(capped)
        if cleaned.isEmpty { return [] }
        let cap = BeoPrepHistoryCompute.clampLimit(limit)

        return try await database.pool.read { db in
            var out: [BeoPrepHistoryMatch] = []
            for item in cleaned {
                let rows = try BeoPrepHistoryRow.fetchAll(
                    db,
                    sql: """
                      SELECT event_date, client, type, amount_qty,
                             prep_day, pre_prep_notes, plating_notes,
                             source, imported_at
                        FROM beo_prep_history
                       WHERE location_id = ?
                         AND LOWER(item) = LOWER(?)
                       ORDER BY (event_date IS NULL), event_date DESC, id DESC
                       LIMIT ?
                      """,
                    arguments: [locationId, item, cap]
                )
                if !rows.isEmpty {
                    out.append(BeoPrepHistoryMatch(item: item, history: rows))
                }
            }
            return out
        }
    }

    /// `getPrepMedianForItems` — batch median of historical prep quantities,
    /// keyed by `lower(item).trim()`. Items with zero numeric samples are
    /// omitted (callers distinguish "no data" via key presence).
    public func prepMedians(
        items: [String],
        locationId: String = LocationScope.resolve()
    ) async throws -> [String: BeoPrepMedian] {
        let keyed = BeoPrepHistoryCompute.keyedItems(items)
        if keyed.isEmpty { return [:] }

        return try await database.pool.read { db in
            var out: [String: BeoPrepMedian] = [:]
            for (key, item) in keyed {
                let raws = try String?.fetchAll(
                    db,
                    sql: "SELECT amount_qty FROM beo_prep_history WHERE location_id = ? AND LOWER(item) = ?",
                    arguments: [locationId, key]
                )
                if raws.isEmpty { continue }
                var nums: [Double] = []
                for raw in raws {
                    if let n = BeoPrepHistoryCompute.parseAmountQty(raw) { nums.append(n) }
                }
                if nums.isEmpty { continue }
                nums.sort()
                out[key] = BeoPrepMedian(
                    key: key,
                    item: item,
                    median: BeoPrepHistoryCompute.median(sorted: nums),
                    samples: nums.count,
                    totalRows: raws.count
                )
            }
            return out
        }
    }

    /// `getRecipePrepHistory` — bidirectional case-insensitive substring
    /// match between the recipe name and BEO `item` text; most-recent-first,
    /// NULL event_date last; recipe names under 3 chars return empty.
    public func recipePrepHistory(
        recipeName: String,
        limit: Int? = nil,
        locationId: String = LocationScope.resolve()
    ) async throws -> [BeoRecipePrepHistoryRow] {
        let name = recipeName.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.count < BeoPrepHistoryCompute.minRecipeNameLen { return [] }
        let cap = BeoPrepHistoryCompute.clampLimit(limit)
        let lower = name.lowercased()

        // Pull all rows for the location and filter in Swift — same
        // reasoning as the web module (LIKE-escaping in both directions is
        // easy to get wrong; volume is small).
        return try await database.pool.read { db in
            let allRows = try BeoRecipePrepHistoryRow.fetchAll(
                db,
                sql: """
                  SELECT item, event_date, client, type, amount_qty,
                         prep_day, pre_prep_notes, plating_notes,
                         source, imported_at
                    FROM beo_prep_history
                   WHERE location_id = ? AND item IS NOT NULL
                   ORDER BY (event_date IS NULL), event_date DESC, id DESC
                  """,
                arguments: [locationId]
            )
            var matched: [BeoRecipePrepHistoryRow] = []
            for row in allRows {
                if BeoPrepHistoryCompute.recipeItemMatches(
                    recipeNameLower: lower, itemLower: row.item.lowercased()
                ) {
                    matched.append(row)
                    if matched.count >= cap { break }
                }
            }
            return matched
        }
    }

    /// `getRecentEvents` — recent catering events (most recent first),
    /// grouped by client+event_date; Main-Item rows only.
    public func recentEvents(
        limit: Int? = nil,
        locationId: String = LocationScope.resolve()
    ) async throws -> [BeoRecentEvent] {
        let cap = BeoPrepHistoryCompute.clampLimit(limit)
        return try await database.pool.read { db in
            let rows = try Row.fetchAll(
                db,
                sql: """
                  SELECT client, event_date, item, amount_qty
                    FROM beo_prep_history
                   WHERE location_id = ? AND event_date IS NOT NULL
                     AND (type IS NULL OR type = 'Main Item')
                   ORDER BY event_date DESC, id ASC
                  """,
                arguments: [locationId]
            )

            var indexByKey: [String: Int] = [:]
            var out: [BeoRecentEvent] = []
            for row in rows {
                let eventDate: String = row["event_date"]
                let client: String? = row["client"]
                let item = BeoRecentEvent.Item(item: row["item"], amountQty: row["amount_qty"])
                let key = "\(eventDate)|\(client ?? "")"
                if let idx = indexByKey[key] {
                    out[idx].items.append(item)
                    continue
                }
                out.append(BeoRecentEvent(eventDate: eventDate, client: client, items: []))
                indexByKey[key] = out.count - 1
                if indexByKey.count > cap {
                    // Rows are newest-first, so the first `cap` groups are the
                    // newest — stop accumulating (web parity: break, then slice).
                    break
                }
                out[out.count - 1].items.append(item)
            }
            return Array(out.prefix(cap))
        }
    }
}
