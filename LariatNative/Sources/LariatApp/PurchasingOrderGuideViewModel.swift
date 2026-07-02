import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `purchasing.orderGuide` — the READ-ONLY purchasing hub, parity with
/// `app/purchasing/page.jsx`: the order-guide table (LIMIT 200) enriched with
/// preferred/lock/mismatch badges (`lib/orderGuideEnrichment.ts`). No writes.
@Observable @MainActor
final class PurchasingOrderGuideViewModel {
    var summary: OrderGuideSummary?
    var query = ""
    var fetchError: String?

    private let database: LariatDatabase
    private let locationId: String

    init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    /// Client-side `.searchable` filter on ingredient/vendor (native nicety;
    /// the web page renders the full 200-row table).
    var filteredRows: [EnrichedOrderGuideRow] {
        guard let rows = summary?.rows else { return [] }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return rows }
        return rows.filter {
            $0.row.ingredient.lowercased().contains(q)
                || ($0.row.vendor?.lowercased().contains(q) ?? false)
        }
    }

    func refresh() async {
        do {
            let repo = PurchasingOrderGuideRepository(database: database, locationId: locationId)
            summary = try await repo.fetch()
            fetchError = nil
        } catch {
            fetchError = "Could not load the order guide"
        }
    }
}
