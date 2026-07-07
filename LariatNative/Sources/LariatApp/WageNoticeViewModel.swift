import Foundation
import LariatDB
import LariatModel
import Observation

/// Wage-notices board view model — parity with `WageNoticesBoard.jsx` +
/// `/api/wage-notices` (A3 / L4, CO Wage Theft Transparency Act §8-4-103). Reads
/// the latest notice + freshness per cook (open); signing a notice is a payroll
/// record, gated per-write by the native manager PIN (`PinSessionStore` +
/// `ManagementWrite.requireSession`, the analog of the web `pic.wage_notices`
/// scope). Writes are `native_mac`, audited in-transaction. Money is Int cents;
/// the form converts dollars → cents via `Decimal` (half-away-from-zero).
@Observable @MainActor
final class WageNoticeViewModel {
    var rows: [WageNoticeRow] = []
    var freshness: [NoticeFreshness] = []
    var fetchError: String?
    var submitError: String?
    var showForm = false
    var showPinSheet = false

    // Sign form state.
    var cookId = ""
    var reason: WageNoticeReason = .hire
    var payBasis: WageNoticePayBasis = .hourly
    var wageText = ""      // dollars
    var tipText = ""       // dollars (only when tipped)
    var signedOn = ShiftDate.todayISO()

    let pinStore: PinSessionStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

    /// Pending write — captured when a sign needs a PIN unlock first. Resumed
    /// by `pinVerified` regardless of sheet state, so dismissing the sign sheet
    /// can't silently drop the typed notice (PR #401 pattern).
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
        let repo = WageNoticeRepository(readDB: readDB, writeDB: writeDB)
        do {
            let board = try await repo.loadBoard(today: today, locationId: locationId)
            rows = board.latestPerCook
            freshness = board.freshness
            fetchError = nil
        } catch {
            fetchError = "Could not load wage notices"
        }
    }

    func workerName(_ cookId: String) -> String {
        if let s = staff.first(where: { $0.id == cookId }) {
            let name = s.displayName
            return name.isEmpty ? cookId : name
        }
        return cookId
    }

    func needsNew(_ cookId: String) -> Bool {
        freshness.first { $0.cookId == cookId }?.needsNew ?? false
    }

    /// Dollars → integer cents (half-away-from-zero), matching web `Math.round(n*100)`.
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

    // ── Submit (sign) — PIN-gated ──────────────────────────────────────

    func requestSubmit() {
        submitError = nil
        guard !cookId.isEmpty else { submitError = "Pick a worker."; return }
        guard let cents = dollarsToCents(wageText), cents >= 0 else { submitError = "Enter a valid wage rate."; return }
        _ = cents
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
        guard let wageCents = dollarsToCents(wageText), wageCents >= 0 else { submitError = "Enter a valid wage rate."; return }
        // Tip credit only when tipped + a value was entered.
        let tipCents: Int? = (payBasis == .tipped && !tipText.trimmingCharacters(in: .whitespaces).isEmpty)
            ? dollarsToCents(tipText) : nil
        do {
            let user = try ManagementWrite().requireSession(pinStore.session)
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            let context = RegulatedWriteContext.nativeMac(pinUser: user)
            let repo = WageNoticeRepository(readDB: readDB, writeDB: writeDB)
            _ = try repo.sign(
                input: WageNoticeSignInput(
                    cookId: cookId, reason: reason.rawValue, payBasis: payBasis.rawValue,
                    wageRateCents: wageCents, tipCreditCents: tipCents, signedOn: signedOn
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
        reason = .hire
        payBasis = .hourly
        wageText = ""
        tipText = ""
        signedOn = ShiftDate.todayISO()
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
