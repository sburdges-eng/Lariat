import Foundation
import LariatDB
import LariatModel
import Observation

enum EightySixReasonCode: String, CaseIterable, Identifiable {
    case out, spoiled, dropped, noMake = "no_make", burned, prepShort = "prep_short", other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .out: return "Out"
        case .spoiled: return "Spoiled"
        case .dropped: return "Dropped"
        case .noMake: return "No make"
        case .burned: return "Burned"
        case .prepShort: return "Prep short"
        case .other: return "Other"
        }
    }
}

@Observable @MainActor
final class EightySixViewModel {
    var snapshot: EightySixBoardSnapshot?
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    var confirmCascade: CascadedRecipe?
    private var resolvingIds: Set<Int64> = []
    private let poller = BoardPoller()

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let catalog: StationCatalog
    let cookStore: CookIdentityStore
    private let locationId: String

    var stations: [KitchenStation] { catalog.stations }
    var showCookPicker = false
    var staff: [StaffMember] = []
    var staffUnavailable = false

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase,
        catalog: StationCatalog,
        cookStore: CookIdentityStore? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.catalog = catalog
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
        let repo = EightySixRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        do {
            snapshot = try await repo.load(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load 86 board"
        }
    }

    func isResolving(_ id: Int64) -> Bool { resolvingIds.contains(id) }

    /// Returns true only when the 86 row committed. An identity interrupt
    /// (picker presented) returns false with actionError still nil — the view
    /// must keep its typed fields and stash a retry.
    @discardableResult
    func add(
        item: String,
        stationId: String,
        reason: EightySixReasonCode,
        quantity: String
    ) async -> Bool {
        guard !isSaving else { return false }
        guard ensureCookIdentity() else { return false }

        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = EightySixRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.add(
                input: EightySixAddInput(
                    item: item,
                    stationId: stationId.isEmpty ? nil : stationId,
                    reason: reason.rawValue,
                    quantity: quantity.isEmpty ? nil : quantity,
                    cookId: cookStore.cookId,
                    shiftDate: ShiftDate.todayISO()
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
    func resolve(id: Int64) async -> Bool {
        guard !resolvingIds.contains(id) else { return false }
        guard ensureCookIdentity() else { return false }

        resolvingIds.insert(id)
        actionError = nil
        defer { resolvingIds.remove(id) }

        let repo = EightySixRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.resolve(id: id, context: context)
            await refresh()
            return true
        } catch {
            actionError = WriteErrorMapper.message(for: error)
            return false
        }
    }

    @discardableResult
    func confirmCascadeAdd(_ recipe: CascadedRecipe) async -> Bool {
        confirmCascade = nil
        return await add(item: recipe.name, stationId: "", reason: .prepShort, quantity: "")
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
