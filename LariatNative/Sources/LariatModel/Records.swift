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

// ── Analytics projection records (Task 9) ────────────────────────────────────
// These mirror the SELECTs in app/analytics/page.jsx exactly.

/// toast_sales_daily row (comparison_group = 1)
public struct AnalyticsDailyRow: FetchableRecord, Decodable {
    public let shiftDate: String
    public let netSales: Double?
    public let orders: Int?
    public let guests: Int?
    enum CodingKeys: String, CodingKey {
        case shiftDate = "shift_date"; case netSales = "net_sales"; case orders; case guests
    }
    public init(shiftDate: String, netSales: Double?, orders: Int?, guests: Int?) {
        self.shiftDate = shiftDate; self.netSales = netSales; self.orders = orders; self.guests = guests
    }
}

/// toast_sales_dow row
public struct AnalyticsDowRow: FetchableRecord, Decodable {
    public let dayOfWeek: Int
    public let netSales: Double?
    public let orders: Int?
    public let guests: Int?
    enum CodingKeys: String, CodingKey {
        case dayOfWeek = "day_of_week"; case netSales = "net_sales"; case orders; case guests
    }
    public init(dayOfWeek: Int, netSales: Double?, orders: Int?, guests: Int?) {
        self.dayOfWeek = dayOfWeek; self.netSales = netSales; self.orders = orders; self.guests = guests
    }
}

/// toast_sales_hour row
public struct AnalyticsHourlyRow: FetchableRecord, Decodable {
    public let hour24: Int
    public let label: String?
    public let netSales: Double?
    public let orders: Int?
    public let guests: Int?
    enum CodingKeys: String, CodingKey {
        case hour24 = "hour_24"; case label; case netSales = "net_sales"; case orders; case guests
    }
    public init(hour24: Int, label: String?, netSales: Double?, orders: Int?, guests: Int?) {
        self.hour24 = hour24; self.label = label; self.netSales = netSales
        self.orders = orders; self.guests = guests
    }
}

/// spend_monthly row
public struct AnalyticsSpendRow: FetchableRecord, Decodable {
    public let month: String
    public let shamrockTotalSpend: Double?
    enum CodingKeys: String, CodingKey {
        case month; case shamrockTotalSpend = "shamrock_total_spend"
    }
    public init(month: String, shamrockTotalSpend: Double?) {
        self.month = month; self.shamrockTotalSpend = shamrockTotalSpend
    }
}

/// sales_lines top-item aggregation row
public struct AnalyticsTopItem: FetchableRecord, Decodable {
    public let itemName: String
    public let qty: Double?
    public let rev: Double?
    enum CodingKeys: String, CodingKey {
        case itemName = "item_name"; case qty; case rev
    }
    public init(itemName: String, qty: Double?, rev: Double?) {
        self.itemName = itemName; self.qty = qty; self.rev = rev
    }
}

/// toast_sales_daily scalar — SUM(net_sales) for comparison_group = 2
public struct AnalyticsPriorRev: FetchableRecord, Decodable {
    public let rev: Double?
}

/// toast_sales_daily scalar — date_range from comparison_group = 1
public struct AnalyticsDateRange: FetchableRecord, Decodable {
    public let dateRange: String?
    enum CodingKeys: String, CodingKey { case dateRange = "date_range" }
}

// ── Analytics input bundle (Task 9) ──────────────────────────────────────────

/// Raw bundle produced by `AnalyticsRepository.fetch`. No aggregation — that is
/// `AnalyticsCompute.summarize`'s job.
public struct AnalyticsBundle {
    public let daily: [AnalyticsDailyRow]
    public let dowCurrent: [AnalyticsDowRow]
    public let dowPrior: [AnalyticsDowRow]
    public let hourlyCurrent: [AnalyticsHourlyRow]
    public let hourlyPrior: [AnalyticsHourlyRow]
    public let spend: [AnalyticsSpendRow]
    public let top: [AnalyticsTopItem]
    public let dailyPriorRev: Double?       // SUM(net_sales) WHERE cg=2; nil when no rows
    public let dateRange: String?           // date_range from cg=1 LIMIT 1

    public init(
        daily: [AnalyticsDailyRow],
        dowCurrent: [AnalyticsDowRow],
        dowPrior: [AnalyticsDowRow],
        hourlyCurrent: [AnalyticsHourlyRow],
        hourlyPrior: [AnalyticsHourlyRow],
        spend: [AnalyticsSpendRow],
        top: [AnalyticsTopItem],
        dailyPriorRev: Double?,
        dateRange: String?
    ) {
        self.daily = daily
        self.dowCurrent = dowCurrent
        self.dowPrior = dowPrior
        self.hourlyCurrent = hourlyCurrent
        self.hourlyPrior = hourlyPrior
        self.spend = spend
        self.top = top
        self.dailyPriorRev = dailyPriorRev
        self.dateRange = dateRange
    }
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
