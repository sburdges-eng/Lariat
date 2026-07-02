import Foundation
import GRDB
import LariatModel

/// DB half of `lib/kitchenSemanticSearch.ts` — builds the local lexical corpus
/// (recipe cache + location-scoped BEO line items / prep tasks + SAFE audit
/// entities only) and ranks it with the compute half.
///
/// Deferral (Phase B plan): the web's `referenceRecipeHits` rides the datapack
/// HYBRID recipes bucket (BM25 + BGE). The native lexical pack has no recipes
/// bucket, so reference hits are empty — identical to the web when the pack
/// is absent (`dataPackAvailable() === false`).
public struct KitchenSemanticSearchRepository {
    private let readDB: LariatDatabase
    private let loadRecipes: @Sendable () -> [AssistantRecipe]

    public init(
        readDB: LariatDatabase,
        loadRecipes: @escaping @Sendable () -> [AssistantRecipe] = { AssistantDataCaches.loadRecipes() }
    ) {
        self.readDB = readDB
        self.loadRecipes = loadRecipes
    }

    /// `runSemanticKitchenSearch(args)` parity (lexical).
    public func run(
        locationId: String,
        query: String,
        limit: Int? = nil
    ) throws -> KitchenSemanticSearchCompute.SearchResult {
        let clipped = KitchenSemanticSearchCompute.clip(query, 240)
        if clipped.isEmpty {
            return KitchenSemanticSearchCompute.SearchResult(query: "", hits: [])
        }
        let normalizedLimit = KitchenSemanticSearchCompute.normalizeLimit(limit)

        var corpus = recipeCorpus(loadRecipes())
        try readDB.pool.read { db in
            corpus.append(contentsOf: try beoLineCorpus(db, locationId: locationId))
            corpus.append(contentsOf: try beoPrepCorpus(db, locationId: locationId))
            corpus.append(contentsOf: try auditCorpus(db, locationId: locationId))
        }

        let localHits = KitchenSemanticSearchCompute.rankCorpus(
            query: clipped, rows: corpus, limit: normalizedLimit
        )
        // referenceHits deferred → [] (lexical pack has no recipes bucket).
        let hits = KitchenSemanticSearchCompute.mergeHits([localHits], limit: normalizedLimit)
        return KitchenSemanticSearchCompute.SearchResult(query: clipped, hits: hits)
    }

    // ── corpus builders (queries mirror the web module) ─────────────

    func recipeCorpus(_ recipes: [AssistantRecipe]) -> [KitchenSemanticSearchCompute.CorpusRow] {
        recipes.map { recipe in
            let ingredients = (recipe.ingredients ?? [])
                .map { i in
                    [i.item, i.qty?.display, i.unit].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
                }
                .filter { !$0.isEmpty }
            let detailBits = [
                recipe.slug.map { "slug \($0)" },
                recipe.station.flatMap { $0.isEmpty ? nil : "station \($0)" },
                (recipe.menuItems?.isEmpty == false) ? "menu \(recipe.menuItems!.joined(separator: ", "))" : nil,
            ].compactMap { $0 }
            let text = [
                recipe.name,
                recipe.slug,
                recipe.station,
                recipe.yieldQty?.display,
                recipe.yieldUnit,
                recipe.menuItems?.joined(separator: " "),
                ingredients.joined(separator: " "),
                recipe.procedure,
                recipe.allergens?.joined(separator: " "),
            ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "\n")
            return KitchenSemanticSearchCompute.CorpusRow(
                type: .recipe,
                title: recipe.name ?? recipe.slug ?? "Unnamed recipe",
                detail: detailBits.isEmpty ? "local recipe" : detailBits.joined(separator: " | "),
                text: text,
                id: "recipe:\(recipe.slug ?? recipe.name ?? "")",
                source: "local recipe book"
            )
        }
    }

    private func beoLineCorpus(_ db: Database, locationId: String) throws -> [KitchenSemanticSearchCompute.CorpusRow] {
        try Row.fetchAll(
            db,
            sql: """
              SELECT li.id, li.item_name, li.category, li.quantity,
                     li.prep_notes, li.secondary_prep_notes, li.order_items_notes, li.group_note,
                     e.id AS event_id, e.title, e.event_date, e.contact_name, e.notes
              FROM beo_line_items li
              JOIN beo_events e ON e.id = li.event_id
              WHERE e.location_id = ?
              ORDER BY date(e.event_date) DESC, e.id DESC, li.sort_order ASC, li.id ASC
              LIMIT ?
              """,
            arguments: [locationId, KitchenSemanticSearchCompute.maxLocalRows]
        ).map { row in
            let eventId: Int64 = row["event_id"]
            let title: String? = row["title"]
            let quantity: Double? = row["quantity"]
            let detail = [
                row["event_date"] as String?,
                title.map { "BEO \(eventId): \($0)" } ?? "BEO \(eventId)",
                row["category"] as String?,
                quantity.map { "\(JsValueFormat.numberString($0)) qty" },
            ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " | ")
            let text = ([
                row["item_name"] as String?,
                row["category"] as String?,
                quantity.map(JsValueFormat.numberString),
                row["prep_notes"] as String?,
                row["secondary_prep_notes"] as String?,
                row["order_items_notes"] as String?,
                row["group_note"] as String?,
                title,
                row["event_date"] as String?,
                row["contact_name"] as String?,
                row["notes"] as String?,
            ] as [String?]).compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "\n")
            return KitchenSemanticSearchCompute.CorpusRow(
                type: .beoLineItem,
                title: row["item_name"] ?? "",
                detail: detail,
                text: text,
                id: "beo_line_item:\(row["id"] as Int64? ?? 0)",
                source: "BEO line item"
            )
        }
    }

    private func beoPrepCorpus(_ db: Database, locationId: String) throws -> [KitchenSemanticSearchCompute.CorpusRow] {
        try Row.fetchAll(
            db,
            sql: """
              SELECT t.id, t.task, t.due_date, t.done,
                     e.id AS event_id, e.title, e.event_date, e.contact_name, e.notes
              FROM beo_prep_tasks t
              JOIN beo_events e ON e.id = t.event_id
              WHERE t.location_id = ? AND e.location_id = ?
              ORDER BY date(e.event_date) DESC, e.id DESC, t.sort_order ASC, t.id ASC
              LIMIT ?
              """,
            arguments: [locationId, locationId, KitchenSemanticSearchCompute.maxLocalRows]
        ).map { row in
            let eventId: Int64 = row["event_id"]
            let done = (row["done"] as Int? ?? 0) != 0
            let detail = [
                row["event_date"] as String?,
                "BEO \(eventId): \(row["title"] as String? ?? "")",
                (row["due_date"] as String?).map { "due \($0)" },
                done ? "done" : "pending",
            ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " | ")
            let text = ([
                row["task"] as String?,
                row["due_date"] as String?,
                row["title"] as String?,
                row["event_date"] as String?,
                row["contact_name"] as String?,
                row["notes"] as String?,
                done ? "done complete finished" : "pending incomplete prep",
            ] as [String?]).compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "\n")
            return KitchenSemanticSearchCompute.CorpusRow(
                type: .beoPrepTask,
                title: row["task"] ?? "",
                detail: detail,
                text: text,
                id: "beo_prep_task:\(row["id"] as Int64? ?? 0)",
                source: "BEO prep"
            )
        }
    }

    private func auditCorpus(_ db: Database, locationId: String) throws -> [KitchenSemanticSearchCompute.CorpusRow] {
        let entities = KitchenSemanticSearchCompute.safeAuditEntities
        let placeholders = entities.map { _ in "?" }.joined(separator: ", ")
        var arguments: [DatabaseValueConvertible] = [locationId]
        arguments.append(contentsOf: entities)
        arguments.append(KitchenSemanticSearchCompute.maxAuditRows)
        return try Row.fetchAll(
            db,
            sql: """
              SELECT id, shift_date, entity, entity_id, action, payload_json, note
              FROM audit_events
              WHERE location_id = ?
                AND entity IN (\(placeholders))
              ORDER BY id DESC
              LIMIT ?
              """,
            arguments: StatementArguments(arguments)
        ).map { row in
            let entityRaw: String = row["entity"]
            let entity = KitchenSemanticSearchCompute.labelEntity(entityRaw)
            let payload = KitchenSemanticSearchCompute.payloadText(row["payload_json"])
            let entityId: Int64? = row["entity_id"]
            let detail = [
                row["shift_date"] as String?,
                entity,
                row["action"] as String?,
                entityId.map { "row \($0)" },
            ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " | ")
            let text = ([
                entity,
                row["action"] as String?,
                payload,
                row["note"] as String?,
            ] as [String?]).compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "\n")
            return KitchenSemanticSearchCompute.CorpusRow(
                type: .auditEvent,
                title: "\(entity) \(row["action"] as String? ?? "")",
                detail: detail,
                text: text,
                id: "audit_event:\(row["id"] as Int64? ?? 0)",
                source: "kitchen audit"
            )
        }
    }
}
