import Foundation
import GRDB

// Record types for the /equipment surface (A6.2) — parity with
// `app/equipment/*` + the four `app/api/equipment/**` routes.
// Money columns are REAL on the web schema (`purchase_cost`,
// `equipment_maintenance.cost`, `equipment_parts.unit_price`) → `Double`
// dollars, never cents.

/// One `equipment` row plus the route's maintenance-cost aggregate
/// (`COALESCE(SUM(m.cost), 0) AS maintenance_cost`).
public struct EquipmentRow: Sendable, Equatable, Identifiable, FetchableRecord {
    public let id: Int64
    public let name: String
    public let category: String
    public let makeModel: String?
    public let modelNumber: String?
    public let serialNumber: String?
    public let purchaseDate: String?
    public let warrantyExpiration: String?
    public let purchaseCost: Double?
    public let vendor: String?
    public let vendorOrderRef: String?
    public let manualPath: String?
    public let notes: String?
    public let status: String?
    public let locationId: String
    public let maintenanceCost: Double

    public init(row: Row) {
        id = row["id"]
        name = row["name"]
        category = row["category"]
        makeModel = row["make_model"]
        modelNumber = row["model_number"]
        serialNumber = row["serial_number"]
        purchaseDate = row["purchase_date"]
        warrantyExpiration = row["warranty_expiration"]
        purchaseCost = row["purchase_cost"]
        vendor = row["vendor"]
        vendorOrderRef = row["vendor_order_ref"]
        manualPath = row["manual_path"]
        notes = row["notes"]
        status = row["status"]
        locationId = row["location_id"]
        maintenanceCost = row["maintenance_cost"] ?? 0
    }
}

/// One `equipment_maintenance` row (the "Log repair" history).
public struct EquipmentMaintenanceRow: Sendable, Equatable, Identifiable, FetchableRecord {
    public let id: Int64
    public let equipmentId: Int64
    public let serviceDate: String
    public let type: String
    public let cost: Double?
    public let notes: String?
    public let receiptReference: String?
    public let cookId: String?
    public let locationId: String
    public let createdAt: String?

    public init(row: Row) {
        id = row["id"]
        equipmentId = row["equipment_id"]
        serviceDate = row["service_date"]
        type = row["type"]
        cost = row["cost"]
        notes = row["notes"]
        receiptReference = row["receipt_reference"]
        cookId = row["cook_id"]
        locationId = row["location_id"]
        createdAt = row["created_at"]
    }
}

/// One `equipment_parts` row.
public struct EquipmentPartRow: Sendable, Equatable, Identifiable, FetchableRecord {
    public let id: Int64
    public let equipmentId: Int64
    public let partNumber: String
    public let description: String?
    public let vendor: String?
    public let unitPrice: Double?
    public let qtyOnHand: Double?
    public let lastOrdered: String?
    public let lastOrderRef: String?
    public let notes: String?
    public let locationId: String
    public let createdAt: String?

    public init(row: Row) {
        id = row["id"]
        equipmentId = row["equipment_id"]
        partNumber = row["part_number"]
        description = row["description"]
        vendor = row["vendor"]
        unitPrice = row["unit_price"]
        qtyOnHand = row["qty_on_hand"]
        lastOrdered = row["last_ordered"]
        lastOrderRef = row["last_order_ref"]
        notes = row["notes"]
        locationId = row["location_id"]
        createdAt = row["created_at"]
    }
}

/// One `equipment_maintenance_schedule` row.
public struct EquipmentScheduleRow: Sendable, Equatable, Identifiable, FetchableRecord {
    public let id: Int64
    public let equipmentId: Int64
    public let task: String
    public let frequency: String
    public let lastDone: String?
    public let nextDue: String?
    public let notes: String?
    public let locationId: String
    public let createdAt: String?

    public init(id: Int64, equipmentId: Int64, task: String, frequency: String,
                lastDone: String?, nextDue: String?, notes: String?,
                locationId: String, createdAt: String?) {
        self.id = id
        self.equipmentId = equipmentId
        self.task = task
        self.frequency = frequency
        self.lastDone = lastDone
        self.nextDue = nextDue
        self.notes = notes
        self.locationId = locationId
        self.createdAt = createdAt
    }

    public init(row: Row) {
        id = row["id"]
        equipmentId = row["equipment_id"]
        task = row["task"]
        frequency = row["frequency"]
        lastDone = row["last_done"]
        nextDue = row["next_due"]
        notes = row["notes"]
        locationId = row["location_id"]
        createdAt = row["created_at"]
    }
}

// ── write inputs (route body shapes) ────────────────────────────────────

/// POST /api/equipment body.
public struct EquipmentAddInput: Sendable {
    public var name: String?
    public var category: String?
    public var makeModel: String?
    public var modelNumber: String?
    public var serialNumber: String?
    public var purchaseDate: String?
    public var warrantyExpiration: String?
    public var purchaseCost: Double?
    public var vendor: String?
    public var vendorOrderRef: String?
    public var manualPath: String?
    public var notes: String?
    public var status: String?

    public init(name: String?, category: String? = nil, makeModel: String? = nil,
                modelNumber: String? = nil, serialNumber: String? = nil,
                purchaseDate: String? = nil, warrantyExpiration: String? = nil,
                purchaseCost: Double? = nil, vendor: String? = nil,
                vendorOrderRef: String? = nil, manualPath: String? = nil,
                notes: String? = nil, status: String? = nil) {
        self.name = name
        self.category = category
        self.makeModel = makeModel
        self.modelNumber = modelNumber
        self.serialNumber = serialNumber
        self.purchaseDate = purchaseDate
        self.warrantyExpiration = warrantyExpiration
        self.purchaseCost = purchaseCost
        self.vendor = vendor
        self.vendorOrderRef = vendorOrderRef
        self.manualPath = manualPath
        self.notes = notes
        self.status = status
    }
}

/// POST /api/equipment/maintenance body.
public struct EquipmentMaintenanceAddInput: Sendable {
    public var equipmentId: Int64?
    public var serviceDate: String?
    public var type: String?
    public var cost: Double?
    public var notes: String?
    public var receiptReference: String?
    public var cookId: String?

    public init(equipmentId: Int64?, serviceDate: String?, type: String? = nil,
                cost: Double? = nil, notes: String? = nil,
                receiptReference: String? = nil, cookId: String? = nil) {
        self.equipmentId = equipmentId
        self.serviceDate = serviceDate
        self.type = type
        self.cost = cost
        self.notes = notes
        self.receiptReference = receiptReference
        self.cookId = cookId
    }
}

/// POST /api/equipment/parts body.
public struct EquipmentPartAddInput: Sendable {
    public var equipmentId: Int64?
    public var partNumber: String?
    public var description: String?
    public var vendor: String?
    public var unitPrice: Double?
    public var qtyOnHand: Double?
    public var lastOrdered: String?
    public var lastOrderRef: String?
    public var notes: String?

    public init(equipmentId: Int64?, partNumber: String?, description: String? = nil,
                vendor: String? = nil, unitPrice: Double? = nil, qtyOnHand: Double? = nil,
                lastOrdered: String? = nil, lastOrderRef: String? = nil, notes: String? = nil) {
        self.equipmentId = equipmentId
        self.partNumber = partNumber
        self.description = description
        self.vendor = vendor
        self.unitPrice = unitPrice
        self.qtyOnHand = qtyOnHand
        self.lastOrdered = lastOrdered
        self.lastOrderRef = lastOrderRef
        self.notes = notes
    }
}

/// POST /api/equipment/schedule body.
public struct EquipmentScheduleAddInput: Sendable {
    public var equipmentId: Int64?
    public var task: String?
    public var frequency: String?
    public var lastDone: String?
    public var nextDue: String?
    public var notes: String?

    public init(equipmentId: Int64?, task: String?, frequency: String?,
                lastDone: String? = nil, nextDue: String? = nil, notes: String? = nil) {
        self.equipmentId = equipmentId
        self.task = task
        self.frequency = frequency
        self.lastDone = lastDone
        self.nextDue = nextDue
        self.notes = notes
    }
}

/// Typed write failures — the 400 contracts of the four equipment routes.
/// Thrown BEFORE any write. Messages mirror the routes' `{ error }` strings.
public enum EquipmentWriteError: Error, Equatable, LocalizedError {
    case nameRequired               // POST /api/equipment
    case equipmentIdRequired        // maintenance / parts / schedule
    case serviceDateRequired        // maintenance
    case partNumberRequired         // parts
    case taskRequired               // schedule
    case frequencyRequired          // schedule

    public var errorDescription: String? {
        switch self {
        case .nameRequired: return "name required"
        case .equipmentIdRequired: return "equipment_id required"
        case .serviceDateRequired: return "service_date required"
        case .partNumberRequired: return "part_number required"
        case .taskRequired: return "task required"
        case .frequencyRequired: return "frequency required"
        }
    }
}

/// Form option lists from `EquipmentBoard.tsx` (L232-234 / L429-432 / L461-463).
public enum EquipmentFormOptions {
    public static let categories = ["Ovens", "Refrigeration", "Prep & Mixers", "Fryers", "Smallwares", "Tools", "Other"]
    public static let maintenanceTypes = ["Repair", "Routine", "Damage"]
    public static let frequencies = ["Daily", "Weekly", "Biweekly", "Monthly", "Quarterly", "Annually"]
}
