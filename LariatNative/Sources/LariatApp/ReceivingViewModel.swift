import Foundation
import LariatDB
import LariatModel
import Observation

@Observable @MainActor
final class ReceivingViewModel {
    var snapshot: ReceivingBoardSnapshot?
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    /// True after a 422 (needs a corrective / rejection note). Drives the note
    /// field's required styling — mirrors the JS board's `needsNote`.
    var needsNote = false
    var showCookPicker = false

    let cookStore: CookIdentityStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    private var streamTask: Task<Void, Never>?

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

    /// Category ids in registry order (drives the picker + default selection).
    var categories: [ReceivingCategory] { ReceivingCompute.categories }

    func rule(for category: ReceivingCategory) -> ReceivingCategoryRule? {
        ReceivingCompute.rules[category]
    }

    func start() {
        streamTask?.cancel()
        streamTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(4))
            }
        }
    }

    func stop() { streamTask?.cancel() }

    func refresh() async {
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        do {
            snapshot = try await repo.load(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load receiving log"
        }
    }

    /// Live decision for the entry form — mirrors the JS `liveDecision` used to
    /// pre-surface the note field and tint the reading input. Returns nil when
    /// the reading is unknown for a temp-required category.
    func liveDecision(
        category: ReceivingCategory,
        readingText: String,
        packageOk: Bool,
        expirationDate: String?
    ) -> ReceivingStatus? {
        guard let rule = rule(for: category) else { return .ok }
        if !packageOk { return .rejected }
        if let exp = expirationDate?.trimmingCharacters(in: .whitespacesAndNewlines), !exp.isEmpty,
           let received = snapshot?.date, exp < received {
            return .rejected
        }
        if !rule.requiresReading { return .ok }
        let trimmed = readingText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let r = Double(trimmed), r.isFinite else { return nil }
        if let max = rule.requiredMaxF, r > max {
            if let dMax = rule.driftMaxF, r <= dMax { return .acceptWithNote }
            return .rejected
        }
        if let min = rule.requiredMinF, r < min {
            if let dMin = rule.driftMinF, r >= dMin { return .acceptWithNote }
            return .rejected
        }
        return .ok
    }

    /// Record one delivery line. `readingText` may be empty for dry/produce.
    func recordDelivery(
        vendor: String,
        category: ReceivingCategory,
        invoice: String,
        item: String,
        vendorSku: String,
        readingText: String,
        packageOk: Bool,
        expiration: String,
        note: String,
        receivedQtyText: String,
        receivedUnit: String
    ) async -> Bool {
        guard !isSaving else { return false }
        let trimmedVendor = vendor.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedVendor.isEmpty else {
            actionError = "Vendor is required"
            return false
        }

        var reading: Double?
        let trimmedReading = readingText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedReading.isEmpty {
            guard let v = Double(trimmedReading), v.isFinite else {
                actionError = "Reading must be a number in °F"
                return false
            }
            reading = v
        }

        var receivedQty: Double?
        let trimmedQty = receivedQtyText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedQty.isEmpty {
            guard let v = Double(trimmedQty), v.isFinite else {
                actionError = "Quantity must be a number"
                return false
            }
            receivedQty = v
        }

        guard ensureCookIdentity() else { return false }

        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.record(
                input: ReceivingEntryInput(
                    vendor: trimmedVendor,
                    category: category.rawValue,
                    invoiceRef: emptyToNil(invoice),
                    item: emptyToNil(item),
                    vendorSku: emptyToNil(vendorSku),
                    readingF: reading,
                    packageOk: packageOk,
                    expirationDate: emptyToNil(expiration),
                    correctiveAction: emptyToNil(note),
                    receivedQty: receivedQty,
                    receivedUnit: emptyToNil(receivedUnit),
                    cookId: cookStore.cookId,
                    shiftDate: snapshot?.date
                ),
                context: context
            )
            needsNote = false
            await refresh()
            return true
        } catch let error as ReceivingWriteError where error.needsRejectionNote {
            needsNote = true
            actionError = "\(WriteErrorMapper.message(for: error)) — write down why and re-submit"
            return false
        } catch let error as ReceivingWriteError where error.needsCorrectiveAction {
            needsNote = true
            actionError = "\(WriteErrorMapper.message(for: error)) — add a note and re-submit"
            return false
        } catch {
            actionError = WriteErrorMapper.message(for: error)
            return false
        }
    }

    private func emptyToNil(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
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
