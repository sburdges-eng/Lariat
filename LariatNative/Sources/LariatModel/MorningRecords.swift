import GRDB

// GRDB-free record types + projection rows for the morning digest.
//
// Mirrors the `MorningDigest*` TypeScript interfaces in `lib/morningDigest.ts`
// 1:1. The `Mrn*` FetchableRecord projections mirror the SELECTs the digest
// runs directly (86 board, certs, maintenance, BEO prep). The command-summary
// half + price shocks are reused from CommandCompute / the command bundle.

// MARK: - Section item records (mirror the TS interfaces)

/// eighty_six row (active, this shift). Mirrors MorningDigestEightySixItem.
public struct MorningEightySixItem: Equatable, FetchableRecord, Decodable {
    public let item: String
    public let reason: String?
    public let quantity: String?
    public let stationId: String?
    public let createdAt: String?
    enum CodingKeys: String, CodingKey {
        case item; case reason; case quantity
        case stationId = "station_id"; case createdAt = "created_at"
    }
    public init(item: String, reason: String?, quantity: String?, stationId: String?, createdAt: String?) {
        self.item = item; self.reason = reason; self.quantity = quantity
        self.stationId = stationId; self.createdAt = createdAt
    }
}

/// staff_certifications row (active, expires within 7 days). Mirrors MorningDigestCertItem.
public struct MorningCertItem: Equatable {
    public let cookId: String
    public let certLabel: String
    public let certType: String
    public let expiresOn: String
    public let daysUntil: Int
    public init(cookId: String, certLabel: String, certType: String, expiresOn: String, daysUntil: Int) {
        self.cookId = cookId; self.certLabel = certLabel; self.certType = certType
        self.expiresOn = expiresOn; self.daysUntil = daysUntil
    }
}

/// equipment_maintenance_schedule row (due now). Mirrors MorningDigestMaintenanceItem.
public struct MorningMaintenanceItem: Equatable {
    public let equipmentName: String
    public let task: String
    public let frequency: String
    public let nextDue: String
    public let daysUntil: Int
    public init(equipmentName: String, task: String, frequency: String, nextDue: String, daysUntil: Int) {
        self.equipmentName = equipmentName; self.task = task; self.frequency = frequency
        self.nextDue = nextDue; self.daysUntil = daysUntil
    }
}

/// beo_events + beo_prep_tasks rollup (open prep). Mirrors MorningDigestBeoPrepItem.
public struct MorningBeoPrepItem: Equatable {
    public let eventId: Int
    public let title: String
    public let eventDate: String?
    public let eventTime: String?
    public let guestCount: Int
    public let openTasks: Int
    public let doneTasks: Int
    public let totalTasks: Int
    public init(eventId: Int, title: String, eventDate: String?, eventTime: String?,
                guestCount: Int, openTasks: Int, doneTasks: Int, totalTasks: Int) {
        self.eventId = eventId; self.title = title; self.eventDate = eventDate
        self.eventTime = eventTime; self.guestCount = guestCount
        self.openTasks = openTasks; self.doneTasks = doneTasks; self.totalTasks = totalTasks
    }
}

/// Price shock as surfaced by the digest (subset of PriceShockRow used by the UI + Slack text).
/// Mirrors the fields lib/morningDigest.ts reads off listPriceShocks results.
public struct MorningPriceShock: Equatable {
    public let vendor: String
    public let sku: String
    public let ingredient: String
    public let deltaPct: Double
    public init(vendor: String, sku: String, ingredient: String, deltaPct: Double) {
        self.vendor = vendor; self.sku = sku; self.ingredient = ingredient; self.deltaPct = deltaPct
    }
}

/// A digest section: `{ count, items }`. Mirrors MorningDigestSection<T>.
public struct MorningSection<Item: Equatable>: Equatable {
    public let count: Int
    public let items: [Item]
    public init(count: Int, items: [Item]) {
        self.count = count; self.items = items
    }
}

/// The fully-assembled morning digest. Mirrors the MorningDigest TS interface,
/// minus `summary` (only `alerts` are surfaced by the page + Slack text).
public struct MorningDigest: Equatable {
    public let shiftDate: String
    public let locationId: String
    public let alerts: [CommandAlert]
    public let eightySix: MorningSection<MorningEightySixItem>
    public let priceShocks: MorningSection<MorningPriceShock>
    public let certsExpiringWeek: MorningSection<MorningCertItem>
    public let maintenanceDue: MorningSection<MorningMaintenanceItem>
    public let beoPrep: MorningSection<MorningBeoPrepItem>
    public let webhookText: String

    public init(
        shiftDate: String,
        locationId: String,
        alerts: [CommandAlert],
        eightySix: MorningSection<MorningEightySixItem>,
        priceShocks: MorningSection<MorningPriceShock>,
        certsExpiringWeek: MorningSection<MorningCertItem>,
        maintenanceDue: MorningSection<MorningMaintenanceItem>,
        beoPrep: MorningSection<MorningBeoPrepItem>,
        webhookText: String
    ) {
        self.shiftDate = shiftDate
        self.locationId = locationId
        self.alerts = alerts
        self.eightySix = eightySix
        self.priceShocks = priceShocks
        self.certsExpiringWeek = certsExpiringWeek
        self.maintenanceDue = maintenanceDue
        self.beoPrep = beoPrep
        self.webhookText = webhookText
    }
}

// MARK: - Raw projection rows (from MorningRepository SELECTs)

/// staff_certifications projection (before day-window filtering).
public struct MrnCertRow: FetchableRecord, Decodable {
    public let cookId: String
    public let certLabel: String
    public let certType: String
    public let expiresOn: String
    enum CodingKeys: String, CodingKey {
        case cookId = "cook_id"; case certLabel = "cert_label"
        case certType = "cert_type"; case expiresOn = "expires_on"
    }
    public init(cookId: String, certLabel: String, certType: String, expiresOn: String) {
        self.cookId = cookId; self.certLabel = certLabel
        self.certType = certType; self.expiresOn = expiresOn
    }
}

/// equipment_maintenance_schedule ⋈ equipment projection (before day-window filtering).
public struct MrnMaintenanceRow: FetchableRecord, Decodable {
    public let equipmentName: String
    public let task: String
    public let frequency: String
    public let nextDue: String
    enum CodingKeys: String, CodingKey {
        case equipmentName = "equipment_name"; case task
        case frequency; case nextDue = "next_due"
    }
    public init(equipmentName: String, task: String, frequency: String, nextDue: String) {
        self.equipmentName = equipmentName; self.task = task
        self.frequency = frequency; self.nextDue = nextDue
    }
}

/// beo_events + beo_prep_tasks rollup projection.
public struct MrnBeoRow: FetchableRecord, Decodable {
    public let eventId: Int
    public let title: String
    public let eventDate: String?
    public let eventTime: String?
    public let guestCount: Int
    public let openTasks: Int
    public let doneTasks: Int
    public let totalTasks: Int
    enum CodingKeys: String, CodingKey {
        case eventId = "event_id"; case title
        case eventDate = "event_date"; case eventTime = "event_time"
        case guestCount = "guest_count"; case openTasks = "open_tasks"
        case doneTasks = "done_tasks"; case totalTasks = "total_tasks"
    }
    public init(eventId: Int, title: String, eventDate: String?, eventTime: String?,
                guestCount: Int, openTasks: Int, doneTasks: Int, totalTasks: Int) {
        self.eventId = eventId; self.title = title; self.eventDate = eventDate
        self.eventTime = eventTime; self.guestCount = guestCount
        self.openTasks = openTasks; self.doneTasks = doneTasks; self.totalTasks = totalTasks
    }
}

/// Everything the morning digest needs beyond the CommandBundle. Produced by
/// `MorningRepository.fetch`; consumed by `MorningCompute.assemble`.
public struct MorningBundle {
    public let eightySixItems: [MorningEightySixItem]  // ordered id DESC, limit 10
    public let eightySixCount: Int
    public let priceShocks: [MorningPriceShock]         // already ranked + capped by the repo
    public let certRows: [MrnCertRow]                   // ordered expires_on ASC, cook_id ASC
    public let maintenanceRows: [MrnMaintenanceRow]     // ordered next_due ASC, name ASC
    public let beoRows: [MrnBeoRow]                     // ordered event_date ASC, event_time ASC (repo)

    public init(
        eightySixItems: [MorningEightySixItem],
        eightySixCount: Int,
        priceShocks: [MorningPriceShock],
        certRows: [MrnCertRow],
        maintenanceRows: [MrnMaintenanceRow],
        beoRows: [MrnBeoRow]
    ) {
        self.eightySixItems = eightySixItems
        self.eightySixCount = eightySixCount
        self.priceShocks = priceShocks
        self.certRows = certRows
        self.maintenanceRows = maintenanceRows
        self.beoRows = beoRows
    }
}
