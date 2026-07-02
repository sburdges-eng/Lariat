import Foundation
import GRDB

/// Prep-task priority (0 normal, 1 high, 2 rush). Mirrors PRIORITY_LABEL /
/// cleanPriority in app/prep/PrepBoard.jsx + app/api/prep-tasks/route.js.
public enum PrepPriority: Int, CaseIterable, Identifiable, Sendable {
    case normal = 0, high = 1, rush = 2

    public var id: Int { rawValue }

    public var label: String {
        switch self {
        case .normal: return "normal"
        case .high: return "high"
        case .rush: return "rush"
        }
    }

    /// Clamp arbitrary input to 0…2 — parity with `cleanPriority` in the web route.
    public static func clamp(_ raw: Int) -> PrepPriority {
        PrepPriority(rawValue: max(0, min(2, raw))) ?? .normal
    }
}

/// Prep-task status flow: todo → in_progress → done (or skipped). Mirrors the
/// STATUSES set in app/api/prep-tasks/[id]/route.js + the prep_tasks CHECK.
public enum PrepStatus: String, CaseIterable, Identifiable, Sendable {
    case todo, inProgress = "in_progress", done, skipped

    public var id: String { rawValue }

    public var isClosed: Bool { self == .done || self == .skipped }
}

/// Full `prep_tasks` row for the daily board (parity with the SELECT column
/// list in app/prep/page.jsx and app/api/prep-tasks routes).
public struct PrepTaskRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let shiftDate: String
    public let stationId: String?
    public let task: String
    public let qty: String?
    public let recipeSlug: String?
    public let notes: String?
    public let priority: Int
    public let assignedCookId: String?
    public let status: String
    public let startedAt: String?
    public let doneAt: String?
    public let doneBy: String?
    public let source: String?
    public let sourceRef: String?
    public let sortOrder: Int
    public let locationId: String
    public let createdAt: String?
    public let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case stationId = "station_id"
        case task, qty
        case recipeSlug = "recipe_slug"
        case notes, priority
        case assignedCookId = "assigned_cook_id"
        case status
        case startedAt = "started_at"
        case doneAt = "done_at"
        case doneBy = "done_by"
        case source
        case sourceRef = "source_ref"
        case sortOrder = "sort_order"
        case locationId = "location_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public var priorityLevel: PrepPriority { PrepPriority.clamp(priority) }
    public var statusValue: PrepStatus? { PrepStatus(rawValue: status) }
}

/// Fields for POST /api/prep-tasks (add a task). Nil = column omitted / cleared.
public struct PrepTaskCreateInput: Sendable {
    public let task: String
    public let shiftDate: String?
    public let stationId: String?
    public let qty: String?
    public let recipeSlug: String?
    public let notes: String?
    public let priority: Int
    public let assignedCookId: String?
    public let source: String?
    public let sourceRef: String?
    public let sortOrder: Int
    public let cookId: String?

    public init(
        task: String,
        shiftDate: String? = nil,
        stationId: String? = nil,
        qty: String? = nil,
        recipeSlug: String? = nil,
        notes: String? = nil,
        priority: Int = 0,
        assignedCookId: String? = nil,
        source: String? = nil,
        sourceRef: String? = nil,
        sortOrder: Int = 0,
        cookId: String? = nil
    ) {
        self.task = task
        self.shiftDate = shiftDate
        self.stationId = stationId
        self.qty = qty
        self.recipeSlug = recipeSlug
        self.notes = notes
        self.priority = priority
        self.assignedCookId = assignedCookId
        self.source = source
        self.sourceRef = sourceRef
        self.sortOrder = sortOrder
        self.cookId = cookId
    }
}

/// Partial-update patch for PATCH /api/prep-tasks/:id. Only fields explicitly
/// provided are written — mirrors the `hasOwnProperty` gating in the web route.
/// `claim`/`release` map to the assigned_cook_id column; `status` drives the
/// started_at / done_at / done_by lifecycle columns.
public struct PrepTaskPatchInput: Sendable {
    public var claim: Bool
    public var release: Bool
    public var status: PatchField<String>?
    public var task: PatchField<String>?
    public var stationId: PatchField<String>?
    public var qty: PatchField<String>?
    public var recipeSlug: PatchField<String>?
    public var notes: PatchField<String>?
    public var priority: PatchField<Int>?
    public var assignedCookId: PatchField<String>?
    public var sortOrder: PatchField<Int>?
    public var cookId: String?

    public init(
        claim: Bool = false,
        release: Bool = false,
        status: PatchField<String>? = nil,
        task: PatchField<String>? = nil,
        stationId: PatchField<String>? = nil,
        qty: PatchField<String>? = nil,
        recipeSlug: PatchField<String>? = nil,
        notes: PatchField<String>? = nil,
        priority: PatchField<Int>? = nil,
        assignedCookId: PatchField<String>? = nil,
        sortOrder: PatchField<Int>? = nil,
        cookId: String? = nil
    ) {
        self.claim = claim
        self.release = release
        self.status = status
        self.task = task
        self.stationId = stationId
        self.qty = qty
        self.recipeSlug = recipeSlug
        self.notes = notes
        self.priority = priority
        self.assignedCookId = assignedCookId
        self.sortOrder = sortOrder
        self.cookId = cookId
    }

    /// Convenience: set only the status (claim/start/done/skip/reopen paths).
    public static func status(_ value: String, cookId: String?) -> PrepTaskPatchInput {
        PrepTaskPatchInput(status: .set(value), cookId: cookId)
    }

    public static func claimBy(_ cookId: String?) -> PrepTaskPatchInput {
        PrepTaskPatchInput(claim: true, cookId: cookId)
    }

    public static func releaseClaim(cookId: String?) -> PrepTaskPatchInput {
        PrepTaskPatchInput(release: true, cookId: cookId)
    }
}

/// A patchable column: `.set(value)` writes it (value may still be nil after
/// clip, matching the web route where `hasOwn(body, key)` writes clip(...) which
/// can be null). Absence of the field means "leave column untouched".
public enum PatchField<Value: Sendable>: Sendable {
    case set(Value)
}

/// Errors from the prep-task write paths — status-code parity with the web routes.
public enum PrepTaskWriteError: Error, LocalizedError, Equatable {
    case taskRequired          // 400 'task required'
    case badStatus             // 400 'bad status'
    case cookRequired          // 400 'cook required'   (claim without a cook)
    case claimAndRelease       // 400 'pick claim or release'
    case nothingToSave         // 400 'nothing to save'
    case notFound              // 404 'not found'

    public var errorDescription: String? {
        switch self {
        case .taskRequired: return "Task is required"
        case .badStatus: return "That status is not allowed"
        case .cookRequired: return "Set cook first"
        case .claimAndRelease: return "Pick claim or release"
        case .nothingToSave: return "Nothing to save"
        case .notFound: return "Could not find that prep task"
        }
    }
}

/// A station group for the board: open tasks under one station key.
public struct PrepStationGroup: Sendable, Identifiable {
    public let stationId: String       // "" = "Any station"
    public let stationName: String
    public let tasks: [PrepTaskRow]

    public var id: String { stationId.isEmpty ? "__any__" : stationId }

    public init(stationId: String, stationName: String, tasks: [PrepTaskRow]) {
        self.stationId = stationId
        self.stationName = stationName
        self.tasks = tasks
    }
}

/// Status tallies for the board subtitle ("N to do · M in progress · K done").
public struct PrepStatusCounts: Sendable, Equatable {
    public var todo: Int
    public var inProgress: Int
    public var done: Int
    public var skipped: Int

    public init(todo: Int = 0, inProgress: Int = 0, done: Int = 0, skipped: Int = 0) {
        self.todo = todo
        self.inProgress = inProgress
        self.done = done
        self.skipped = skipped
    }
}

/// Board snapshot: open tasks grouped by station + a closed (done/skipped) bin.
public struct PrepBoardSnapshot: Sendable {
    public let locationId: String
    public let date: String
    public let openGroups: [PrepStationGroup]
    public let closed: [PrepTaskRow]
    public let counts: PrepStatusCounts

    public init(
        locationId: String,
        date: String,
        openGroups: [PrepStationGroup],
        closed: [PrepTaskRow],
        counts: PrepStatusCounts
    ) {
        self.locationId = locationId
        self.date = date
        self.openGroups = openGroups
        self.closed = closed
        self.counts = counts
    }
}

/// Median of historical prep quantities for one item — value-parity with
/// `PrepMedian` in lib/beoPrepHistory.ts (backs the menu-engineering column).
public struct PrepMedian: Sendable, Equatable {
    /// Lower-cased canonical key (matches the Map key). Diagnostics only.
    public let key: String
    /// The exact-cased input item the median was computed for.
    public let item: String
    /// Median of numeric `amount_qty` across matching rows.
    public let median: Double
    /// Count of rows that contributed numeric values.
    public let samples: Int
    /// Total matching rows including non-numeric `amount_qty` (e.g. "as needed").
    public let totalRows: Int

    public init(key: String, item: String, median: Double, samples: Int, totalRows: Int) {
        self.key = key
        self.item = item
        self.median = median
        self.samples = samples
        self.totalRows = totalRows
    }
}
