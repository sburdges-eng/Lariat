import Foundation
import LariatDB
import LariatModel
import Observation

/// Staff-certifications board view model — parity with `CertBoard.jsx` +
/// `/api/certifications`. Reads are OPEN (the board lists every tracked cert);
/// recording and retiring certs are PIC authority in the web app (route 403
/// without the manager PIN). Here the write actions are gated per-write by the
/// native manager PIN (`PinSessionStore` + `ManagementWrite.requireSession`),
/// the native analog of the web `pic.staff_certs` scope. Regulated writes are
/// tagged `native_mac` via `RegulatedWriteContext.nativeMac` and audited
/// in-transaction.
@Observable @MainActor
final class StaffCertViewModel {
    var rows: [StaffCertRow] = []
    var fetchError: String?
    var submitError: String?
    var showForm = false
    var showPinSheet = false

    // Add-cert form state (mirrors the JSX component state).
    var cookId = ""
    var certType: StaffCertType = .cfpm
    var certLabel = ""
    var issuer = ""
    var certNumber = ""
    var issuedOn = ""
    var expiresOn = ""

    /// Pending write — captured when a submit/retire needs a PIN unlock first.
    /// Resumed by `pinVerified` regardless of sheet state, so dismissing the
    /// form sheet can't silently drop the typed cert (PR #401 pattern).
    private var pendingAction: (() -> Void)?

    let pinStore: PinSessionStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

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

    /// Whether the add/retire surfaces are unlocked — the web PIC gate. A valid
    /// manager PIN session enables the write actions.
    var pinOk: Bool { pinStore.activeUser != nil }

    /// Today (UTC) for tone classification — matches the web `todayISO()` the
    /// page passes into the board.
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
        let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
        do {
            rows = try await repo.load(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load certifications"
        }
    }

    /// Tone bucket for a row — delegates to `StaffCertCompute.tone` so the board
    /// and the Command cert-expiry alert never disagree.
    func tone(for row: StaffCertRow) -> StaffCertTone {
        StaffCertCompute.tone(active: row.active, expiresOn: row.expiresOn, today: today)
    }

    /// Whole-day expiry delta for the "Nd left / expired Nd ago" subtitle. nil ⇒
    /// no expiry (the board shows "no expiry").
    func daysLeft(for row: StaffCertRow) -> Int? {
        StaffCertCompute.daysUntilExpiry(today: today, expires: row.expiresOn)
    }

    /// Display name for a cert's worker id via the staff catalog (mirrors the
    /// board's `staff.find(...)` name lookup).
    func workerName(_ cookId: String) -> String {
        if let s = staff.first(where: { $0.id == cookId }) {
            let name = s.displayName
            return name.isEmpty ? cookId : name
        }
        return cookId
    }

    // ── Add a cert (PIN-gated) ─────────────────────────────────────────

    func requestSubmit() {
        submitError = nil
        guard !cookId.isEmpty else { submitError = "Pick a worker."; return }
        guard !certLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            submitError = "Cert label is required."
            return
        }
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
        do {
            let user = try ManagementWrite().requireSession(pinStore.session)
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            let context = RegulatedWriteContext.nativeMac(pinUser: user)
            let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
            _ = try repo.create(
                input: StaffCertCreateInput(
                    cookId: cookId,
                    certType: certType.rawValue,
                    certLabel: certLabel.trimmingCharacters(in: .whitespacesAndNewlines),
                    issuer: issuer.isEmpty ? nil : issuer,
                    certNumber: certNumber.isEmpty ? nil : certNumber,
                    issuedOn: issuedOn.isEmpty ? nil : issuedOn,
                    expiresOn: expiresOn.isEmpty ? nil : expiresOn
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

    // ── Retire a cert (soft-delete, PIN-gated) ─────────────────────────

    func requestRetire(id: Int64) {
        submitError = nil
        guard ensureGateConfigured() else { return }
        if pinStore.activeUser != nil {
            performRetire(id: id)
        } else {
            pendingAction = { [weak self] in self?.performRetire(id: id) }
            showPinSheet = true
        }
    }

    private func performRetire(id: Int64) {
        submitError = nil
        do {
            let user = try ManagementWrite().requireSession(pinStore.session)
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            let context = RegulatedWriteContext.nativeMac(pinUser: user)
            let repo = StaffCertRepository(readDB: readDB, writeDB: writeDB)
            _ = try repo.retire(id: id, context: context)
            Task { await refresh() }
        } catch {
            submitError = WriteErrorMapper.message(for: error)
        }
    }

    /// After the PIN sheet succeeds, resume whichever write triggered it.
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
        certLabel = ""
        issuer = ""
        certNumber = ""
        issuedOn = ""
        expiresOn = ""
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
