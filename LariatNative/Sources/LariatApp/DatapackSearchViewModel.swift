import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `cook.datapackSearch` — parity with `/datapack-search` in LEXICAL
/// mode (BM25 over USDA / OFF / Wikibooks / FDA + per-row drill-in).
/// Semantic + hybrid modes are deliberately not ported (BGE ONNX runtime) —
/// see the A6.3 plan doc.
@Observable @MainActor
final class DatapackSearchViewModel {
    /// Typed drill-in payload per source.
    enum Detail: Equatable, Sendable {
        case usda(food: UsdaFood, nutrients: [UsdaNutrient])
        case off(OffProduct)
        case fda(FdaSection)
        case wikibooks(WikibooksPage)
    }

    enum Response: Equatable {
        case idle
        case loading
        case unavailable
        case error(String)
        case ok(groups: [Group])
    }

    struct Group: Equatable, Identifiable {
        let source: DatapackSource
        let hits: [DatapackFtsHit]
        var id: String { source.rawValue }
    }

    static let unavailableCopy =
        "Reference data is not installed on this Mac. Ask a manager to finish setup."

    var query = ""
    var source: DatapackSource = .all
    private(set) var response: Response = .idle
    private(set) var details: [String: DatapackDetailEntry<Detail>] = [:]

    private let repo: DatapackRepository

    init(datapack: DatapackRepository? = nil) {
        self.repo = datapack ?? DatapackRepository()
    }

    var isAvailable: Bool { repo.isAvailable }

    func runSearch() {
        guard repo.isAvailable else {
            response = .unavailable
            return
        }
        guard let q = DatapackSearchCompute.clipQuery(query) else {
            response = .idle
            return
        }
        response = .loading
        details = [:]
        do {
            let hits = try repo.fts(
                DatapackSearchCompute.escapeFtsPhrase(q),
                source: source,
                limit: DatapackSearchCompute.routeLimit(20))
            // Group in the web's display order, dropping empty groups.
            var buckets: [DatapackSource: [DatapackFtsHit]] = [:]
            for hit in hits { buckets[hit.source, default: []].append(hit) }
            let groups = DatapackSource.concrete.compactMap { s -> Group? in
                guard let bucketHits = buckets[s], !bucketHits.isEmpty else { return nil }
                return Group(source: s, hits: bucketHits)
            }
            response = .ok(groups: groups)
        } catch {
            // FTS syntax errors map to the route's 400 posture.
            response = .error("fts query failed: \(error.localizedDescription)")
        }
    }

    // ── Drill-in (detailsState.ts port) ─────────────────────────────────

    func isOpen(_ hit: DatapackFtsHit) -> Bool {
        switch details[hit.id] {
        case .loading, .ok, .error: return true
        case .closed, nil: return false
        }
    }

    func entry(for hit: DatapackFtsHit) -> DatapackDetailEntry<Detail>? {
        details[hit.id]
    }

    func toggleDetail(_ hit: DatapackFtsHit) {
        let (next, action) = DatapackDetailState.next(details, key: hit.id)
        details = next
        guard action == .openFresh else { return }

        do {
            guard let detail = try fetchDetail(hit) else {
                details[hit.id] = .error(message: "not found")
                return
            }
            details[hit.id] = .ok(data: detail)
        } catch {
            details[hit.id] = .error(message: error.localizedDescription)
        }
    }

    private func fetchDetail(_ hit: DatapackFtsHit) throws -> Detail? {
        switch hit.source {
        case .usda:
            guard let id = Int64(hit.hitId), let food = try repo.usdaFood(fdcId: id) else { return nil }
            return .usda(food: food, nutrients: try repo.usdaNutrients(fdcId: id))
        case .off:
            guard let product = try repo.offProduct(code: hit.hitId) else { return nil }
            return .off(product)
        case .fda:
            guard let id = Int64(hit.hitId), let section = try repo.fdaSection(rowid: id) else { return nil }
            return .fda(section)
        case .wikibooks:
            guard let id = Int64(hit.hitId), let page = try repo.wikibooksPage(pageId: id) else { return nil }
            return .wikibooks(page)
        case .all:
            return nil
        }
    }
}
