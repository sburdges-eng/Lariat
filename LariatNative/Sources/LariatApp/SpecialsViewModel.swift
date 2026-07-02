import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `manager.specials` — parity with `/specials/saved` +
/// `/specials/saved/[id]` (list, detail, rename/notes, soft-delete, CSV
/// export, menu promotion). The web path is middleware PIN-gated; native
/// gates every WRITE per-write via `PinSessionStore` + `PinEntrySheet`
/// (the A5 management-board posture — reads are in-app only).
@Observable @MainActor
final class SpecialsViewModel {
    private(set) var items: [SpecialListItem] = []
    private(set) var loaded = false
    var fetchError: String?
    var errorMessage: String?
    var isSaving = false
    var showPinSheet = false

    /// Client-side list filter (native convention).
    var filter = ""

    // Selected detail + edit fields.
    private(set) var detail: SpecialRecord?
    private(set) var promotion: SpecialsPromotionRecord?
    var editName = ""
    var editNotes = ""

    // Export form state (web SpecialDetailClient).
    var exportSlug = ""
    var exportYieldQty = ""
    var exportYieldUnit = "portions"
    var exportCategory = ""
    var exportProcedure = ""
    var exportResult: SpecialsRepository.ExportResult?
    var exportError: String?

    // Promote form state.
    var promoteName = ""
    var promoteServings = "1"
    var promoteError: String?
    var promoteSkipped: [SkippedComponent] = []

    let pinStore: PinSessionStore
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    private var pendingAction: (() -> Void)?

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase,
        pinStore: PinSessionStore? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.pinStore = pinStore ?? PinSessionStore.shared
        self.locationId = locationId
    }

    var writeDatabase: LariatWriteDatabase { writeDB }

    private var repo: SpecialsRepository {
        SpecialsRepository(readDB: readDB, writeDB: writeDB)
    }

    var filteredItems: [SpecialListItem] {
        let q = filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return items }
        return items.filter {
            $0.name.lowercased().contains(q) || $0.snippet.lowercased().contains(q)
        }
    }

    func refresh() async {
        do {
            items = try await repo.list(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load saved specials"
        }
        loaded = true
    }

    func select(id: String) async {
        do {
            guard let got = try await repo.get(id: id, locationId: locationId) else {
                errorMessage = "not found"
                return
            }
            detail = got.special
            promotion = got.promotion
            editName = got.special.name
            editNotes = got.special.scratchNotes
            exportSlug = Self.slugify(got.special.name)
            exportYieldQty = ""
            exportYieldUnit = "portions"
            exportCategory = ""
            exportProcedure = ""
            exportResult = nil
            exportError = nil
            promoteName = got.promotion?.menuItemName ?? got.special.name
            promoteServings = got.promotion.map { JsValueFormat.numberString($0.servings) } ?? "1"
            promoteError = nil
            promoteSkipped = []
            errorMessage = nil
        } catch {
            errorMessage = message(for: error)
        }
    }

    func closeDetail() {
        detail = nil
        promotion = nil
    }

    /// Web `slugifyName` — lowercase, non-alphanumeric runs → '-', trim, 80 cap.
    static func slugify(_ name: String) -> String {
        var s = name.lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
        while s.hasPrefix("-") { s.removeFirst() }
        while s.hasSuffix("-") { s.removeLast() }
        return String(s.prefix(80))
    }

    var cachedCostBreakdown: [CostBreakdownLine] {
        CostBreakdownLine.parse(detail?.costBreakdown)
    }

    // ── Writes (PIN-gated) ──────────────────────────────────────────────

    func saveMeta() {
        guard let detail else { return }
        let id = detail.id
        let name = editName
        let notes = editNotes
        run {
            try self.repo.update(id: id, name: name, scratchNotes: notes, locationId: self.locationId)
        }
    }

    func deleteSelected() {
        guard let detail else { return }
        let id = detail.id
        run {
            _ = try self.repo.archive(id: id, locationId: self.locationId)
            Task { @MainActor in self.closeDetail() }
        }
    }

    func submitExport() {
        guard let detail else { return }
        exportError = nil
        exportResult = nil
        guard let qty = Double(exportYieldQty) else {
            exportError = SpecialsValidationError.yieldQtyInvalid.errorDescription
            return
        }
        let id = detail.id
        let input = SpecialsRepository.ExportInput(
            slug: exportSlug,
            yieldQty: qty,
            yieldUnit: exportYieldUnit,
            category: exportCategory.isEmpty ? nil : exportCategory,
            procedureOverride: exportProcedure.isEmpty ? nil : exportProcedure)
        run {
            let result = try self.repo.export(id: id, input: input, locationId: self.locationId)
            Task { @MainActor in self.exportResult = result }
        } onError: { message in
            self.exportError = message
        }
    }

    func submitPromote() {
        guard let detail else { return }
        promoteError = nil
        promoteSkipped = []
        let id = detail.id
        let name = promoteName.trimmingCharacters(in: .whitespacesAndNewlines)
        let servings = Double(promoteServings).flatMap { $0 > 0 ? $0 : nil } ?? 1
        run { [self] in
            let user = try ManagementWrite().requireSession(pinStore.session)
            let context = RegulatedWriteContext.nativeMac(pinUser: user)
            let result = try repo.promote(
                id: id, menuItemName: name.isEmpty ? nil : name,
                servings: servings, locationId: locationId, context: context)
            Task { @MainActor in
                self.promotion = result.promotion
                self.promoteSkipped = result.skipped
            }
        } onError: { message in
            self.promoteError = message
        }
    }

    // ── PIN session plumbing (A5 pattern) ───────────────────────────────

    private func run(_ body: @escaping () throws -> Void, onError: ((String) -> Void)? = nil) {
        guard let session = pinStore.session, session.isValid else {
            pendingAction = { self.run(body, onError: onError) }
            showPinSheet = true
            return
        }
        isSaving = true
        defer { isSaving = false }
        do {
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            try body()
            errorMessage = nil
            Task { await refreshAfterWrite() }
        } catch {
            let msg = message(for: error)
            if let onError { onError(msg) } else { errorMessage = msg }
        }
    }

    func pinAccepted() {
        showPinSheet = false
        let pending = pendingAction
        pendingAction = nil
        pending?()
    }

    private func refreshAfterWrite() async {
        await refresh()
        if let id = detail?.id {
            if let got = try? await repo.get(id: id, locationId: locationId) {
                detail = got.special
                promotion = got.promotion ?? promotion
            }
        }
    }

    private func message(for error: Error) -> String {
        if let e = error as? SpecialsValidationError { return e.errorDescription ?? "invalid input" }
        if let e = error as? SpecialsWriteError { return e.errorDescription ?? "write failed" }
        return WriteErrorMapper.message(for: error)
    }
}
