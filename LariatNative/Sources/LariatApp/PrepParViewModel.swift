import Foundation
import LariatDB
import LariatModel
import Observation

/// Drives the cook-tier standing prep par screen. Reads the location-scoped list
/// (grouped by station) and performs the regulated upsert/delete writes through
/// `PrepParRepository` with `actor_source = native_cook`.
@Observable @MainActor
final class PrepParViewModel {
    var snapshot: PrepParBoardSnapshot?
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    var showCookPicker = false

    let cookStore: CookIdentityStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    let poller = BoardPoller()

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase,
        cookStore: CookIdentityStore? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.cookStore = cookStore ?? CookIdentityStore.shared
        self.locationId = locationId
        loadStaff()
    }

    func start() {
        poller.start(interval: .seconds(3)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        let repo = PrepParRepository(readDB: readDB, writeDB: writeDB)
        do {
            snapshot = try await repo.load(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load prep par list"
        }
    }

    /// Add / update one standing target. Mirrors the web AddPrepParRow submit —
    /// blocked when both recipe and ingredient are blank. Returns true only
    /// when the upsert committed; an identity interrupt returns false with
    /// actionError still nil so the view keeps the typed fields and retries.
    @discardableResult
    func save(recipe: String, ingredient: String, station: String, targetQty: String, unit: String, note: String) async -> Bool {
        guard !isSaving else { return false }
        let bothEmpty = recipe.trimmingCharacters(in: .whitespaces).isEmpty
            && ingredient.trimmingCharacters(in: .whitespaces).isEmpty
        if bothEmpty {
            actionError = "Fill in Recipe or Ingredient."
            return false
        }
        guard ensureCookIdentity() else { return false }
        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = PrepParRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.upsert(
                input: PrepParUpsertInput(
                    stationId: station,
                    recipeSlug: recipe,
                    ingredient: ingredient,
                    targetQty: parseNumber(targetQty),
                    unit: unit.isEmpty ? nil : unit,
                    note: note.isEmpty ? nil : note,
                    cookId: cookStore.cookId
                ),
                context: context
            )
            await refresh()
            return true
        } catch {
            actionError = WriteErrorMapper.message(for: error)
            return false
        }
    }

    @discardableResult
    func delete(id: Int64) async -> Bool {
        guard !isSaving else { return false }
        guard ensureCookIdentity() else { return false }
        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = PrepParRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            try repo.delete(id: id, context: context)
            await refresh()
            return true
        } catch {
            actionError = WriteErrorMapper.message(for: error)
            return false
        }
    }

    /// Empty string / non-numeric → nil, mirroring the web `targetQty === '' ? null : Number(targetQty)`.
    private func parseNumber(_ text: String) -> Double? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        return Double(trimmed)
    }

    private func ensureCookIdentity() -> Bool {
        if cookStore.cookId != nil { return true }
        showCookPicker = true
        return false
    }

    private func loadStaff() {
        do {
            staff = try StaffCatalog.load()
            staffUnavailable = staff.isEmpty
        } catch {
            staff = []
            staffUnavailable = true
        }
    }
}
