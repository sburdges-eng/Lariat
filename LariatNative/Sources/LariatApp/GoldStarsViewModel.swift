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
    private var pollTask: Task<Void, Never>?
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
        // Web parity: roster from staff.json, active members, "First Last".
        self.roster = (try? StaffCatalog.load())?.map(\.displayName) ?? []
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
        guard !selectedCook.isEmpty, !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Cook and reason needed"
            return
        }
        gate { [weak self] in self?.performAward() }
    }

    func requestRemove(_ record: GoldStarRow) {
        errorMessage = nil
        gate { [weak self] in self?.performRemove(id: record.id) }
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
