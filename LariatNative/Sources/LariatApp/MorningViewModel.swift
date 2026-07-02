import Foundation
import LariatDB
import LariatModel
import Observation

/// ViewModel for the morning digest — a PIN-gated, read-only aggregate.
///
/// Web parity: `/morning` is a manager-PIN-gated surface (middleware.js
/// SENSITIVE_PREFIXES). The GET route is read-only; there is NO regulated write
/// and NO audit event. So this VM:
///   - resolves the digest via CommandRepository (summary/alerts) +
///     MorningRepository (86/certs/maintenance/BEO/price-shocks) → MorningCompute,
///   - gates viewing behind the manager PIN when a PIN is configured, mirroring
///     the web whole-surface gate (not a per-write PIN).
@Observable @MainActor final class MorningViewModel {
    /// Gate state for the surface.
    enum Gate: Equatable {
        case checking          // resolving whether a PIN is configured
        case open              // no PIN configured (or already unlocked) → show digest
        case locked            // PIN configured, no active session → show unlock
        case unavailable(String) // gate can't be evaluated (e.g. no write DB)
    }

    var gate: Gate = .checking
    var digest: MorningDigest?
    var errorText: String?
    var showPinSheet = false

    let database: LariatDatabase
    let writeDatabase: LariatWriteDatabase?
    private let pinStore: PinSessionStore
    private let locationId: String
    private let poller = BoardPoller()

    init(
        database: LariatDatabase,
        writeDatabase: LariatWriteDatabase?,
        pinStore: PinSessionStore? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.database = database
        self.writeDatabase = writeDatabase
        self.pinStore = pinStore ?? PinSessionStore.shared
        self.locationId = locationId
    }

    /// Evaluate the PIN gate, then start streaming the digest if open.
    func start() {
        evaluateGate()
        if gate == .open { startStream() }
    }

    func stop() { poller.stop() }

    /// Resolve gate state: configured-PIN + no session → locked; else open.
    func evaluateGate() {
        // No PIN configured on the web app → digest is viewable without a PIN.
        // Prefer the write DB for the check (it can read manager_pin_users); fall
        // back to the read-only DB. If neither can evaluate, fail open only when
        // no env PIN exists.
        let gateOn: Bool
        do {
            if let writeDatabase {
                gateOn = try writeDatabase.pool.read { db in
                    try PinVerifier().gateConfigured(db: db, locationId: locationId)
                }
            } else {
                gateOn = try database.pool.read { db in
                    try PinVerifier().gateConfigured(db: db, locationId: locationId)
                }
            }
        } catch {
            // Could not read the gate table — treat as env-only.
            gateOn = PinVerifier().gateConfigured()
        }

        if !gateOn {
            gate = .open
            return
        }
        if pinStore.activeUser != nil {
            gate = .open
            return
        }
        // PIN is required. We can only unlock through a write DB (PinEntrySheet).
        guard writeDatabase != nil else {
            gate = .unavailable("Manager PIN required, but the write database is unavailable.")
            return
        }
        gate = .locked
    }

    /// Present the PIN sheet to unlock the surface.
    func requestUnlock() {
        guard writeDatabase != nil else { return }
        showPinSheet = true
    }

    /// Called after a successful PIN entry — opens the surface and starts streaming.
    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        gate = .open
        startStream()
    }

    // MARK: - Digest stream

    private func startStream() {
        let commandRepo = CommandRepository(database: database, locationId: locationId)
        let morningRepo = MorningRepository(database: database, locationId: locationId)

        // Poll like the command/rollup views: cross-process web writes are
        // invisible to GRDB ValueObservation, so BoardPoller re-queries every 3 s.
        poller.start(interval: .seconds(3)) { [weak self] in
            let today = ShiftDate.todayISO()
            async let bundleResult = commandRepo.fetch(today: today)
            async let morningResult = morningRepo.fetch(today: today)
            do {
                let cmdBundle = try await bundleResult
                let mrnBundle = try await morningResult

                // Thread the real price-shock counts into the command summary so
                // the alerts' "price-moves" line is not silently zero (parity with
                // commandCenter.summarize passing listPriceShocks counts).
                let priceMoves = Self.priceMoveSummary(mrnBundle.priceShocks)
                let summary = CommandCompute.summarize(
                    bundle: cmdBundle, locationId: self?.locationId ?? "default",
                    today: today, priceMoves: priceMoves, marginMoves: .zero)

                let d = MorningCompute.assemble(
                    summary: summary, bundle: mrnBundle,
                    locationId: self?.locationId ?? "default", today: today)

                self?.digest = d
                self?.errorText = nil
            } catch {
                self?.errorText = "Could not load morning digest: \(error.localizedDescription)"
                throw error
            }
        }
    }

    /// Map ranked MorningPriceShock items → CommandCompute.MoveSummary (total/up/down).
    private static func priceMoveSummary(_ shocks: [MorningPriceShock]) -> CommandCompute.MoveSummary {
        let up = shocks.filter { $0.deltaPct > 0 }.count
        let down = shocks.filter { $0.deltaPct <= 0 }.count
        return CommandCompute.MoveSummary(total: shocks.count, up: up, down: down)
    }
}
