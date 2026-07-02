import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `house.equipment` — parity with `app/equipment/EquipmentBoard.tsx`
/// + the four /api/equipment routes. Open surface: no PIN; writes are
/// transactional but post NO audit_events (web-route parity, pinned in
/// EquipmentRepositoryTests). Money fields are Double dollars (REAL
/// columns). cook_id attribution on maintenance mirrors the web's
/// localStorage cook (CookIdentityStore).
@Observable @MainActor
final class EquipmentViewModel {
    enum DetailTab: String, CaseIterable {
        case details = "Details"
        case parts = "Parts"
        case schedule = "Schedule"
        case log = "Log repair"
    }

    private(set) var equipment: [EquipmentRow] = []
    private(set) var parts: [EquipmentPartRow] = []
    private(set) var schedule: [EquipmentScheduleRow] = []
    private(set) var loaded = false
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    var searchText = ""

    var expandedId: Int64?
    var activeTab: DetailTab = .details
    var showAddEquipment = false
    var addPartFor: Int64?
    var addSchedFor: Int64?

    // Add-equipment form (EquipmentBoard.tsx L57-68).
    var name = ""
    var category = "Ovens"
    var makeModel = ""
    var modelNumber = ""
    var serial = ""
    var costText = ""
    var purchaseDate = ""
    var warranty = ""
    var vendor = ""
    var orderRef = ""
    var manualPath = ""
    var notes = ""

    // Log-maintenance form (L71-74).
    var mType = "Repair"
    var mCostText = ""
    var mNotes = ""
    var mReceipt = ""

    // Add-part form (L77-84).
    var pPartNum = ""
    var pDesc = ""
    var pVendor = ""
    var pUnitPriceText = ""
    var pQtyText = ""
    var pOrdered = ""
    var pOrderRef = ""
    var pNotes = ""

    // Add-schedule form (L87-91).
    var sTask = ""
    var sFreq = "Monthly"
    var sLastDone = ""
    var sNextDue = ""
    var sNotes = ""

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    private var pollTask: Task<Void, Never>?

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase, locationId: String = LocationScope.resolve()) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.locationId = locationId
    }

    private var repo: EquipmentRepository {
        EquipmentRepository(readDB: readDB, writeDB: writeDB)
    }

    private var context: RegulatedWriteContext {
        RegulatedWriteContext.nativeCook(cookId: CookIdentityStore.shared.cookId, locationId: locationId)
    }

    var visibleEquipment: [EquipmentRow] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return equipment }
        return equipment.filter { row in
            row.name.lowercased().contains(q)
                || row.category.lowercased().contains(q)
                || (row.makeModel?.lowercased().contains(q) ?? false)
                || (row.vendor?.lowercased().contains(q) ?? false)
        }
    }

    func partsFor(_ id: Int64) -> [EquipmentPartRow] { parts.filter { $0.equipmentId == id } }
    func scheduleFor(_ id: Int64) -> [EquipmentScheduleRow] { schedule.filter { $0.equipmentId == id } }
    func isOverdue(_ id: Int64) -> Bool { EquipmentCompute.anyOverdue(scheduleFor(id)) }

    func toggleExpand(_ id: Int64) {
        expandedId = expandedId == id ? nil : id
        activeTab = .details
        addPartFor = nil
        addSchedFor = nil
    }

    func start() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    func stop() { pollTask?.cancel() }

    func refresh() async {
        do {
            equipment = try await repo.listEquipment(locationId: locationId)
            parts = try await repo.listParts(locationId: locationId)
            schedule = try await repo.listSchedule(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load equipment"
        }
        loaded = true
    }

    // ── writes (no PIN, no audit — web parity) ──────────────────────────

    func addEquipment() {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        perform {
            _ = try repo.addEquipment(
                input: EquipmentAddInput(
                    name: name,
                    category: category,
                    makeModel: blankToNil(makeModel),
                    modelNumber: blankToNil(modelNumber),
                    serialNumber: blankToNil(serial),
                    purchaseDate: blankToNil(purchaseDate),
                    warrantyExpiration: blankToNil(warranty),
                    purchaseCost: Double(costText),
                    vendor: blankToNil(vendor),
                    vendorOrderRef: blankToNil(orderRef),
                    manualPath: blankToNil(manualPath),
                    notes: blankToNil(notes)
                ),
                context: context
            )
            resetAddForm()
            showAddEquipment = false
        }
    }

    func logMaintenance(equipmentId: Int64) {
        perform {
            _ = try repo.addMaintenance(
                input: EquipmentMaintenanceAddInput(
                    equipmentId: equipmentId,
                    serviceDate: ShiftDate.todayISO(),
                    type: mType,
                    cost: Double(mCostText),
                    notes: blankToNil(mNotes),
                    receiptReference: blankToNil(mReceipt),
                    cookId: CookIdentityStore.shared.cookId
                ),
                context: context
            )
            mType = "Repair"; mCostText = ""; mNotes = ""; mReceipt = ""
        }
    }

    func addPart(equipmentId: Int64) {
        guard !pPartNum.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        perform {
            _ = try repo.addPart(
                input: EquipmentPartAddInput(
                    equipmentId: equipmentId,
                    partNumber: pPartNum,
                    description: blankToNil(pDesc),
                    vendor: blankToNil(pVendor),
                    unitPrice: Double(pUnitPriceText),
                    qtyOnHand: Double(pQtyText),
                    lastOrdered: blankToNil(pOrdered),
                    lastOrderRef: blankToNil(pOrderRef),
                    notes: blankToNil(pNotes)
                ),
                context: context
            )
            pPartNum = ""; pDesc = ""; pVendor = ""; pUnitPriceText = ""
            pQtyText = ""; pOrdered = ""; pOrderRef = ""; pNotes = ""
            addPartFor = nil
        }
    }

    func addSchedule(equipmentId: Int64) {
        guard !sTask.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        perform {
            _ = try repo.addSchedule(
                input: EquipmentScheduleAddInput(
                    equipmentId: equipmentId,
                    task: sTask,
                    frequency: sFreq,
                    lastDone: blankToNil(sLastDone),
                    nextDue: blankToNil(sNextDue),
                    notes: blankToNil(sNotes)
                ),
                context: context
            )
            sTask = ""; sFreq = "Monthly"; sLastDone = ""; sNextDue = ""; sNotes = ""
            addSchedFor = nil
        }
    }

    private func perform(_ body: () throws -> Void) {
        actionError = nil
        isSaving = true
        defer { isSaving = false }
        do {
            try body()
            Task { await refresh() }
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    private func blankToNil(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    private func resetAddForm() {
        name = ""; category = "Ovens"; makeModel = ""; modelNumber = ""; serial = ""
        costText = ""; purchaseDate = ""; warranty = ""; vendor = ""; orderRef = ""
        manualPath = ""; notes = ""
    }
}
