import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `purchasing.compare` — parity with `app/purchasing/compare/page.jsx`
/// (compare table + coverage + single-vendor list), `CompareActions.jsx`
/// (Use Sysco / Use Shamrock / Lock for quality / Unlock via the
/// ingredient-masters PATCH → `IngredientMastersRepository.updateMaster`, NOT
/// a duplicate write path) and `AttachVendorActions.jsx` (attach the missing
/// vendor via `VendorMappingWriteRepository.attachCatalogRow`).
///
/// Reads are open; every write is PIN-gated per-write
/// (`ManagementWrite.requireSession` + `PinSessionStore` + `PinEntrySheet`) —
/// the native analog of the web `requirePin` on every `/api/purchasing` and
/// `/api/costing/ingredient-masters` route. Writes are tagged `native_mac`
/// and audited in-transaction by the repositories.
@Observable @MainActor
final class VendorCompareViewModel {
    var summary: VendorCompareSummary?
    var coverage: MappingCoverageSummary?
    var singles: [SingleVendorMaster] = []
    var query = ""
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    var showPinSheet = false

    // Attach flow (web AttachVendorActions lives on the compare page).
    var attachTarget: SingleVendorMaster?
    var attachQuery = ""
    var attachRows: [CatalogRow] = []

    let pinStore: PinSessionStore
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    private var pendingAction: PendingAction?

    enum PendingAction {
        case setPreferred(masterId: String, vendor: CompareVendor)
        case lock(masterId: String, currentPreferred: String?)
        case unlock(masterId: String)
        case attach(masterId: String, key: CatalogKey)
    }

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

    /// Client-side `.searchable` filter on the canonical name (native nicety;
    /// the web page renders the full table).
    var filteredRows: [VendorCompareRow] {
        guard let rows = summary?.rows else { return [] }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return rows }
        return rows.filter { $0.canonicalName.lowercased().contains(q) }
    }

    func refresh() async {
        do {
            let compareRepo = VendorCompareRepository(database: readDB, locationId: locationId)
            let mapRepo = VendorMappingRepository(database: readDB, locationId: locationId)
            summary = try await compareRepo.listVendorCompareRows()
            coverage = try await mapRepo.summarizeMappingCoverage()
            singles = try await mapRepo.listSingleVendorMasters()
            fetchError = nil
        } catch {
            fetchError = "Could not load vendor compare"
        }
    }

    /// Catalog candidates for the attach sheet — web AttachVendorActions
    /// fetches `vendor-catalog?vendor=<missing>&unlinkedOnly=1&q=...`.
    func loadAttachCandidates() async {
        guard let target = attachTarget else {
            attachRows = []
            return
        }
        do {
            let repo = VendorMappingRepository(database: readDB, locationId: locationId)
            let q = attachQuery.trimmingCharacters(in: .whitespacesAndNewlines)
            attachRows = try await repo.searchVendorCatalog(
                vendor: target.missingVendor, q: q.isEmpty ? nil : q, unlinkedOnly: true
            )
        } catch {
            actionError = "Could not load the vendor catalog"
        }
    }

    // ── write requests (PIN-gated per-write) ─────────────────────────────

    /// CompareActions "Use Sysco" / "Use Shamrock" → PATCH {preferred_vendor}.
    func requestSetPreferred(masterId: String, vendor: CompareVendor) {
        request(.setPreferred(masterId: masterId, vendor: vendor))
    }

    /// CompareActions "Lock for quality" → PATCH {preferred_vendor: current ||
    /// 'sysco', quality_locked: true, quality_lock_reason: 'quality'}.
    func requestLock(masterId: String, currentPreferred: String?) {
        request(.lock(masterId: masterId, currentPreferred: currentPreferred))
    }

    /// CompareActions "Unlock" → PATCH {quality_locked: false}.
    func requestUnlock(masterId: String) {
        request(.unlock(masterId: masterId))
    }

    /// AttachVendorActions row pick → POST vendor-link/attach.
    func requestAttach(row: CatalogRow) {
        guard let target = attachTarget else { return }
        request(.attach(masterId: target.masterId, key: row.key))
    }

    private func request(_ action: PendingAction) {
        actionError = nil
        guard ensureGateConfigured() else { return }
        if pinStore.activeUser != nil {
            perform(action)
        } else {
            pendingAction = action
            showPinSheet = true
        }
    }

    /// After the PIN sheet succeeds, resume whichever write triggered it.
    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        if let action = pendingAction {
            pendingAction = nil
            perform(action)
        }
    }

    private func perform(_ action: PendingAction) {
        actionError = nil
        isSaving = true
        defer { isSaving = false }
        do {
            let user = try ManagementWrite().requireSession(pinStore.session)
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            let context = RegulatedWriteContext.nativeMac(pinUser: user)
            let masters = IngredientMastersRepository(readDB: readDB, writeDB: writeDB)

            switch action {
            case .setPreferred(let masterId, let vendor):
                var u = IngredientMasterUpdates()
                u.preferredVendor = .set(vendor.rawValue)
                _ = try masters.updateMaster(masterId, updates: u, context: context)

            case .lock(let masterId, let currentPreferred):
                var u = IngredientMasterUpdates()
                // web: preferred_vendor: preferredVendor || 'sysco' (JS falsy)
                let preferred = (currentPreferred?.isEmpty ?? true) ? "sysco" : currentPreferred!
                u.preferredVendor = .set(preferred)
                u.qualityLocked = .set(true)
                u.qualityLockReason = .set("quality")
                _ = try masters.updateMaster(masterId, updates: u, context: context)

            case .unlock(let masterId):
                var u = IngredientMasterUpdates()
                u.qualityLocked = .set(false)
                _ = try masters.updateMaster(masterId, updates: u, context: context)

            case .attach(let masterId, let key):
                let writes = VendorMappingWriteRepository(readDB: readDB, writeDB: writeDB)
                _ = try writes.attachCatalogRow(
                    AttachCatalogInput(masterId: masterId, catalogKey: key),
                    context: context
                )
                attachTarget = nil
                attachQuery = ""
                attachRows = []
            }
            Task { await refresh() }
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
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
