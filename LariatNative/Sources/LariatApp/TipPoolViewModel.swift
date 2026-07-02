import Foundation
import LariatDB
import LariatModel
import Observation

/// Tip-pool board view model — parity with `TipPoolBoard.jsx` + `/api/tip-pool`
/// (A3 / L3, COMPS #39). Reads the day's distribution lines + summary (open);
/// recording a line is payroll-sensitive and gated per-write by the native
/// manager PIN (`PinSessionStore` + `ManagementWrite.requireSession`, the analog
/// of the web `pic.tip_pool` scope). Writes are `native_mac`, audited
/// in-transaction. Money is INTEGER cents end-to-end; the form converts dollars
/// → cents via `Decimal` (half-away-from-zero) to avoid binary-fraction drift.
@Observable @MainActor
final class TipPoolViewModel {
    var rows: [TipDistributionRow] = []
    var summary: PoolSummary = PoolSummary(totalCents: 0, byCook: [:], byKind: [:])
    var comps: TipPoolRepository.CompsConfig = .compsDefault
    var fetchError: String?
    var submitError: String?
    var showForm = false
    var showPinSheet = false

    // Add-line form state.
    var cookId = ""
    var role = ""
    var kind: TipKind = .tip_pool
    var poolRef = ""
    var amountText = ""       // dollars
    var note = ""

    let pinStore: PinSessionStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    private let poller = BoardPoller()

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
    var today: String { ShiftDate.todayISO() }

    func start() {
        poller.start(interval: .seconds(5)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        let repo = TipPoolRepository(readDB: readDB, writeDB: writeDB)
        do {
            let pool = try await repo.loadPool(date: today, locationId: locationId)
            rows = pool.rows
            summary = pool.summary
            comps = pool.comps
            fetchError = nil
        } catch {
            fetchError = "Could not load tip pool"
        }
    }

    func workerName(_ cookId: String) -> String {
        if let s = staff.first(where: { $0.id == cookId }) {
            let name = s.displayName
            return name.isEmpty ? cookId : name
        }
        return cookId
    }

    /// Dollars → integer cents (half-away-from-zero), matching the web
    /// `Math.round(n * 100)`. Uses `Decimal` so `0.29` etc. don't drift.
    func dollarsToCents(_ s: String) -> Int? {
        let trimmed = s.trimmingCharacters(in: .whitespaces)
        guard let dollars = Decimal(string: trimmed), dollars >= 0 else { return nil }
        let handler = NSDecimalNumberHandler(
            roundingMode: .plain, scale: 0,
            raiseOnExactness: false, raiseOnOverflow: false,
            raiseOnUnderflow: false, raiseOnDivideByZero: false
        )
        return NSDecimalNumber(decimal: dollars * 100).rounding(accordingToBehavior: handler).intValue
    }

    // ── Submit (add a line) — PIN-gated ────────────────────────────────

    func requestSubmit() {
        submitError = nil
        guard !cookId.isEmpty else { submitError = "Pick a worker."; return }
        guard !poolRef.trimmingCharacters(in: .whitespaces).isEmpty else { submitError = "Pool reference is required."; return }
        guard let cents = dollarsToCents(amountText), cents >= 0 else { submitError = "Enter a valid amount."; return }
        _ = cents
        guard ensureGateConfigured() else { return }
        if pinStore.activeUser != nil {
            performSubmit()
        } else {
            showPinSheet = true
        }
    }

    private func performSubmit() {
        submitError = nil
        guard let cents = dollarsToCents(amountText), cents >= 0 else { submitError = "Enter a valid amount."; return }
        do {
            let user = try ManagementWrite().requireSession(pinStore.session)
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            let context = RegulatedWriteContext.nativeMac(pinUser: user)
            let repo = TipPoolRepository(readDB: readDB, writeDB: writeDB)
            let trimmedRole = role.trimmingCharacters(in: .whitespacesAndNewlines)
            let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
            _ = try repo.add(
                input: TipDistributionInput(
                    shiftDate: today,
                    poolRef: poolRef.trimmingCharacters(in: .whitespacesAndNewlines),
                    cookId: cookId,
                    role: trimmedRole.isEmpty ? nil : trimmedRole,
                    kind: kind.rawValue,
                    amountCents: cents,
                    note: trimmedNote.isEmpty ? nil : trimmedNote
                ),
                context: context
            )
            resetForm()
            showForm = false
            Task { await refresh() }
        } catch {
            submitError = WriteErrorMapper.message(for: error)
        }
    }

    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        if showForm { performSubmit() }
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func ensureGateConfigured() -> Bool {
        do {
            let gateOn = try writeDB.pool.read { db in try PinVerifier().gateConfigured(db: db) }
            guard gateOn else {
                submitError = "PIN not set up — add a manager PIN in web Settings"
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
        role = ""
        poolRef = ""
        amountText = ""
        note = ""
        kind = .tip_pool
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
