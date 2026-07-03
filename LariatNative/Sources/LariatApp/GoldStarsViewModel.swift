import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `house.goldStars` — parity with `app/gold-stars/GoldStarBoard.tsx`
/// + `/api/gold-stars`. The board read is open; awarding AND removing are
/// manager authority (the web routes `requirePin` both) — natively gated
/// per-write with `PinEntrySheet` + `ManagementWrite.requireSession`, the
/// same pattern as the A5 manager boards. Writes tag
/// `actor_source = native_mac`.
///
/// Roster parity: the web board fetches /api/staff; natively `StaffCatalog`
/// reads the same `data/cache/staff.json` (active members only).
@Observable @MainActor
final class GoldStarsViewModel {
    enum ViewMode: String, CaseIterable {
        case recent = "Recent"
        case leaderboard = "Leaderboard"
    }

    private(set) var recognitions: [GoldStarRow] = []
    private(set) var leaderboard: [GoldStarLeaderboardRow] = []
    private(set) var roster: [String] = []
    /// True when `staff.json` was missing/unreadable — the award sheet falls
    /// back to manual name entry (CookIdentityPicker precedent).
    private(set) var rosterUnavailable = false
    private(set) var loaded = false
    var fetchError: String?
    var errorMessage: String?
    var isSaving = false
    var viewMode: ViewMode = .recent
    var showAwardSheet = false
    var showPinSheet = false
    var searchText = ""

    // Award form (GoldStarBoard.tsx modal).
    var selectedCook = ""
    var reason = ""
    var starCount = 1

    let pinStore: PinSessionStore
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    private let poller = BoardPoller()
    private var pendingAction: (() -> Void)?
    /// Whether the queued PIN-gated action is an award (so a cancelled PIN
    /// can re-open the award sheet without losing the typed reason).
    private var pendingActionIsAward = false

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
        // Web parity: roster from staff.json, active members, "First Last".
        // A missing/unreadable cache degrades to manual name entry in the
        // award sheet instead of a permanently disabled picker.
        do {
            self.roster = try StaffCatalog.load().map(\.displayName)
        } catch {
            self.roster = []
            self.rosterUnavailable = true
        }
    }

    var writeDatabase: LariatWriteDatabase { writeDB }

    private var repo: GoldStarsRepository {
        GoldStarsRepository(readDB: readDB, writeDB: writeDB)
    }

    var visibleRecognitions: [GoldStarRow] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return recognitions }
        return recognitions.filter {
            $0.cookName.lowercased().contains(q) || $0.reason.lowercased().contains(q)
        }
    }

    var visibleLeaderboard: [GoldStarLeaderboardRow] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return leaderboard }
        return leaderboard.filter { $0.cookName.lowercased().contains(q) }
    }

    func start() {
        poller.start(interval: .seconds(5)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        do {
            recognitions = try await repo.board(locationId: locationId)
            leaderboard = try await repo.leaderboard(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load gold stars"
        }
        loaded = true
    }

    func openAwardSheet() {
        selectedCook = ""
        reason = ""
        starCount = 1
        errorMessage = nil
        showAwardSheet = true
    }

    // ── PIN-gated write requests ─────────────────────────────────────────

    func requestAward() {
        errorMessage = nil
        // Board-level checks before the write (GoldStarBoard.tsx submit).
        selectedCook = selectedCook.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !selectedCook.isEmpty, !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Cook and reason needed"
            return
        }
        gate(isAward: true) { [weak self] in self?.performAward() }
    }

    func requestRemove(_ record: GoldStarRow) {
        errorMessage = nil
        gate { [weak self] in self?.performRemove(id: record.id) }
    }

    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        let action = pendingAction
        pendingAction = nil
        pendingActionIsAward = false
        action?()
    }

    /// PIN sheet dismissed without verifying (HostStand `pinCancelled`
    /// precedent): drop the queued write. If it was an award, re-open the
    /// award sheet — the form values still live on the VM, so the typed
    /// reason isn't lost.
    func pinCancelled() {
        guard pendingAction != nil else { return }
        let wasAward = pendingActionIsAward
        pendingAction = nil
        pendingActionIsAward = false
        if wasAward { showAwardSheet = true }
    }

    private func gate(isAward: Bool = false, _ action: @escaping () -> Void) {
        if pinStore.activeUser != nil {
            action()
        } else {
            pendingAction = action
            pendingActionIsAward = isAward
            showPinSheet = true
        }
    }

    // ── writes ───────────────────────────────────────────────────────────

    private func performAward() {
        withSession { context in
            _ = try repo.award(
                cookName: selectedCook,
                reason: reason,
                stars: starCount,
                context: context
            )
            showAwardSheet = false
            viewMode = .recent
        }
    }

    private func performRemove(id: Int64) {
        withSession { context in
            try repo.remove(id: id, context: context)
        }
    }

    private func withSession(_ body: (RegulatedWriteContext) throws -> Void) {
        isSaving = true
        defer { isSaving = false }
        do {
            let user = try ManagementWrite().requireSession(pinStore.session)
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            try body(RegulatedWriteContext.nativeMac(pinUser: user))
            Task { await refresh() }
        } catch {
            errorMessage = WriteErrorMapper.message(for: error)
        }
    }
}
