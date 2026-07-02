import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `manager.tempPins` — parity with `app/management/temp-pins/page.jsx`
/// + `/api/auth/temp-pin/{issue,list,revoke}`. Issuance shows the new PIN
/// ONCE (`issued` banner) and never re-displays it; if a cook loses it,
/// revoke and reissue. All writes PIN-gated per-write.
@Observable @MainActor
final class TempPinsViewModel {
    private(set) var active: [TempPinRecord] = []
    private(set) var loaded = false
    /// One-time issuance banner — the ONLY place the raw PIN ever surfaces.
    private(set) var issued: TempPinIssueResult?
    var fetchError: String?
    var errorMessage: String?
    var isSaving = false
    var showPinSheet = false

    // Issue form.
    var label = ""
    var expires: Date = TempPinsViewModel.defaultExpires()
    var selectedScopes: Set<String> = ["beo.fire_at_edit"]

    /// The full issuable scope list — the ported `KNOWN_SCOPES` (web page
    /// hard-codes just beo.fire_at_edit; the route accepts all known scopes).
    var knownScopes: [String] { TempPinRules.knownScopes }

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

    private var repo: TempPinRepository {
        TempPinRepository(readDB: readDB, writeDB: writeDB)
    }

    /// Web `defaultExpires()` — end of the current local day.
    static func defaultExpires(now: Date = Date()) -> Date {
        let cal = Calendar.current
        var comps = cal.dateComponents([.year, .month, .day], from: now)
        comps.hour = 23
        comps.minute = 59
        comps.second = 0
        return cal.date(from: comps) ?? now
    }

    func refresh() async {
        do {
            active = try await repo.listActive(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Couldn't load — refresh the page"
        }
        loaded = true
    }

    func toggleScope(_ scope: String) {
        if selectedScopes.contains(scope) {
            selectedScopes.remove(scope)
        } else {
            selectedScopes.insert(scope)
        }
    }

    // ── PIN-gated write requests ─────────────────────────────────────────

    func requestIssue() {
        errorMessage = nil
        issued = nil
        // Page-level checks before the write (page.jsx issue()).
        guard !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Add a name"
            return
        }
        guard !selectedScopes.isEmpty else {
            errorMessage = "Pick at least one scope"
            return
        }
        gate { [weak self] in self?.performIssue() }
    }

    func requestRevoke(_ pin: TempPinRecord) {
        errorMessage = nil
        gate { [weak self] in self?.performRevoke(id: pin.id) }
    }

    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        let action = pendingAction
        pendingAction = nil
        action?()
    }

    func dismissIssuedBanner() {
        issued = nil   // the PIN is unrecoverable from here on, by design
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

    private func performIssue() {
        withSession { context in
            // Scopes in KNOWN_SCOPES order for a deterministic payload.
            let scopes = knownScopes.filter { selectedScopes.contains($0) }
            issued = try repo.issue(
                label: label,
                expiresAt: TempPinRules.canonicalISO(from: expires),
                scopes: scopes,
                context: context
            )
            label = ""
        }
    }

    private func performRevoke(id: Int64) {
        withSession { context in
            _ = try repo.revoke(id: id, context: context)
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
