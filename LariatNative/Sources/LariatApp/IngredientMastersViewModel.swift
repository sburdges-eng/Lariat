import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `costing.ingredientMasters` — the operator review surface for the
/// `ingredient_masters` table. Mirrors `app/costing/ingredient-masters/page.jsx`
/// (list + filter + search) and `MarkReviewedButton.jsx` (the one write action
/// exposed today: stamp `last_reviewed = datetime('now')`).
///
/// Reads are NOT PIN-gated in native (matches the priceShocks/varianceAttribution/
/// depletionExceptions precedent — the web route IS PIN-gated via middleware,
/// but native manager/costing-tier reads aren't per-view gated today).
///
/// The write (`markReviewed`) goes through `IngredientMastersRepository.updateMaster`,
/// which is audited (`action='correction'`, `actor_source='native_mac'`) in one
/// transaction with the UPDATE. `actorCookId` comes from the active manager-PIN
/// session if one exists; the write proceeds even with no active session
/// (`RegulatedWriteContext.nativeMac(pinUser: nil)` still produces a valid
/// context — this board has no per-write PIN gate, matching the plan's Task 4
/// interface, which takes `pinUser` as an optional).
@Observable @MainActor final class IngredientMastersViewModel {
    var rows: [IngredientMasterRow] = []
    var query: String = ""
    var filter: IngredientMasterFilter = .needsReview   // View default mirrors page.jsx L49-53
    var fetchError: String?
    var actionError: String?
    var isSaving = false

    /// False when the write DB failed to open — the view disables "Mark
    /// reviewed" and shows a read-only banner instead of letting the click
    /// fail after the fact.
    let canWrite: Bool

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?
    private let repo: IngredientMastersRepository
    private let pinUser: ManagerPinUser?
    private let locationId: String

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase?,
        pinUser: ManagerPinUser? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.canWrite = writeDB != nil
        self.repo = IngredientMastersRepository(readDB: readDB, writeDB: writeDB)
        self.pinUser = pinUser
        self.locationId = locationId
    }

    func refresh() async {
        do {
            rows = try await repo.list(q: query.isEmpty ? nil : query, filter: filter)
            fetchError = nil
        } catch {
            fetchError = "Could not load ingredient masters"
        }
    }

    /// MarkReviewedButton parity: `updates.last_reviewed = 'now'`.
    func markReviewed(masterId: String) async {
        actionError = nil
        isSaving = true
        defer { isSaving = false }
        var updates = IngredientMasterUpdates()
        updates.lastReviewed = .set(.now)
        do {
            let user = pinUser ?? PinSessionStore.shared.activeUser
            let context = RegulatedWriteContext.nativeMac(pinUser: user)
            _ = try repo.updateMaster(masterId, updates: updates, context: context)
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }
}
