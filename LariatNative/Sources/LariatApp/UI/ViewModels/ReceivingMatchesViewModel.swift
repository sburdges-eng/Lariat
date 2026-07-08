import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `manager.receivingMatches` — parity with
/// `app/management/receiving-matches/page.jsx` + `ReceivingMatchResolver.jsx`.
/// The queue read mirrors the page's `readQueue` (LIMIT 100); the resolve
/// write is PIN-gated per-write (the native analog of the PATCH route's
/// `requirePin`) and runs `ReceivingRepository.resolveMatch` — one
/// transaction: receiving UPDATE + closed-loop credit + both audit rows.
@Observable @MainActor
final class ReceivingMatchesViewModel {
    private(set) var queue: [ReceivingRow] = []
    private(set) var masters: [ReceivingMasterOption] = []
    private(set) var loaded = false
    var fetchError: String?
    var errorMessage: String?
    var isSaving = false
    var showPinSheet = false
    var searchText = ""

    /// Per-row master pick (mirrors the per-row `<select>` in the web resolver).
    var selections: [Int64: String] = [:]

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

    private var repo: ReceivingRepository {
        ReceivingRepository(readDB: readDB, writeDB: writeDB)
    }

    func refresh() async {
        do {
            queue = try await repo.loadUnmatched(locationId: locationId)
            masters = try await repo.masterOptions()
            fetchError = nil
        } catch {
            fetchError = "Could not load receiving matches"
        }
        loaded = true
    }

    /// Native `.searchable` narrowing by vendor / item / SKU / reason.
    var visibleQueue: [ReceivingRow] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return queue }
        return queue.filter { row in
            row.vendor.lowercased().contains(q)
                || (row.item?.lowercased().contains(q) ?? false)
                || (row.vendorSku?.lowercased().contains(q) ?? false)
                || (row.matchReason?.lowercased().contains(q) ?? false)
        }
    }

    /// Page `fmtQty` — "-" when qty/unit is missing.
    func qtyText(_ row: ReceivingRow) -> String {
        guard let qty = row.receivedQty, let unit = row.receivedUnit, !unit.isEmpty else { return "-" }
        return "\(ReceivingRepository.numberText(qty)) \(unit)"
    }

    /// Page reason column: `match_reason || match_status`.
    func reasonText(_ row: ReceivingRow) -> String {
        row.matchReason ?? row.matchStatus ?? "-"
    }

    func canResolve(_ row: ReceivingRow) -> Bool {
        !(selections[row.id] ?? "").isEmpty && !isSaving
    }

    // ── PIN-gated resolve ────────────────────────────────────────────────

    func requestResolve(_ row: ReceivingRow) {
        errorMessage = nil
        guard let masterId = selections[row.id], !masterId.isEmpty else { return }
        gate { [weak self] in self?.performResolve(rowId: row.id, masterId: masterId) }
    }

    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        let action = pendingAction
        pendingAction = nil
        action?()
    }

    private func gate(_ action: @escaping () -> Void) {
        if pinStore.activeUser != nil {
            action()
        } else {
            pendingAction = action
            showPinSheet = true
        }
    }

    private func performResolve(rowId: Int64, masterId: String) {
        isSaving = true
        defer { isSaving = false }
        do {
            let user = try ManagementWrite().requireSession(pinStore.session)
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            // Web PATCH resolves location from the page's `location_id` body
            // field — the board's location, not the PIN user's home location.
            let context = RegulatedWriteContext(
                actorCookId: user.id == 0 ? nil : String(user.id),
                actorSource: RegulatedWriteContext.nativeMacActorSource,
                locationId: locationId,
                shiftDate: ShiftDate.todayISO()
            )
            // Web resolver sends the picked cook identity when one is set;
            // natively the manager-PIN user id is the acting identity.
            _ = try repo.resolveMatch(
                id: rowId, masterId: masterId,
                cookId: context.actorCookId, context: context
            )
            selections[rowId] = nil
            Task { await refresh() }
        } catch {
            errorMessage = WriteErrorMapper.message(for: error)
        }
    }
}
