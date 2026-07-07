import Foundation
import LariatDB
import LariatModel
import Observation

/// View model for the SDS registry screen — parity with `app/food-safety/sds`.
/// Loads the active registry (poll-refresh like the sibling safety boards), filters
/// client-side (product / manufacturer / hazard), and registers new products through
/// `SdsRepository` (audited insert, `actor_source = native_cook`).
@Observable @MainActor
final class SdsViewModel {
    var snapshot: SdsBoardSnapshot?
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    var showCookPicker = false

    /// Client-side filter over product / manufacturer / hazard (mirrors the web filter).
    var filter = ""

    let cookStore: CookIdentityStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

    /// The OSHA HazCom citation shown in the subtitle (web passes `citation`).
    let citation = SdsCompute.citation

    /// Hazard-class options for the picker: the "— none —" sentinel plus the GHS enum.
    let hazardClassOptions: [String] = [""] + SdsCompute.ghsHazardClasses

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    let poller = BoardPoller()

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase,
        cookStore: CookIdentityStore? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.cookStore = cookStore ?? CookIdentityStore.shared
        self.locationId = locationId
        loadStaff()
    }

    /// Rows after the client-side filter (matches `SdsBoard`'s useMemo).
    var filteredRows: [SdsRow] {
        guard let rows = snapshot?.rows else { return [] }
        let q = filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return rows }
        return rows.filter { r in
            r.productName.lowercased().contains(q)
                || (r.manufacturer ?? "").lowercased().contains(q)
                || (r.hazardClass ?? "").lowercased().contains(q)
        }
    }

    func start() {
        poller.start(interval: .seconds(3)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        let repo = SdsRepository(readDB: readDB, writeDB: writeDB)
        do {
            snapshot = try await repo.load(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load SDS registry"
        }
    }

    /// Register a product. Empty optional fields are sent as nil. `hazardClass`
    /// "" (the none sentinel) is treated as absent.
    func register(
        productName: String,
        manufacturer: String,
        hazardClass: String,
        storageLocation: String,
        pdfOrUrl: String,
        lastReviewed: String
    ) async -> Bool {
        guard !isSaving else { return false }
        guard ensureCookIdentity() else { return false }
        isSaving = true
        actionError = nil
        defer { isSaving = false }

        // The web form has one "PDF path or URL" field: an http(s) value routes to
        // `url`, everything else to `pdf_path` (parity with the SdsBoard link, which
        // renders `pdf_path || url`). The validator enforces http(s) on `url` only.
        let ref = pdfOrUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        let isHttp = ref.lowercased().hasPrefix("http://") || ref.lowercased().hasPrefix("https://")

        let repo = SdsRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.register(
                input: SdsInput(
                    productName: productName,
                    manufacturer: manufacturer.isEmpty ? nil : manufacturer,
                    hazardClass: hazardClass.isEmpty ? nil : hazardClass,
                    storageLocation: storageLocation.isEmpty ? nil : storageLocation,
                    pdfPath: (!ref.isEmpty && !isHttp) ? ref : nil,
                    url: (!ref.isEmpty && isHttp) ? ref : nil,
                    lastReviewed: lastReviewed.isEmpty ? nil : lastReviewed,
                    cookId: cookStore.cookId
                ),
                context: context
            )
            await refresh()
            return true
        } catch {
            actionError = WriteErrorMapper.message(for: error)
            return false
        }
    }

    private func ensureCookIdentity() -> Bool {
        if cookStore.cookId != nil { return true }
        showCookPicker = true
        return false
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
