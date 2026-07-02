import Foundation
import GRDB

/// Manager receiving-match resolution failures — mirror the web
/// `/api/receiving/matches/[id]` status semantics:
///   - `validation` → 400 (bad id, missing master_id)
///   - `notFound`   → 404 (receiving row / master missing)
///   - `conflict`   → 409 (rejected delivery, or no stock count to add)
///   - `persistenceFailed` → 500
public enum ReceivingMatchError: Error, LocalizedError, Equatable {
    case validation(String)
    case notFound(String)
    case conflict(String)
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .validation(let msg): return msg
        case .notFound(let msg): return msg
        case .conflict(let msg): return msg
        case .persistenceFailed: return "Failed to resolve receiving match"
        }
    }
}

/// One row of the master picker — mirrors the page's `readMasters` projection
/// (`master_id, canonical_name, category, preferred_vendor`).
public struct ReceivingMasterOption: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let masterId: String
    public let canonicalName: String
    public let category: String?
    public let preferredVendor: String?

    public var id: String { masterId }

    enum CodingKeys: String, CodingKey {
        case masterId = "master_id"
        case canonicalName = "canonical_name"
        case category
        case preferredVendor = "preferred_vendor"
    }
}

/// Result of a successful resolution — the updated receiving row plus the
/// (inserted or re-pointed) inventory credit, mirroring the web response
/// `{ ok, receiving, inventory_update }`.
public struct ReceivingMatchResolution: Sendable {
    public let receiving: ReceivingRow
    public let inventoryUpdate: InventoryUpdateRow

    public init(receiving: ReceivingRow, inventoryUpdate: InventoryUpdateRow) {
        self.receiving = receiving
        self.inventoryUpdate = inventoryUpdate
    }
}
