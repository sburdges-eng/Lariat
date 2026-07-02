import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `purchasing.link` — parity with `app/purchasing/link/page.jsx` +
/// `LinkPairForm.jsx`: two unlinked-only catalog pickers (Sysco + Shamrock),
/// a staple-name field, and one submit that calls
/// `VendorMappingWriteRepository.pairCatalogRows` (one txn: master upsert +
/// 2 confirmed maps + 2 vendor_prices links + 4 audit events).
///
/// The write is PIN-gated per-write (`ManagementWrite.requireSession` +
/// `PinSessionStore` + `PinEntrySheet`) — the native analog of the web
/// `requirePin` on `/api/purchasing/vendor-link/pair`.
@Observable @MainActor
final class VendorLinkViewModel {
    var coverage: MappingCoverageSummary?
    var syscoQuery = ""
    var shamrockQuery = ""
    var syscoRows: [CatalogRow] = []
    var shamrockRows: [CatalogRow] = []
    var selectedSysco: CatalogRow?
    var selectedShamrock: CatalogRow?
    var canonicalName = ""
    var isSaving = false
    var errorMessage: String?
    var linkedMasterId: String?
    var fetchError: String?
    var showPinSheet = false
    var loaded = false

    let pinStore: PinSessionStore
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

    /// LinkPairForm `canSubmit`: both picks + a non-blank name + not pending.
    var canSubmit: Bool {
        selectedSysco != nil && selectedShamrock != nil
            && !canonicalName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isSaving
    }

    func refresh() async {
        do {
            let repo = VendorMappingRepository(database: readDB, locationId: locationId)
            coverage = try await repo.summarizeMappingCoverage()
            fetchError = nil
        } catch {
            fetchError = "Could not load mapping coverage"
        }
        await loadCatalog(.sysco)
        await loadCatalog(.shamrock)
        loaded = true
    }

    /// CatalogPicker fetch — `vendor-catalog?vendor=…&unlinkedOnly=1&q=…`.
    func loadCatalog(_ vendor: CompareVendor) async {
        do {
            let repo = VendorMappingRepository(database: readDB, locationId: locationId)
            let rawQ = vendor == .sysco ? syscoQuery : shamrockQuery
            let q = rawQ.trimmingCharacters(in: .whitespacesAndNewlines)
            let rows = try await repo.searchVendorCatalog(
                vendor: vendor, q: q.isEmpty ? nil : q, unlinkedOnly: true
            )
            if vendor == .sysco { syscoRows = rows } else { shamrockRows = rows }
        } catch {
            errorMessage = "Could not load the \(vendor.rawValue) catalog"
        }
    }

    // ── submit (PIN-gated) ───────────────────────────────────────────────

    func requestSubmit() {
        errorMessage = nil
        guard canSubmit else { return }
        guard ensureGateConfigured() else { return }
        if pinStore.activeUser != nil {
            performSubmit()
        } else {
            showPinSheet = true
        }
    }

    /// After the PIN sheet succeeds, resume the pending submit.
    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        performSubmit()
    }

    private func performSubmit() {
        guard let sysco = selectedSysco, let shamrock = selectedShamrock else { return }
        errorMessage = nil
        linkedMasterId = nil
        isSaving = true
        defer { isSaving = false }
        do {
            let user = try ManagementWrite().requireSession(pinStore.session)
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            let context = RegulatedWriteContext.nativeMac(pinUser: user)
            let writes = VendorMappingWriteRepository(readDB: readDB, writeDB: writeDB)
            let masterId = try writes.pairCatalogRows(
                PairCatalogInput(
                    syscoKey: sysco.key,
                    shamrockKey: shamrock.key,
                    canonicalName: canonicalName
                ),
                context: context
            )
            linkedMasterId = masterId
            selectedSysco = nil
            selectedShamrock = nil
            canonicalName = ""
            Task { await refresh() }
        } catch {
            errorMessage = WriteErrorMapper.message(for: error)
        }
    }

    private func ensureGateConfigured() -> Bool {
        do {
            let gateOn = try writeDB.pool.read { db in try PinVerifier().gateConfigured(db: db) }
            guard gateOn else {
                errorMessage = "PIN not set up — add a manager PIN in web Settings"
                return false
            }
            return true
        } catch {
            errorMessage = WriteErrorMapper.message(for: error)
            return false
        }
    }
}
