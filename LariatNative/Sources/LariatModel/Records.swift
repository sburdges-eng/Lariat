import GRDB

public struct AccountingVariance: FetchableRecord, Decodable {
    public let locationId: String
    public let theoreticalCogs: Double
    public let actualCogs: Double
    public let varianceAmount: Double?
    public let variancePct: Double?
    public let snapshotAt: String?
    enum CodingKeys: String, CodingKey {
        case locationId = "location_id"
        case theoreticalCogs = "theoretical_cogs"
        case actualCogs = "actual_cogs"
        case varianceAmount = "variance_amount"
        case variancePct = "variance_pct"
        case snapshotAt = "snapshot_at"
    }
}

public struct DishCoverageSnapshot: FetchableRecord, Decodable {
    public let locationId: String
    public let totalDishes: Int?
    public let coveredDishes: Int?
    public let coveragePct: Double?
    enum CodingKeys: String, CodingKey {
        case locationId = "location_id"
        case totalDishes = "total_dishes"
        case coveredDishes = "covered_dishes"
        case coveragePct = "coverage_pct"
    }
}

public struct PackSizeChange: FetchableRecord, Decodable {
    public let id: Int64
    public let vendor: String
    public let sku: String
    public let acknowledged: Bool
}

// ── Command Center projection records (Task 7) ────────────────────────────────
// These mirror the SELECTs in commandCenter.ts summarize().

/// toast_sales_daily — single yesterday row
public struct CmdSalesDailyRow: FetchableRecord, Decodable {
    public let netSales: Double?
    public let orders: Int?
    public let guests: Int?
    enum CodingKeys: String, CodingKey {
        case netSales = "net_sales"; case orders; case guests
    }
}

/// toast_sales_daily — trailing 7-day average subquery
public struct CmdSalesTrailingAvg: FetchableRecord, Decodable {
    public let avgSales: Double?
    public let avgOrders: Double?
    enum CodingKeys: String, CodingKey {
        case avgSales = "avg_sales"; case avgOrders = "avg_orders"
    }
}

/// shift_breaks row
public struct CmdShiftBreakRow: FetchableRecord, Decodable {
    public let endedAt: String?
    public let waived: Int
    enum CodingKeys: String, CodingKey {
        case endedAt = "ended_at"; case waived
    }
}

/// staff_certifications row
public struct CmdCertRow: FetchableRecord, Decodable {
    public let expiresOn: String
    enum CodingKeys: String, CodingKey { case expiresOn = "expires_on" }
}

/// temp_log row
public struct CmdTempLogRow: FetchableRecord, Decodable {
    public let id: Int64
    public let pointId: String?
    public let readingF: Double?
    public let requiredMinF: Double?
    public let requiredMaxF: Double?
    public let correctiveAction: String?
    public let createdAt: String?
    enum CodingKeys: String, CodingKey {
        case id; case pointId = "point_id"; case readingF = "reading_f"
        case requiredMinF = "required_min_f"; case requiredMaxF = "required_max_f"
        case correctiveAction = "corrective_action"; case createdAt = "created_at"
    }
}

/// date_marks row
public struct CmdDateMarkRow: FetchableRecord, Decodable {
    public let id: Int64
    public let item: String?
    public let preparedOn: String?
    public let discardOn: String?
    public let discardedAt: String?
    enum CodingKeys: String, CodingKey {
        case id; case item; case preparedOn = "prepared_on"
        case discardOn = "discard_on"; case discardedAt = "discarded_at"
    }
}

/// thermometer_calibrations row
public struct CmdCalibrationRow: FetchableRecord, Decodable {
    public let thermometerId: String?
    public let method: String?
    public let beforeReadingF: Double?
    public let passed: Int
    public let calibratedAt: String?
    public let frequencyDays: Int?
    enum CodingKeys: String, CodingKey {
        case thermometerId = "thermometer_id"; case method
        case beforeReadingF = "before_reading_f"; case passed
        case calibratedAt = "calibrated_at"; case frequencyDays = "frequency_days"
    }
}

/// beo_events count + total guests (typed projection — avoids Double/Int64 cast ambiguity)
public struct BeoEventsCount: FetchableRecord, Decodable {
    public let c: Int
    public let guests: Int
}

/// cleaning_schedule aggregation row
public struct CmdCleaningCounts: FetchableRecord, Decodable {
    public let overdue: Int?
    public let dueToday: Int?
    enum CodingKeys: String, CodingKey {
        case overdue; case dueToday = "due_today"
    }
}

/// inventory_par low-par ingredient
public struct CmdLowParIngredient: FetchableRecord, Decodable {
    public let ingredient: String
}

/// reservations status-count row
public struct CmdReservationRow: FetchableRecord, Decodable {
    public let status: String
    public let c: Int
}

/// prep_tasks row
public struct CmdPrepTaskRow: FetchableRecord, Decodable {
    public let status: String
    public let priority: Int?
}

/// dining_tables row
public struct CmdDiningTableRow: FetchableRecord, Decodable {
    public let status: String
    public let capacity: Int
}
