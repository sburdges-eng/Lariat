import Foundation
import GRDB

// Record + input types for the BEO operator surfaces (A6.5) — parity with the
// rows read/written by `app/api/beo/**` against the web-owned schema in
// `lib/db.ts` (beo_events / beo_line_items / beo_prep_tasks / beo_courses /
// beo_prep_history). Schema is read AS-IS; no native migrations.
//
// Money columns (documented per column type):
//   beo_events.tax_rate        REAL — fraction (default 0.0675)
//   beo_events.service_fee_pct REAL — percent (default 20)
//   beo_events.min_spend       REAL — dollars, nullable (no default)
//   beo_line_items.unit_cost   REAL — dollars (default 0)
//   beo_line_items.quantity    REAL — item count (default 1)
// All flow as Doubles end to end; rounding happens only through the ported
// `BeoWorksheetCompute.roundMoney` at total boundaries (web parity).

/// Typed write failures — pins the web routes' status-code semantics:
/// 400 (`/api/beo` validation), 404 (event/course not found at location),
/// 422 (`/api/beo/courses` validation + malformed course_id patch).
public enum BeoWriteError: Error, LocalizedError, Equatable {
    case badRequest(String)      // web 400
    case notFound(String)        // web 404
    case unprocessable(String)   // web 422

    public var errorDescription: String? {
        switch self {
        case .badRequest(let m), .notFound(let m), .unprocessable(let m):
            return m
        }
    }
}

/// Tri-state patch field: `.absent` = key not in body (don't touch),
/// `.set(nil)` = explicit clear, `.set(v)` = write v. Mirrors the web's
/// `'key' in body` provided-flag CASE columns.
public enum FieldPatch<T: Equatable & Sendable>: Equatable, Sendable {
    case absent
    case set(T?)
}

// MARK: - Rows

/// One `beo_events` row (share_token lifecycle columns are edge-blocker
/// territory — never selected or written natively).
public struct BeoEventRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let title: String
    public let eventDate: String?
    public let eventTime: String?
    public let contactName: String?
    public let guestCount: Int?
    public let notes: String?
    public let status: String?
    public let taxRate: Double?
    public let serviceFeePct: Double?
    public let minSpend: Double?
    public let locationId: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, title, notes, status
        case eventDate = "event_date"
        case eventTime = "event_time"
        case contactName = "contact_name"
        case guestCount = "guest_count"
        case taxRate = "tax_rate"
        case serviceFeePct = "service_fee_pct"
        case minSpend = "min_spend"
        case locationId = "location_id"
        case createdAt = "created_at"
    }

    public init(
        id: Int64, title: String, eventDate: String?, eventTime: String?,
        contactName: String?, guestCount: Int?, notes: String?, status: String?,
        taxRate: Double?, serviceFeePct: Double?, minSpend: Double?,
        locationId: String?, createdAt: String?
    ) {
        self.id = id; self.title = title; self.eventDate = eventDate
        self.eventTime = eventTime; self.contactName = contactName
        self.guestCount = guestCount; self.notes = notes; self.status = status
        self.taxRate = taxRate; self.serviceFeePct = serviceFeePct
        self.minSpend = minSpend; self.locationId = locationId
        self.createdAt = createdAt
    }
}

/// One `beo_line_items` row (post-migration shape: prep-sheet columns +
/// nullable course_id FK, ON DELETE SET NULL).
public struct BeoLineItemRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let eventId: Int64
    public let sortOrder: Int
    public let itemName: String
    public let category: String?
    public let unitCost: Double
    public let quantity: Double
    public let prepNotes: String?
    public let secondaryPrepNotes: String?
    public let orderItemsNotes: String?
    public let orderTime: String?
    public let groupNote: String?
    public let courseId: Int64?

    enum CodingKeys: String, CodingKey {
        case id, category, quantity
        case eventId = "event_id"
        case sortOrder = "sort_order"
        case itemName = "item_name"
        case unitCost = "unit_cost"
        case prepNotes = "prep_notes"
        case secondaryPrepNotes = "secondary_prep_notes"
        case orderItemsNotes = "order_items_notes"
        case orderTime = "order_time"
        case groupNote = "group_note"
        case courseId = "course_id"
    }

    public init(
        id: Int64, eventId: Int64, sortOrder: Int, itemName: String,
        category: String?, unitCost: Double, quantity: Double,
        prepNotes: String?, secondaryPrepNotes: String?, orderItemsNotes: String?,
        orderTime: String?, groupNote: String?, courseId: Int64?
    ) {
        self.id = id; self.eventId = eventId; self.sortOrder = sortOrder
        self.itemName = itemName; self.category = category
        self.unitCost = unitCost; self.quantity = quantity
        self.prepNotes = prepNotes; self.secondaryPrepNotes = secondaryPrepNotes
        self.orderItemsNotes = orderItemsNotes; self.orderTime = orderTime
        self.groupNote = groupNote; self.courseId = courseId
    }
}

/// One `beo_prep_tasks` row.
public struct BeoPrepTaskRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let eventId: Int64
    public let task: String
    public let dueDate: String?
    public let done: Bool
    public let sortOrder: Int
    public let locationId: String?

    enum CodingKeys: String, CodingKey {
        case id, task, done
        case eventId = "event_id"
        case dueDate = "due_date"
        case sortOrder = "sort_order"
        case locationId = "location_id"
    }

    public init(
        id: Int64, eventId: Int64, task: String, dueDate: String?,
        done: Bool, sortOrder: Int, locationId: String?
    ) {
        self.id = id; self.eventId = eventId; self.task = task
        self.dueDate = dueDate; self.done = done; self.sortOrder = sortOrder
        self.locationId = locationId
    }
}

/// One `beo_courses` row (post-migration shape incl. station_id).
public struct BeoCourseRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let eventId: Int64
    public let locationId: String
    public let courseLabel: String
    public let fireAt: String
    public let notes: String?
    public let sortOrder: Int?
    public let stationId: String?
    public let createdAt: String?
    public let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, notes
        case eventId = "event_id"
        case locationId = "location_id"
        case courseLabel = "course_label"
        case fireAt = "fire_at"
        case sortOrder = "sort_order"
        case stationId = "station_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(
        id: Int64, eventId: Int64, locationId: String, courseLabel: String,
        fireAt: String, notes: String?, sortOrder: Int?, stationId: String?,
        createdAt: String?, updatedAt: String?
    ) {
        self.id = id; self.eventId = eventId; self.locationId = locationId
        self.courseLabel = courseLabel; self.fireAt = fireAt; self.notes = notes
        self.sortOrder = sortOrder; self.stationId = stationId
        self.createdAt = createdAt; self.updatedAt = updatedAt
    }
}

/// GET /api/beo payload: `{location_id, events, prep_tasks, line_items}`.
public struct BeoSnapshot: Sendable, Equatable {
    public let locationId: String
    public let events: [BeoEventRow]
    public let prepTasks: [BeoPrepTaskRow]
    public let lineItems: [BeoLineItemRow]

    public init(locationId: String, events: [BeoEventRow], prepTasks: [BeoPrepTaskRow], lineItems: [BeoLineItemRow]) {
        self.locationId = locationId
        self.events = events
        self.prepTasks = prepTasks
        self.lineItems = lineItems
    }
}

// MARK: - beo_prep_history rows (read-only reference data)

/// One `beo_prep_history` row (`PrepHistoryRow` in lib/beoPrepHistory.ts).
public struct BeoPrepHistoryRow: Codable, FetchableRecord, Sendable, Equatable {
    public let eventDate: String?
    public let client: String?
    public let type: String?
    public let amountQty: String?
    public let prepDay: String?
    public let prePrepNotes: String?
    public let platingNotes: String?
    public let source: String
    public let importedAt: String?

    enum CodingKeys: String, CodingKey {
        case client, type, source
        case eventDate = "event_date"
        case amountQty = "amount_qty"
        case prepDay = "prep_day"
        case prePrepNotes = "pre_prep_notes"
        case platingNotes = "plating_notes"
        case importedAt = "imported_at"
    }

    public init(
        eventDate: String?, client: String?, type: String?, amountQty: String?,
        prepDay: String?, prePrepNotes: String?, platingNotes: String?,
        source: String, importedAt: String?
    ) {
        self.eventDate = eventDate; self.client = client; self.type = type
        self.amountQty = amountQty; self.prepDay = prepDay
        self.prePrepNotes = prePrepNotes; self.platingNotes = platingNotes
        self.source = source; self.importedAt = importedAt
    }
}

/// `PrepHistoryMatch` — one requested item with ≥1 history row.
public struct BeoPrepHistoryMatch: Sendable, Equatable, Identifiable {
    public var id: String { item }
    public let item: String
    public let history: [BeoPrepHistoryRow]

    public init(item: String, history: [BeoPrepHistoryRow]) {
        self.item = item
        self.history = history
    }
}

/// `PrepMedian` — batch median of historical prep quantities.
public struct BeoPrepMedian: Sendable, Equatable {
    public let key: String
    public let item: String
    public let median: Double
    public let samples: Int
    public let totalRows: Int

    public init(key: String, item: String, median: Double, samples: Int, totalRows: Int) {
        self.key = key; self.item = item; self.median = median
        self.samples = samples; self.totalRows = totalRows
    }
}

/// `RecipePrepHistoryRow` — history row + the matched `item` text.
public struct BeoRecipePrepHistoryRow: Codable, FetchableRecord, Sendable, Equatable {
    public let item: String
    public let eventDate: String?
    public let client: String?
    public let type: String?
    public let amountQty: String?
    public let prepDay: String?
    public let prePrepNotes: String?
    public let platingNotes: String?
    public let source: String
    public let importedAt: String?

    enum CodingKeys: String, CodingKey {
        case item, client, type, source
        case eventDate = "event_date"
        case amountQty = "amount_qty"
        case prepDay = "prep_day"
        case prePrepNotes = "pre_prep_notes"
        case platingNotes = "plating_notes"
        case importedAt = "imported_at"
    }
}

/// `RecentEvent` — recent catering events grouped by client+event_date
/// (Main-Item rows only).
public struct BeoRecentEvent: Sendable, Equatable {
    public struct Item: Sendable, Equatable {
        public let item: String
        public let amountQty: String?
        public init(item: String, amountQty: String?) {
            self.item = item
            self.amountQty = amountQty
        }
    }

    public let eventDate: String
    public let client: String?
    public var items: [Item]

    public init(eventDate: String, client: String?, items: [Item]) {
        self.eventDate = eventDate
        self.client = client
        self.items = items
    }
}

// MARK: - Write inputs / patches

/// POST /api/beo action='event' body (validated in the repository).
public struct BeoEventInput: Sendable, Equatable {
    public var title: String?
    public var eventDate: String?
    public var eventTime: String?
    public var contactName: String?
    public var guestCount: Int?
    public var notes: String?
    public var status: String?
    public var taxRate: Double?          // omitted → default 0.0675
    public var serviceFeePct: Double?    // omitted → default 20
    public var minSpend: Double?         // omitted → NULL; negative → 400

    public init(
        title: String? = nil, eventDate: String? = nil, eventTime: String? = nil,
        contactName: String? = nil, guestCount: Int? = nil, notes: String? = nil,
        status: String? = nil, taxRate: Double? = nil, serviceFeePct: Double? = nil,
        minSpend: Double? = nil
    ) {
        self.title = title; self.eventDate = eventDate; self.eventTime = eventTime
        self.contactName = contactName; self.guestCount = guestCount
        self.notes = notes; self.status = status; self.taxRate = taxRate
        self.serviceFeePct = serviceFeePct; self.minSpend = minSpend
    }
}

/// POST /api/beo action='update_event' partial patch. `nil` = key omitted
/// (COALESCE preserves the column). Only `minSpend` is clearable (web
/// provided-flag CASE).
public struct BeoEventPatch: Sendable, Equatable {
    public var title: String?
    public var eventDate: String?
    public var eventTime: String?
    public var contactName: String?
    public var guestCount: Int?
    public var notes: String?
    public var status: String?
    public var taxRate: Double?
    public var serviceFeePct: Double?
    public var minSpend: FieldPatch<Double>

    public init(
        title: String? = nil, eventDate: String? = nil, eventTime: String? = nil,
        contactName: String? = nil, guestCount: Int? = nil, notes: String? = nil,
        status: String? = nil, taxRate: Double? = nil, serviceFeePct: Double? = nil,
        minSpend: FieldPatch<Double> = .absent
    ) {
        self.title = title; self.eventDate = eventDate; self.eventTime = eventTime
        self.contactName = contactName; self.guestCount = guestCount
        self.notes = notes; self.status = status; self.taxRate = taxRate
        self.serviceFeePct = serviceFeePct; self.minSpend = minSpend
    }
}

/// POST /api/beo action='line' body.
public struct BeoLineInput: Sendable, Equatable {
    public var eventId: Int64?
    public var itemName: String?
    public var category: String?
    public var unitCost: Double?     // omitted → 0
    public var quantity: Double?     // omitted → 1
    public var sortOrder: Int?       // omitted → 0
    public var prepNotes: String?
    public var secondaryPrepNotes: String?
    public var orderItemsNotes: String?
    public var orderTime: String?
    public var groupNote: String?

    public init(
        eventId: Int64? = nil, itemName: String? = nil, category: String? = nil,
        unitCost: Double? = nil, quantity: Double? = nil, sortOrder: Int? = nil,
        prepNotes: String? = nil, secondaryPrepNotes: String? = nil,
        orderItemsNotes: String? = nil, orderTime: String? = nil, groupNote: String? = nil
    ) {
        self.eventId = eventId; self.itemName = itemName; self.category = category
        self.unitCost = unitCost; self.quantity = quantity; self.sortOrder = sortOrder
        self.prepNotes = prepNotes; self.secondaryPrepNotes = secondaryPrepNotes
        self.orderItemsNotes = orderItemsNotes; self.orderTime = orderTime
        self.groupNote = groupNote
    }
}

/// POST /api/beo action='update_line' partial patch.
/// COALESCE fields (`nil` = preserve; cannot be cleared): itemName, unitCost,
/// quantity, category. Prep-sheet text fields use the provided-flag CASE
/// (`.set(nil)` / empty string = clear). `courseId` is the tri-state
/// `course_id` patch (nil = absent, `.set(nil)` = clear, `.set(n)` = bind).
public struct BeoLinePatch: Sendable, Equatable {
    public var itemName: String?
    public var unitCost: Double?
    public var quantity: Double?
    public var category: String?
    public var prepNotes: FieldPatch<String>
    public var secondaryPrepNotes: FieldPatch<String>
    public var orderItemsNotes: FieldPatch<String>
    public var orderTime: FieldPatch<String>
    public var groupNote: FieldPatch<String>
    public var courseId: FieldPatch<Int64>

    public init(
        itemName: String? = nil, unitCost: Double? = nil, quantity: Double? = nil,
        category: String? = nil,
        prepNotes: FieldPatch<String> = .absent,
        secondaryPrepNotes: FieldPatch<String> = .absent,
        orderItemsNotes: FieldPatch<String> = .absent,
        orderTime: FieldPatch<String> = .absent,
        groupNote: FieldPatch<String> = .absent,
        courseId: FieldPatch<Int64> = .absent
    ) {
        self.itemName = itemName; self.unitCost = unitCost; self.quantity = quantity
        self.category = category; self.prepNotes = prepNotes
        self.secondaryPrepNotes = secondaryPrepNotes
        self.orderItemsNotes = orderItemsNotes; self.orderTime = orderTime
        self.groupNote = groupNote; self.courseId = courseId
    }
}

/// PATCH /api/beo/courses/:id partial patch. `courseLabel`/`fireAt`/`sortOrder`
/// are COALESCE fields (`nil` = preserve; empty label is REJECTED, not
/// cleared); `notes`/`stationId` are clearable provided-flag CASE fields.
public struct BeoCoursePatch: Sendable, Equatable {
    public var courseLabel: String?
    public var fireAt: String?
    public var notes: FieldPatch<String>
    public var sortOrder: Int?
    public var stationId: FieldPatch<String>

    public init(
        courseLabel: String? = nil, fireAt: String? = nil,
        notes: FieldPatch<String> = .absent, sortOrder: Int? = nil,
        stationId: FieldPatch<String> = .absent
    ) {
        self.courseLabel = courseLabel; self.fireAt = fireAt; self.notes = notes
        self.sortOrder = sortOrder; self.stationId = stationId
    }
}
