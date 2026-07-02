import Foundation

/// Pure floor-board rules ported from `app/floor/FloorPlan.jsx`.
///
/// The web app has no lib module for the floor — the status verbs, the
/// starter set, and the header counts live in the client component. These
/// tests are authored against that component's code (no web test file
/// exists for the UI layer; the route rules are covered by
/// `DiningTablesRepositoryTests`).
public enum FloorCompute {
    /// Status verbs offered for a table in `status`, in render order.
    /// Mirrors the ActionPanel state machine:
    ///   open   → Mark seated, Mark dirty, Close table
    ///   seated → Mark dirty, Close table
    ///   dirty  → Mark open, Close table
    ///   closed → Reopen
    /// Unknown statuses fall back to the closed treatment ("Reopen") so a
    /// hand-edited row is always recoverable.
    public static func actions(for status: String) -> [FloorTableAction] {
        switch status {
        case "open":
            return [
                FloorTableAction(label: "Mark seated", target: "seated", isPrimary: true),
                FloorTableAction(label: "Mark dirty", target: "dirty", isPrimary: false),
                FloorTableAction(label: "Close table", target: "closed", isPrimary: false),
            ]
        case "seated":
            return [
                FloorTableAction(label: "Mark dirty", target: "dirty", isPrimary: true),
                FloorTableAction(label: "Close table", target: "closed", isPrimary: false),
            ]
        case "dirty":
            return [
                FloorTableAction(label: "Mark open", target: "open", isPrimary: true),
                FloorTableAction(label: "Close table", target: "closed", isPrimary: false),
            ]
        default:
            return [FloorTableAction(label: "Reopen", target: "open", isPrimary: true)]
        }
    }

    /// Header counts: total · seated · open · dirty (FloorPlan subtitle).
    public static func statusCounts(_ tables: [DiningTableRow]) -> FloorStatusCounts {
        var seated = 0, open = 0, dirty = 0, closed = 0
        for t in tables {
            switch t.status {
            case "seated": seated += 1
            case "open": open += 1
            case "dirty": dirty += 1
            case "closed": closed += 1
            default: break
            }
        }
        return FloorStatusCounts(
            total: tables.count, open: open, seated: seated, dirty: dirty, closed: closed
        )
    }

    /// Empty-floor starter set — six 2-tops on a 2-row grid (STARTER_TABLES).
    /// Matches the API's default capacity (2).
    public static let starterTables: [DiningTableCreateInput] = [
        DiningTableCreateInput(id: "T1", name: "T1", capacity: 2, x: 0, y: 0, w: 1, h: 1),
        DiningTableCreateInput(id: "T2", name: "T2", capacity: 2, x: 2, y: 0, w: 1, h: 1),
        DiningTableCreateInput(id: "T3", name: "T3", capacity: 2, x: 4, y: 0, w: 1, h: 1),
        DiningTableCreateInput(id: "T4", name: "T4", capacity: 2, x: 0, y: 2, w: 1, h: 1),
        DiningTableCreateInput(id: "T5", name: "T5", capacity: 2, x: 2, y: 2, w: 1, h: 1),
        DiningTableCreateInput(id: "T6", name: "T6", capacity: 2, x: 4, y: 2, w: 1, h: 1),
    ]
}

/// One status verb button on the floor action panel.
public struct FloorTableAction: Sendable, Equatable {
    public let label: String
    /// Target status the verb PATCHes to.
    public let target: String
    public let isPrimary: Bool

    public init(label: String, target: String, isPrimary: Bool) {
        self.label = label
        self.target = target
        self.isPrimary = isPrimary
    }
}

public struct FloorStatusCounts: Sendable, Equatable {
    public let total: Int
    public let open: Int
    public let seated: Int
    public let dirty: Int
    public let closed: Int

    public init(total: Int, open: Int, seated: Int, dirty: Int, closed: Int) {
        self.total = total
        self.open = open
        self.seated = seated
        self.dirty = dirty
        self.closed = closed
    }
}
