import Foundation
import LariatDB
import LariatModel
import Observation

/// Paid-sick-leave board view model — parity with `SickLeaveBoard.jsx` +
/// `/api/sick-leave` (A3 / L2, HFWA). Reads are OPEN (the board lists the current
/// year's balances); adding (accrual) and using hours are payroll-sensitive and
/// gated per-write by the native manager PIN (`PinSessionStore` +
/// `ManagementWrite.requireSession`, the analog of the web `pic.sick_leave`
/// scope). Regulated writes are `native_mac`, audited in-transaction. HFWA:
/// C.R.S. §8-13.3-401.
@Observable @MainActor
final class SickLeaveViewModel {
    var balances: [BalanceSummary] = []
    var fetchError: String?
    var submitError: String?
    var showForm = false
    var showPinSheet = false

    // Add/Use form state.
    var cookId = ""
    /// false → accrue (add hours, front-loaded), true → use (spend hours).
    var useMode = false
    var hoursText = ""
    var note = ""

    let pinStore: PinSessionStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

    /// Pending write — captured when a submit needs a PIN unlock first. Resumed
    /// by `pinVerified` regardless of sheet state, so dismissing the form sheet
    /// can't silently drop the typed entry (PR #401 pattern).
    private var pendingAction: (() -> Void)?

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    let poller = BoardPoller()

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
        loadStaff()
    }

    var writeDatabase: LariatWriteDatabase { writeDB }
    var pinOk: Bool { pinStore.activeUser != nil }

    /// Current accrual year (HFWA balances are per calendar year), from today (UTC).
    var accrualYear: Int { Int(ShiftDate.todayISO().prefix(4)) ?? 2026 }

    func start() {
        poller.start(interval: .seconds(5)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        let repo = SickLeaveRepository(readDB: readDB, writeDB: writeDB)
        do {
            balances = try await repo.listBalances(accrualYear: accrualYear, locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load sick time"
        }
    }

    func workerName(_ cookId: String) -> String {
        if let s = staff.first(where: { $0.id == cookId }) {
            let name = s.displayName
            return name.isEmpty ? cookId : name
        }
        return cookId
    }

    // ── Submit (accrual or use) — PIN-gated ────────────────────────────

    func requestSubmit() {
        submitError = nil
        guard !cookId.isEmpty else { submitError = "Pick a worker."; return }
        guard let hours = Double(hoursText), hours > 0 else {
            submitError = "Enter a positive number of hours."
            return
        }
        _ = hours
        guard ensureGateConfigured() else { return }
        if pinStore.activeUser != nil {
            performSubmit()
        } else {
            pendingAction = { [weak self] in self?.performSubmit() }
            showPinSheet = true
        }
    }

    private func performSubmit() {
        submitError = nil
        guard let hours = Double(hoursText), hours > 0 else {
            submitError = "Enter a positive number of hours."
            return
        }
        do {
            let user = try ManagementWrite().requireSession(pinStore.session)
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            let context = RegulatedWriteContext.nativeMac(pinUser: user)
            let repo = SickLeaveRepository(readDB: readDB, writeDB: writeDB)
            let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
            let noteArg = trimmedNote.isEmpty ? nil : trimmedNote
            if useMode {
                _ = try repo.use(
                    input: SickLeaveUseInput(cookId: cookId, accrualYear: accrualYear, hours: hours, note: noteArg),
                    context: context
                )
            } else {
                _ = try repo.accrue(
                    input: SickLeaveAccrualInput(cookId: cookId, accrualYear: accrualYear, hours: hours, note: noteArg, datedOn: ShiftDate.todayISO()),
                    context: context
                )
            }
            resetForm()
            showForm = false
            Task { await refresh() }
        } catch {
            submitError = WriteErrorMapper.message(for: error)
        }
    }

    /// Resume the pending write after the PIN sheet unlocks.
    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        let action = pendingAction
        pendingAction = nil
        action?()
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func ensureGateConfigured() -> Bool {
        do {
            let gateOn = try writeDB.pool.read { db in try PinVerifier().gateConfigured(db: db) }
            guard gateOn else {
                submitError = "PIN not set up — add one on the Manager → PINs board"
                return false
            }
            return true
        } catch {
            submitError = WriteErrorMapper.message(for: error)
            return false
        }
    }

    private func resetForm() {
        cookId = ""
        hoursText = ""
        note = ""
        useMode = false
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
