import Foundation
import GRDB

/// Receiving write failures — mirror web `/api/receiving` status semantics.
///   - `validationFailed` → 400 (missing vendor, unknown category, malformed
///     expiration_date/reading_f, over-long corrective note)
///   - `closedLoopError`  → 400 (bad received_qty/received_unit on a non-rejected line)
///   - `needsCorrectiveAction` → 422 with `needs_corrective_action: true`
///     (drift-band accept-with-note without a note)
///   - `needsRejectionNote` → 422 with `needs_rejection_note: true`
///     (outright rejection without a note — "document why you refused it")
///   - `persistenceFailed` → 500
public enum ReceivingWriteError: Error, LocalizedError, Equatable {
    case validationFailed(String)
    case closedLoopError(String)
    case needsCorrectiveAction(reason: String, citation: String?)
    case needsRejectionNote(reason: String, citation: String?)
    case correctiveNoteTooLong(length: Int)
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .validationFailed(let msg): return msg
        case .closedLoopError(let msg): return msg
        case .needsCorrectiveAction(let reason, _): return reason
        case .needsRejectionNote(let reason, _): return reason
        case .correctiveNoteTooLong:
            return "Corrective action too long (max 500 chars)"
        case .persistenceFailed: return "Could not save receiving entry"
        }
    }

    /// Web maps this to HTTP 422 with `needs_corrective_action: true` — drift-band
    /// "add a fix note to accept" case.
    public var needsCorrectiveAction: Bool {
        if case .needsCorrectiveAction = self { return true }
        return false
    }

    /// Web maps this to HTTP 422 with `needs_rejection_note: true` — outright
    /// refusal "document why you refused this delivery" case. Wire-distinct from
    /// `needsCorrectiveAction`.
    public var needsRejectionNote: Bool {
        if case .needsRejectionNote = self { return true }
        return false
    }
}

/// Full `receiving_log` row for board display and audit payload. Column
/// names/types match the EXISTING web schema in `lib/db.ts` (no migration).
public struct ReceivingRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let shiftDate: String
    public let locationId: String
    public let vendor: String
    public let invoiceRef: String?
    public let category: String
    public let item: String?
    public let vendorSku: String?
    public let masterId: String?
    public let matchStatus: String?
    public let matchReason: String?
    public let readingF: Double?
    public let requiredMaxF: Double?
    public let packageOk: Int?
    public let expirationDate: String?
    public let receivedQty: Double?
    public let receivedUnit: String?
    public let status: String
    public let rejectionReason: String?
    public let shellstockTagRef: String?
    public let cookId: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case locationId = "location_id"
        case vendor
        case invoiceRef = "invoice_ref"
        case category
        case item
        case vendorSku = "vendor_sku"
        case masterId = "master_id"
        case matchStatus = "match_status"
        case matchReason = "match_reason"
        case readingF = "reading_f"
        case requiredMaxF = "required_max_f"
        case packageOk = "package_ok"
        case expirationDate = "expiration_date"
        case receivedQty = "received_qty"
        case receivedUnit = "received_unit"
        case status
        case rejectionReason = "rejection_reason"
        case shellstockTagRef = "shellstock_tag_ref"
        case cookId = "cook_id"
        case createdAt = "created_at"
    }
}

/// Full `inventory_updates` row — used to assert closed-loop crediting parity.
public struct InventoryUpdateRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let shiftDate: String
    public let stationId: String?
    public let item: String
    public let masterId: String?
    public let delta: String?
    public let direction: String?
    public let note: String?
    public let cookId: String?
    public let createdAt: String?
    public let locationId: String?
    public let receivingLogId: Int64?

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case stationId = "station_id"
        case item
        case masterId = "master_id"
        case delta
        case direction
        case note
        case cookId = "cook_id"
        case createdAt = "created_at"
        case locationId = "location_id"
        case receivingLogId = "receiving_log_id"
    }
}

/// Input for recording one delivery line (POST /api/receiving).
public struct ReceivingEntryInput: Sendable {
    public let vendor: String
    public let category: String
    public let invoiceRef: String?
    public let item: String?
    public let vendorSku: String?
    public let shellstockTagRef: String?
    public let readingF: Double?
    public let packageOk: Bool
    public let expirationDate: String?
    public let correctiveAction: String?
    public let receivedQty: Double?
    public let receivedUnit: String?
    public let cookId: String?
    public let shiftDate: String?

    public init(
        vendor: String,
        category: String,
        invoiceRef: String? = nil,
        item: String? = nil,
        vendorSku: String? = nil,
        shellstockTagRef: String? = nil,
        readingF: Double? = nil,
        packageOk: Bool = true,
        expirationDate: String? = nil,
        correctiveAction: String? = nil,
        receivedQty: Double? = nil,
        receivedUnit: String? = nil,
        cookId: String? = nil,
        shiftDate: String? = nil
    ) {
        self.vendor = vendor
        self.category = category
        self.invoiceRef = invoiceRef
        self.item = item
        self.vendorSku = vendorSku
        self.shellstockTagRef = shellstockTagRef
        self.readingF = readingF
        self.packageOk = packageOk
        self.expirationDate = expirationDate
        self.correctiveAction = correctiveAction
        self.receivedQty = receivedQty
        self.receivedUnit = receivedUnit
        self.cookId = cookId
        self.shiftDate = shiftDate
    }
}

/// Inline master-resolution outcome — mirrors the JS route's `resolveReceivingMaster`
/// return (`status`/`master_id`/`reason`). Values match the strings written to
/// `receiving_log.match_status` / `match_reason`.
public struct ReceivingMasterMatch: Sendable, Equatable {
    public let status: String        // matched | ambiguous | unmatched | not_attempted
    public let masterId: String?
    public let reason: String?

    public init(status: String, masterId: String?, reason: String?) {
        self.status = status
        self.masterId = masterId
        self.reason = reason
    }

    public static let notAttempted = ReceivingMasterMatch(status: "not_attempted", masterId: nil, reason: nil)
}

/// Result of a successful POST — the persisted row + the rule decision + the
/// inline master match (mirrors the JS `{ ok, id, decision, entry, match }`).
public struct ReceivingEntryResult: Sendable {
    public let row: ReceivingRow
    public let decision: ReceivingReadingResult
    public let match: ReceivingMasterMatch
    public let inventoryUpdate: InventoryUpdateRow?

    public init(row: ReceivingRow, decision: ReceivingReadingResult, match: ReceivingMasterMatch, inventoryUpdate: InventoryUpdateRow?) {
        self.row = row
        self.decision = decision
        self.match = match
        self.inventoryUpdate = inventoryUpdate
    }
}

/// Per-vendor grouping for the board (mirrors the JS GET `vendors[]`).
public struct ReceivingVendorGroup: Sendable, Identifiable, Equatable {
    public let vendor: String
    public let entries: [ReceivingRow]
    public let accepted: Int
    public let rejected: Int
    public let acceptedWithNote: Int

    public var id: String { vendor }

    public init(vendor: String, entries: [ReceivingRow], accepted: Int, rejected: Int, acceptedWithNote: Int) {
        self.vendor = vendor
        self.entries = entries
        self.accepted = accepted
        self.rejected = rejected
        self.acceptedWithNote = acceptedWithNote
    }
}

/// Line-level totals across the whole board (mirrors the JS GET `totals`).
public struct ReceivingTotals: Sendable, Equatable {
    public let accepted: Int
    public let rejected: Int
    public let acceptedWithNote: Int

    public init(accepted: Int, rejected: Int, acceptedWithNote: Int) {
        self.accepted = accepted
        self.rejected = rejected
        self.acceptedWithNote = acceptedWithNote
    }
}

/// Board snapshot for the Receiving screen (mirrors the JS GET response).
public struct ReceivingBoardSnapshot: Sendable {
    public let date: String
    public let locationId: String
    public let entries: [ReceivingRow]
    public let vendors: [ReceivingVendorGroup]
    public let totals: ReceivingTotals
    public let summary: [ReceivingCategorySummary]

    public init(
        date: String,
        locationId: String,
        entries: [ReceivingRow],
        vendors: [ReceivingVendorGroup],
        totals: ReceivingTotals,
        summary: [ReceivingCategorySummary]
    ) {
        self.date = date
        self.locationId = locationId
        self.entries = entries
        self.vendors = vendors
        self.totals = totals
        self.summary = summary
    }
}
