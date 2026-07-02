import Foundation
import LariatDB
import LariatModel
import Observation

/// Inventory PAR board view model — parity with `app/inventory/par/page.jsx` +
/// `/api/inventory/par` (A4.1). Reads each par row joined to its latest counted
/// on-hand (below-par flagged). Add/remove are audited writes; **no PIN gate**
/// (the /inventory area is unregulated relative to safety/labor). Writes tag
/// `actor_source = native_cook`. Quantities are `Double?` — not currency.
@Observable @MainActor
final class InventoryParViewModel {
    var rows: [InventoryParWithOnHand] = []
    var fetchError: String?
    var actionError: String?
    var showLowOnly = false
    var showForm = false

    // Add-par form state.
    var ingredient = ""
    var sku = ""
    var vendor = ""
    var parQtyText = ""
    var parUnit = ""
    var category = ""
    var note = ""

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    private var pollTask: Task<Void, Never>?

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase, locationId: String = LocationScope.resolve()) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.locationId = locationId
    }

    /// Rows grouped by category ("Other" when null), each category sorted by ingredient.
    var grouped: [(category: String, rows: [InventoryParWithOnHand])] {
        let visible = showLowOnly ? rows.filter(\.isLow) : rows
        let byCat = Dictionary(grouping: visible) { $0.par.category ?? "Other" }
        return byCat
            .map { (category: $0.key, rows: $0.value.sorted { $0.par.ingredient < $1.par.ingredient }) }
            .sorted { $0.category < $1.category }
    }

    var lowCount: Int { rows.filter(\.isLow).count }

    func start() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    func stop() { pollTask?.cancel() }

    func refresh() async {
        let repo = InventoryParRepository(readDB: readDB, writeDB: writeDB)
        do {
            rows = try await repo.loadWithLatestOnHand(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load par list"
        }
    }

    func addPar() {
        actionError = nil
        guard !ingredient.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            actionError = "Ingredient is required."
            return
        }
        let repo = InventoryParRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: nil, locationId: locationId)
        do {
            _ = try repo.upsert(
                input: InventoryParUpsertInput(
                    ingredient: ingredient,
                    sku: sku.isEmpty ? nil : sku,
                    vendor: vendor.isEmpty ? nil : vendor,
                    parQty: Double(parQtyText),
                    parUnit: parUnit.isEmpty ? nil : parUnit,
                    category: category.isEmpty ? nil : category,
                    note: note.isEmpty ? nil : note
                ),
                context: context
            )
            resetForm()
            showForm = false
            Task { await refresh() }
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    func remove(_ id: Int64) {
        actionError = nil
        let repo = InventoryParRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: nil, locationId: locationId)
        do {
            try repo.delete(id: id, context: context)
            Task { await refresh() }
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    private func resetForm() {
        ingredient = ""; sku = ""; vendor = ""; parQtyText = ""; parUnit = ""; category = ""; note = ""
    }
}
