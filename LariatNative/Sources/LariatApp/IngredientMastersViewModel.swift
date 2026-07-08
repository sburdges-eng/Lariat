import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `costing.ingredientMasters` — the operator review surface for the
/// `ingredient_masters` table. Mirrors `app/costing/ingredient-masters/page.jsx`
/// (list + filter + search) and `MarkReviewedButton.jsx` (the one write action
/// exposed today: stamp `last_reviewed = datetime('now')`).
///
/// **Phase C1 verify-41 fix.** The web route PIN-gates BOTH the read
/// (`requirePin` GET + `/api/costing` middleware) and the write. The native port
/// previously gated neither here: `refresh()` polled regardless of PIN, and
/// `markReviewed` accepted `pinUser ?? activeUser` where nil was valid — so a
/// cook with no manager session could read costing masters and stamp an audited
/// `correction`. Now the read is guarded by `RegulatedReadGate` and the write by
/// `ManagementWrite.requireSession` + `validateActiveUser`, matching the sibling
/// `PackChangesView` and the web `requirePin`.
@Observable @MainActor final class IngredientMastersViewModel {
    var rows: [IngredientMasterRow] = []
    var query: String = ""
    var filter: IngredientMasterFilter = .needsReview   // View default mirrors page.jsx L49-53
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    /// Read-gate state; the View shows a locked panel when not `.open`.
    var gate: RegulatedReadGateState = .open
    var showPinSheet = false

    /// False when the write DB failed to open — the view disables "Mark
    /// reviewed" and shows a read-only banner instead of letting the click
    /// fail after the fact.
    let canWrite: Bool

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?
    private let repo: IngredientMastersRepository
    private let pinStore: PinSessionStore
    private let locationId: String

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase?,
        pinStore: PinSessionStore = .shared,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.canWrite = writeDB != nil
        self.repo = IngredientMastersRepository(readDB: readDB, writeDB: writeDB)
        self.pinStore = pinStore
        self.locationId = locationId
    }

    var writeDatabase: LariatWriteDatabase? { writeDB }

    /// `PinVerifier.gateConfigured` with the same DB-then-env fallback ladder as
    /// `MorningViewModel.evaluateGate`.
    private func gateConfigured() -> Bool {
        do {
            if let writeDB {
                return try writeDB.pool.read { db in
                    try PinVerifier().gateConfigured(db: db, locationId: locationId)
                }
            }
            return try readDB.pool.read { db in
                try PinVerifier().gateConfigured(db: db, locationId: locationId)
            }
        } catch {
            return PinVerifier().gateConfigured()
        }
    }

    func refresh() async {
        // Read gate (C1 verify-41): the web route requirePin's this GET. Do not
        // fetch costing masters without an active manager session.
        let state = RegulatedReadGate.evaluate(
            gateConfigured: gateConfigured(),
            hasActiveUser: pinStore.activeUser != nil,
            canUnlock: writeDB != nil
        )
        gate = state
        guard state == .open else {
            rows = []            // never leave protected rows on screen while locked
            fetchError = nil
            return
        }
        do {
            rows = try await repo.list(q: query.isEmpty ? nil : query, filter: filter)
            fetchError = nil
        } catch {
            fetchError = "Could not load ingredient masters"
        }
    }

    func requestUnlock() {
        guard writeDB != nil else { return }
        showPinSheet = true
    }

    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        showPinSheet = false
        Task { await refresh() }
    }

    /// Write gate (C1 verify-41): the web route requirePin's this correction.
    /// Require a valid manager session + DB-active user, mirroring PackChanges.
    /// Kept synchronous so the `pool.read` closure runs in a non-async context
    /// (calling the `@MainActor` `validateActiveUser` from an async closure is
    /// rejected by strict isolation checking).
    private func ensureWriteAllowed() throws {
        _ = try ManagementWrite().requireSession(pinStore.session)
        if let writeDB {
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
        }
    }

    /// MarkReviewedButton parity: `updates.last_reviewed = 'now'`.
    func markReviewed(masterId: String) async {
        actionError = nil
        do {
            try ensureWriteAllowed()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
            showPinSheet = true
            return
        }
        isSaving = true
        defer { isSaving = false }
        var updates = IngredientMasterUpdates()
        updates.lastReviewed = .set(.now)
        do {
            let context = RegulatedWriteContext.nativeMac(pinUser: pinStore.activeUser)
            _ = try repo.updateMaster(masterId, updates: updates, context: context)
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }
}
