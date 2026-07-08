import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `foh.host` — parity with `app/host/page.jsx` + `HostStand.jsx`:
/// active waitlist + tonight's seated parties, the add-party form, and the
/// waiting → seated|left transitions.
///
/// PIN posture: `/host` + `/api/host` are middleware-gated on web (401 on
/// every method without the PIN cookie). Natively the WRITES are gated via
/// `ManagementWrite.requireSession` + `PinSessionStore` + `PinEntrySheet`
/// (VendorLink precedent); reads stay open per native precedent. The
/// write context is `native_mac` (manager PIN session) — waitlist rows
/// carry no actor column, and the JSONL audit entries mirror the web's
/// field set, which records none either.
@Observable @MainActor
final class HostStandViewModel {
    var snapshot: WaitlistSnapshot?
    var fetchError: String?
    var actionError: String?
    var isBusy = false
    var showPinSheet = false
    /// Read gate (C1 verify-41 T4): `/api/host` GET is middleware-gated on web
    /// (401 without the PIN cookie). The View shows a locked panel when not `.open`.
    var gate: RegulatedReadGateState = .open

    let pinStore: PinSessionStore
    let poller = BoardPoller()
    private var pendingAction: (() -> Void)?
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String

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

    var waiting: [WaitlistPartyRow] {
        snapshot?.parties.filter { $0.status == "waiting" } ?? []
    }

    var seatedToday: [WaitlistPartyRow] {
        snapshot?.parties.filter { $0.status == "seated" } ?? []
    }

    func start() {
        poller.start(interval: .seconds(5)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    /// Sync so the `pool.read` closure runs off the async path (strict actor
    /// isolation rejects calling into it from an async closure).
    private func evaluateReadGate() -> RegulatedReadGateState {
        let gateOn = (try? writeDB.pool.read { db in
            try PinVerifier().gateConfigured(db: db, locationId: self.locationId)
        }) ?? PinVerifier().gateConfigured()
        return RegulatedReadGate.evaluate(
            gateConfigured: gateOn,
            hasActiveUser: pinStore.activeUser != nil,
            canUnlock: true
        )
    }

    func requestUnlock() { showPinSheet = true }

    func refresh() async {
        // Read gate (C1 verify-41 T4): web /api/host is PIN-gated on every method.
        // Guest PII (party names, phones, notes) must not auto-poll without a PIN.
        gate = evaluateReadGate()
        guard gate == .open else {
            snapshot = nil
            fetchError = nil
            return
        }
        let repo = HostWaitlistRepository(readDB: readDB, writeDB: writeDB)
        do {
            snapshot = try await repo.load(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load the waitlist"
        }
    }

    // ── PIN-gated writes ─────────────────────────────────────────────────

    /// Add-party submit; `onSaved` runs only on success (view clears form).
    func requestAddParty(
        partyName: String,
        partySizeText: String,
        phone: String,
        notes: String,
        onSaved: @escaping () -> Void
    ) {
        let sizeNum = Double(partySizeText.trimmingCharacters(in: .whitespaces))
        runGated { [weak self] in
            self?.performAddParty(
                partyName: partyName, partySize: sizeNum,
                phone: phone, notes: notes, onSaved: onSaved
            )
        }
    }

    func requestTransition(id: Int64, to next: String) {
        runGated { [weak self] in
            self?.performTransition(id: id, to: next)
        }
    }

    /// After the PIN sheet succeeds, resume the pending write.
    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        let pending = pendingAction
        pendingAction = nil
        // A pending write resumes; a bare read unlock just refreshes so the
        // now-permitted waitlist loads.
        if let pending { pending() } else { Task { await refresh() } }
    }

    func pinCancelled() {
        pendingAction = nil
    }

    private func runGated(_ action: @escaping () -> Void) {
        actionError = nil
        guard ensureGateConfigured() else { return }
        if pinStore.activeUser != nil {
            action()
        } else {
            pendingAction = action
            showPinSheet = true
        }
    }

    private func performAddParty(
        partyName: String,
        partySize: Double?,
        phone: String,
        notes: String,
        onSaved: @escaping () -> Void
    ) {
        guard !isBusy else { return }
        isBusy = true
        actionError = nil
        defer { isBusy = false }
        do {
            try requireSession()
            let repo = HostWaitlistRepository(readDB: readDB, writeDB: writeDB)
            _ = try repo.addParty(
                input: WaitlistAddInput(
                    partyName: partyName,
                    partySize: partySize,
                    phone: phone.isEmpty ? nil : phone,
                    notes: notes.isEmpty ? nil : notes
                ),
                locationId: locationId
            )
            onSaved()
            Task { await refresh() }
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    private func performTransition(id: Int64, to next: String) {
        guard !isBusy else { return }
        isBusy = true
        actionError = nil
        defer { isBusy = false }
        do {
            try requireSession()
            let repo = HostWaitlistRepository(readDB: readDB, writeDB: writeDB)
            _ = try repo.transition(id: id, to: next)
            Task { await refresh() }
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    private func requireSession() throws {
        _ = try ManagementWrite().requireSession(pinStore.session)
        try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
    }

    private func ensureGateConfigured() -> Bool {
        do {
            let gateOn = try writeDB.pool.read { db in try PinVerifier().gateConfigured(db: db) }
            guard gateOn else {
                actionError = "PIN not set up — add a manager PIN in web Settings"
                return false
            }
            return true
        } catch {
            actionError = WriteErrorMapper.message(for: error)
            return false
        }
    }
}
