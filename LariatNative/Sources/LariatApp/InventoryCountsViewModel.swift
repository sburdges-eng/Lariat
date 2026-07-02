import Foundation
import LariatDB
import LariatModel
import Observation

/// Inventory COUNTS board view model — parity with the `/inventory/counts` web
/// surface (A4.1). Lists recent counts (open-only filter + per-count line tally),
/// opens a new count, and — for the selected count — loads its lines, upserts a
/// line, and closes/reopens it. All writes are audited but **not PIN-gated** (the
/// /inventory area is unregulated); writes tag `actor_source = native_cook`.
/// Quantities are `Double?` — not currency.
@Observable @MainActor
final class InventoryCountsViewModel {
    // List.
    var counts: [InventoryCountSummary] = []
    var openOnly = false { didSet { Task { await refresh() } } }
    var fetchError: String?
    var actionError: String?

    // New-count sheet.
    var showNewCount = false
    var newLabel = ""

    // Detail sheet (selected count).
    var showDetail = false
    var selected: InventoryCountDetail?
    var detailError: String?
    private var selectedId: Int64?

    // Add-line form (inline in the detail sheet).
    var ingredient = ""
    var sku = ""
    var vendor = ""
    var onHandText = ""
    var unit = ""
    var parQtyText = ""
    var parUnit = ""
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

    private var repo: InventoryCountRepository { InventoryCountRepository(readDB: readDB, writeDB: writeDB) }
    private func context() -> RegulatedWriteContext { .nativeCook(cookId: nil, locationId: locationId) }

    // ── list ──────────────────────────────────────────────────────────

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
        do {
            counts = try await repo.listCounts(openOnly: openOnly, locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load counts"
        }
    }

    // ── open a new count ─────────────────────────────────────────────────

    func openCount() {
        actionError = nil
        do {
            _ = try repo.openCount(
                input: InventoryCountOpenInput(label: newLabel.isEmpty ? nil : newLabel),
                context: context()
            )
            newLabel = ""
            showNewCount = false
            Task { await refresh() }
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    // ── detail (selected count) ────────────────────────────────────────

    func openDetail(_ id: Int64) {
        selectedId = id
        selected = nil
        actionError = nil
        resetLineForm()
        showDetail = true
        Task { await loadDetail() }
    }

    func loadDetail() async {
        guard let id = selectedId else { return }
        do {
            selected = try await repo.getCount(id: id, locationId: locationId)
            detailError = nil
        } catch {
            detailError = "Could not load count"
        }
    }

    func addLine() {
        actionError = nil
        guard let id = selectedId else { return }
        guard !ingredient.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            actionError = "Ingredient is required."
            return
        }
        do {
            _ = try repo.upsertLine(
                countId: id,
                input: InventoryCountLineInput(
                    ingredient: ingredient,
                    sku: sku.isEmpty ? nil : sku,
                    vendor: vendor.isEmpty ? nil : vendor,
                    onHandQty: Double(onHandText),
                    unit: unit.isEmpty ? nil : unit,
                    parQty: Double(parQtyText),
                    parUnit: parUnit.isEmpty ? nil : parUnit,
                    note: note.isEmpty ? nil : note
                ),
                context: context()
            )
            resetLineForm()
            Task { await loadDetail(); await refresh() }
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    func closeSelected() {
        actionError = nil
        guard let id = selectedId else { return }
        do {
            try repo.closeCount(id: id, context: context())
            Task { await loadDetail(); await refresh() }
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    func reopenSelected() {
        actionError = nil
        guard let id = selectedId else { return }
        do {
            try repo.reopenCount(id: id, context: context())
            Task { await loadDetail(); await refresh() }
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    private func resetLineForm() {
        ingredient = ""; sku = ""; vendor = ""; onHandText = ""; unit = ""
        parQtyText = ""; parUnit = ""; note = ""
    }
}
