import Foundation

// GRDB-free port of the aggregation half of `lib/commandCenter.ts`.
//
// Task 7 (CommandRepository) already ran every SELECT and packed the raw
// row-sets into a `CommandBundle`. This module does ONLY the counting /
// derivation that `summarize` performs AFTER its queries, plus the
// threshold logic of `alertsFor`. No database, no clock — `today` is a
// parameter so the output is deterministic and parity-auditable.
//
// `CommandBundle` lives here (not in LariatDB) so both the repository
// (which imports LariatModel) and this compute layer can share it. The
// `Cmd*` projection records it is built from also live in LariatModel
// (Records.swift), so this is their natural home.

// MARK: - Input bundle

/// Raw bundle of every row-set that `commandCenter.ts` summarize() reads.
/// Produced by `CommandRepository.fetch` (LariatDB). No aggregation — that
/// is `CommandCompute.summarize`'s job.
public struct CommandBundle {
    public let salesYesterday: CmdSalesDailyRow?
    public let salesTrailing: CmdSalesTrailingAvg?
    public let eightySixCount: Int
    public let lowParIngredients: [CmdLowParIngredient]
    public let parTotal: Int
    public let openCountsCount: Int
    public let shiftBreaks: [CmdShiftBreakRow]
    public let certRows: [CmdCertRow]
    public let performanceReviewsToday: Int
    public let performanceReviewsTotal: Int
    public let tempLogRows: [CmdTempLogRow]
    public let dateMarkRows: [CmdDateMarkRow]
    public let calibrationRows: [CmdCalibrationRow]
    public let cleaningCounts: CmdCleaningCounts?
    public let preshiftNoteCount: Int
    public let eventsCount: Int
    public let eventsGuests: Int
    public let reservationRows: [CmdReservationRow]
    public let prepTaskRows: [CmdPrepTaskRow]
    public let wasteTodayCount: Int
    public let waste7dCount: Int
    public let diningTableRows: [CmdDiningTableRow]

    public init(
        salesYesterday: CmdSalesDailyRow?,
        salesTrailing: CmdSalesTrailingAvg?,
        eightySixCount: Int,
        lowParIngredients: [CmdLowParIngredient],
        parTotal: Int,
        openCountsCount: Int,
        shiftBreaks: [CmdShiftBreakRow],
        certRows: [CmdCertRow],
        performanceReviewsToday: Int,
        performanceReviewsTotal: Int,
        tempLogRows: [CmdTempLogRow],
        dateMarkRows: [CmdDateMarkRow],
        calibrationRows: [CmdCalibrationRow],
        cleaningCounts: CmdCleaningCounts?,
        preshiftNoteCount: Int,
        eventsCount: Int,
        eventsGuests: Int,
        reservationRows: [CmdReservationRow],
        prepTaskRows: [CmdPrepTaskRow],
        wasteTodayCount: Int,
        waste7dCount: Int,
        diningTableRows: [CmdDiningTableRow]
    ) {
        self.salesYesterday = salesYesterday
        self.salesTrailing = salesTrailing
        self.eightySixCount = eightySixCount
        self.lowParIngredients = lowParIngredients
        self.parTotal = parTotal
        self.openCountsCount = openCountsCount
        self.shiftBreaks = shiftBreaks
        self.certRows = certRows
        self.performanceReviewsToday = performanceReviewsToday
        self.performanceReviewsTotal = performanceReviewsTotal
        self.tempLogRows = tempLogRows
        self.dateMarkRows = dateMarkRows
        self.calibrationRows = calibrationRows
        self.cleaningCounts = cleaningCounts
        self.preshiftNoteCount = preshiftNoteCount
        self.eventsCount = eventsCount
        self.eventsGuests = eventsGuests
        self.reservationRows = reservationRows
        self.prepTaskRows = prepTaskRows
        self.wasteTodayCount = wasteTodayCount
        self.waste7dCount = waste7dCount
        self.diningTableRows = diningTableRows
    }
}

// MARK: - Output summary (mirrors the CommandSummary TS interface 1:1)

public struct CommandSummary {
    public struct Sales {
        public var yesterdayNet: Double  // sales.yesterday_net
        public var orders: Int           // sales.orders
        public var guests: Int           // sales.guests
        public var avg7Net: Double       // sales.avg7_net
        public var avg7Orders: Double    // sales.avg7_orders
        public var deltaPct: Double      // sales.delta_pct
    }
    public struct Inventory {
        public var lowPar: Int           // inventory.low_par
        public var parTotal: Int         // inventory.par_total
        public var openCounts: Int       // inventory.open_counts
    }
    public struct Labor {
        public var openBreaks: Int                 // labor.open_breaks
        public var certExpiring30d: Int            // labor.cert_expiring_30d
        public var certExpired: Int                // labor.cert_expired
        public var performanceReviewsToday: Int    // labor.performance_reviews_today
        public var performanceReviewsTotal: Int    // labor.performance_reviews_total
    }
    public struct FoodSafety {
        public var tempBreaches: Int       // food_safety.temp_breaches
        public var tempReadings: Int       // food_safety.temp_readings
        public var dateMarksExpired: Int   // food_safety.date_marks_expired
        public var dateMarksDueToday: Int  // food_safety.date_marks_due_today
        public var cleaningOverdue: Int    // food_safety.cleaning_overdue
        public var cleaningDueToday: Int   // food_safety.cleaning_due_today
        public var probesOverdue: Int      // food_safety.probes_overdue
        public var probesFailed: Int       // food_safety.probes_failed
        public var probesDueSoon: Int      // food_safety.probes_due_soon
        // Defaulted (not the summarize()-side default — this one) so the two
        // pre-existing direct FoodSafety(...) literal fixtures (MorningComputeTests,
        // MorningRepositoryTests) keep compiling unchanged.
        public var coolingOverdue: Int = 0 // cooling batches in a breached compliance stage (H6a)
    }
    public struct Reservations {
        public var booked: Int       // reservations.booked
        public var seated: Int       // reservations.seated
        public var completed: Int    // reservations.completed
        public var noShow: Int       // reservations.no_show
        public var cancelled: Int    // reservations.cancelled
        public var total: Int        // reservations.total
    }
    public struct Prep {
        public var todo: Int         // prep.todo
        public var inProgress: Int   // prep.in_progress
        public var done: Int         // prep.done
        public var skipped: Int      // prep.skipped
        public var rush: Int         // prep.rush
    }
    public struct Moves {
        public var total: Int        // price_moves.total / margin_moves.total
        public var up: Int           // .up
        public var down: Int         // .down
    }
    public struct DiningTables {
        public var open: Int         // dining_tables.open
        public var seated: Int       // dining_tables.seated
        public var dirty: Int        // dining_tables.dirty
        public var closed: Int       // dining_tables.closed
        public var total: Int        // dining_tables.total
        public var seatsTotal: Int   // dining_tables.seats_total
        public var seatsSeated: Int  // dining_tables.seats_seated
    }
    public struct Waste {
        public var today: Int        // waste.today
        public var last7d: Int       // waste.last_7d
    }

    public var shiftDate: String     // shift_date
    public var yesterday: String     // yesterday
    public var locationId: String    // location_id
    public var sales: Sales
    public var eightySix: Int        // eighty_six
    public var inventory: Inventory
    public var labor: Labor
    public var foodSafety: FoodSafety
    public var preshiftNotes: Int    // preshift_notes
    public var eventsToday: Int      // events_today
    public var eventsGuests: Int     // events_guests
    public var reservations: Reservations
    public var prep: Prep
    public var priceMoves: Moves     // price_moves
    public var marginMoves: Moves    // margin_moves
    public var diningTables: DiningTables
    public var waste: Waste
}

// MARK: - Output alert (mirrors the CommandAlert TS interface)

public struct CommandAlert: Equatable {
    public enum Severity: String, Equatable { case red, amber }
    public let severity: Severity
    public let source: String   // stable kebab-case key
    public let message: String  // human-readable
    public let count: Int       // the number behind the alert

    public init(severity: Severity, source: String, message: String, count: Int) {
        self.severity = severity
        self.source = source
        self.message = message
        self.count = count
    }
}

// MARK: - Compute

public enum CommandCompute {

    /// price_moves / margin_moves carrier. The web reads these from a
    /// separate repo (`listPriceShocks` / `listMarginDeltas`); they are not
    /// part of the CommandBundle, so callers inject them. Default zero.
    public struct MoveSummary {
        public var total: Int
        public var up: Int
        public var down: Int
        public init(total: Int = 0, up: Int = 0, down: Int = 0) {
            self.total = total; self.up = up; self.down = down
        }
        public static let zero = MoveSummary()
    }

    private static let redNoShowThreshold = 3
    private static let amberSalesDropPct = -0.15

    // ── Date helpers (UTC, mirroring the TS yesterdayISO/since7) ────────

    private static let isoCalDay: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    /// yesterdayISO(today): today minus one calendar day, UTC.
    static func yesterdayISO(_ today: String) -> String {
        guard let d = isoCalDay.date(from: today) else { return today }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let prev = cal.date(byAdding: .day, value: -1, to: d)!
        return isoCalDay.string(from: prev)
    }

    // MARK: summarize

    public static func summarize(
        bundle: CommandBundle,
        locationId: String,
        today: String,
        priceMoves: MoveSummary = .zero,
        marginMoves: MoveSummary = .zero,
        coolingOverdueCount: Int = 0
    ) -> CommandSummary {
        let yesterday = yesterdayISO(today)

        // ── Sales ────────────────────────────────────────────────────
        // `Number(x) || 0`: null/missing → 0.
        let yesterdayNet = bundle.salesYesterday?.netSales ?? 0
        let avg7 = bundle.salesTrailing?.avgSales ?? 0
        // avg7 > 0 ? (yesterdayNet - avg7)/avg7 : 0
        let deltaPct = avg7 > 0 ? (yesterdayNet - avg7) / avg7 : 0
        let sales = CommandSummary.Sales(
            yesterdayNet: yesterdayNet,
            orders: bundle.salesYesterday?.orders ?? 0,
            guests: bundle.salesYesterday?.guests ?? 0,
            avg7Net: avg7,
            avg7Orders: bundle.salesTrailing?.avgOrders ?? 0,
            deltaPct: deltaPct)

        // ── Inventory ────────────────────────────────────────────────
        let inventory = CommandSummary.Inventory(
            lowPar: bundle.lowParIngredients.count,
            parTotal: bundle.parTotal,
            openCounts: bundle.openCountsCount)

        // ── Labor ────────────────────────────────────────────────────
        // openBreaks = breaks.filter(b => !b.ended_at && !b.waived)
        let openBreaks = bundle.shiftBreaks.filter { ($0.endedAt ?? "").isEmpty && $0.waived == 0 }.count
        // certs: days = floor((exp - today)/86400000); <0 expired, <=30 soon.
        let (certExpired, certSoon) = classifyCerts(bundle.certRows, today: today)
        let labor = CommandSummary.Labor(
            openBreaks: openBreaks,
            certExpiring30d: certSoon,
            certExpired: certExpired,
            performanceReviewsToday: bundle.performanceReviewsToday,
            performanceReviewsTotal: bundle.performanceReviewsTotal)

        // ── Food safety ──────────────────────────────────────────────
        // temp_breaches = classifyReadings(temps, expectAllPoints:false).filter(status==red)
        let tempBreaches = TempLogCompute.redBreachCount(bundle.tempLogRows)
        // date marks: scanExpiringBatches(today)
        let (dmExpired, dmDue) = DateMarkCompute.classify(bundle.dateMarkRows, today: today)
        // probes: classifyProbes(now = today T00:00:00Z)
        let (probesOverdue, probesFailed, probesDueSoon) =
            ProbeCompute.classify(bundle.calibrationRows, today: today)
        // cleaning: Number(overdue)||0, Number(due_today)||0
        let cleaningOverdue = bundle.cleaningCounts?.overdue ?? 0
        let cleaningDueToday = bundle.cleaningCounts?.dueToday ?? 0
        let foodSafety = CommandSummary.FoodSafety(
            tempBreaches: tempBreaches,
            tempReadings: bundle.tempLogRows.count,
            dateMarksExpired: dmExpired,
            dateMarksDueToday: dmDue,
            cleaningOverdue: cleaningOverdue,
            cleaningDueToday: cleaningDueToday,
            probesOverdue: probesOverdue,
            probesFailed: probesFailed,
            probesDueSoon: probesDueSoon,
            coolingOverdue: coolingOverdueCount)

        // ── Reservations ─────────────────────────────────────────────
        var booked = 0, seated = 0, completed = 0, noShow = 0, cancelled = 0
        for r in bundle.reservationRows {
            switch r.status {
            case "booked": booked = r.c
            case "seated": seated = r.c
            case "completed": completed = r.c
            case "no_show": noShow = r.c
            case "cancelled": cancelled = r.c
            default: break // unknown statuses ignored (matches hasOwnProperty guard)
            }
        }
        // total excludes cancelled (web: booked + seated + completed + no_show)
        let reservations = CommandSummary.Reservations(
            booked: booked, seated: seated, completed: completed,
            noShow: noShow, cancelled: cancelled,
            total: booked + seated + completed + noShow)

        // ── Prep ─────────────────────────────────────────────────────
        var todo = 0, inProgress = 0, done = 0, skipped = 0, rush = 0
        for r in bundle.prepTaskRows {
            switch r.status {
            case "todo": todo += 1
            case "in_progress": inProgress += 1
            case "done": done += 1
            case "skipped": skipped += 1
            default: break
            }
            if (r.priority == 1 || r.priority == 2)
                && (r.status == "todo" || r.status == "in_progress") {
                rush += 1
            }
        }
        let prep = CommandSummary.Prep(
            todo: todo, inProgress: inProgress, done: done, skipped: skipped, rush: rush)

        // ── Dining tables ────────────────────────────────────────────
        var open = 0, tSeated = 0, dirty = 0, closed = 0, seatsTotal = 0, seatsSeated = 0
        for r in bundle.diningTableRows {
            switch r.status {
            case "open": open += 1
            case "seated": tSeated += 1
            case "dirty": dirty += 1
            case "closed": closed += 1
            default: break
            }
            seatsTotal += r.capacity
            if r.status == "seated" { seatsSeated += r.capacity }
        }
        let diningTables = CommandSummary.DiningTables(
            open: open, seated: tSeated, dirty: dirty, closed: closed,
            total: bundle.diningTableRows.count,
            seatsTotal: seatsTotal, seatsSeated: seatsSeated)

        return CommandSummary(
            shiftDate: today,
            yesterday: yesterday,
            locationId: locationId,
            sales: sales,
            eightySix: bundle.eightySixCount,
            inventory: inventory,
            labor: labor,
            foodSafety: foodSafety,
            preshiftNotes: bundle.preshiftNoteCount,
            eventsToday: bundle.eventsCount,
            eventsGuests: bundle.eventsGuests,
            reservations: reservations,
            prep: prep,
            priceMoves: CommandSummary.Moves(
                total: priceMoves.total, up: priceMoves.up, down: priceMoves.down),
            marginMoves: CommandSummary.Moves(
                total: marginMoves.total, up: marginMoves.up, down: marginMoves.down),
            diningTables: diningTables,
            waste: CommandSummary.Waste(today: bundle.wasteTodayCount, last7d: bundle.waste7dCount))
    }

    /// Cert classification — mirrors the inline loop in summarize().
    /// `now = today T00:00:00` (local); days = floor((exp - now)/86400000).
    private static func classifyCerts(_ certs: [CmdCertRow], today: String) -> (expired: Int, soon: Int) {
        guard let now = midnightLocal(today) else { return (0, 0) }
        var expired = 0, soon = 0
        for c in certs {
            guard let exp = midnightLocal(c.expiresOn) else { continue }
            let days = Int(floor((exp.timeIntervalSince1970 - now.timeIntervalSince1970) / 86400.0))
            if days < 0 { expired += 1 }
            else if days <= 30 { soon += 1 }
        }
        return (expired, soon)
    }

    /// `new Date(s + 'T00:00:00')` — local-midnight parse (no Z), matching the
    /// web's cert math which uses a local Date. Cert deltas are whole-day
    /// differences so the timezone offset cancels.
    private static let localCalDay: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone.current
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    private static func midnightLocal(_ ymd: String) -> Date? { localCalDay.date(from: ymd) }

    // MARK: alertsFor

    public static func alertsFor(_ s: CommandSummary) -> [CommandAlert] {
        var out: [CommandAlert] = []
        func push(_ a: CommandAlert) { if a.count > 0 { out.append(a) } }
        func plural(_ n: Int) -> String { n == 1 ? "" : "s" }

        // ── Red ──────────────────────────────────────────────────────
        push(CommandAlert(severity: .red, source: "temp-breaches",
            message: "\(s.foodSafety.tempBreaches) temp reading\(plural(s.foodSafety.tempBreaches)) out of range",
            count: s.foodSafety.tempBreaches))
        push(CommandAlert(severity: .red, source: "date-marks-expired",
            message: "\(s.foodSafety.dateMarksExpired) expired date mark\(plural(s.foodSafety.dateMarksExpired)) — toss now",
            count: s.foodSafety.dateMarksExpired))
        push(CommandAlert(severity: .red, source: "cleaning-overdue",
            message: "\(s.foodSafety.cleaningOverdue) cleaning task\(plural(s.foodSafety.cleaningOverdue)) overdue",
            count: s.foodSafety.cleaningOverdue))
        push(CommandAlert(severity: .red, source: "probes-failed",
            message: "\(s.foodSafety.probesFailed) probe\(plural(s.foodSafety.probesFailed)) flagged as unreliable — recalibrate",
            count: s.foodSafety.probesFailed))
        push(CommandAlert(severity: .red, source: "probes-overdue",
            message: "\(s.foodSafety.probesOverdue) probe\(plural(s.foodSafety.probesOverdue)) past calibration window",
            count: s.foodSafety.probesOverdue))
        push(CommandAlert(severity: .red, source: "cert-expired",
            message: "\(s.labor.certExpired) expired cert\(plural(s.labor.certExpired))",
            count: s.labor.certExpired))
        push(CommandAlert(severity: .red, source: "eighty-six",
            message: "\(s.eightySix) item\(plural(s.eightySix)) 86’d",
            count: s.eightySix))
        push(CommandAlert(severity: .red, source: "cooling-overdue",
            message: "\(s.foodSafety.coolingOverdue) cooling batch\(s.foodSafety.coolingOverdue == 1 ? "" : "es") overdue",
            count: s.foodSafety.coolingOverdue))
        if s.reservations.noShow >= redNoShowThreshold {
            out.append(CommandAlert(severity: .red, source: "reservation-no-shows",
                message: "\(s.reservations.noShow) reservation no-show\(plural(s.reservations.noShow))",
                count: s.reservations.noShow))
        }

        // ── Amber ────────────────────────────────────────────────────
        if s.sales.avg7Net > 0 && s.sales.deltaPct < amberSalesDropPct {
            out.append(CommandAlert(severity: .amber, source: "sales-down",
                message: "Sales \(formatSignedPct(s.sales.deltaPct))% vs 7-day avg",
                count: 1))
        }
        push(CommandAlert(severity: .amber, source: "date-marks-due-today",
            message: "\(s.foodSafety.dateMarksDueToday) date mark\(plural(s.foodSafety.dateMarksDueToday)) due today",
            count: s.foodSafety.dateMarksDueToday))
        push(CommandAlert(severity: .amber, source: "cleaning-due-today",
            message: "\(s.foodSafety.cleaningDueToday) cleaning task\(plural(s.foodSafety.cleaningDueToday)) due today",
            count: s.foodSafety.cleaningDueToday))
        push(CommandAlert(severity: .amber, source: "probes-due-soon",
            message: "\(s.foodSafety.probesDueSoon) probe\(plural(s.foodSafety.probesDueSoon)) due for calibration in 7 days",
            count: s.foodSafety.probesDueSoon))
        push(CommandAlert(severity: .amber, source: "inventory-low-par",
            message: "\(s.inventory.lowPar) item\(plural(s.inventory.lowPar)) below par",
            count: s.inventory.lowPar))
        push(CommandAlert(severity: .amber, source: "inventory-open-counts",
            message: "\(s.inventory.openCounts) open inventory count\(plural(s.inventory.openCounts))",
            count: s.inventory.openCounts))
        push(CommandAlert(severity: .amber, source: "open-breaks",
            message: "\(s.labor.openBreaks) open break\(plural(s.labor.openBreaks))",
            count: s.labor.openBreaks))
        push(CommandAlert(severity: .amber, source: "cert-expiring-30d",
            message: "\(s.labor.certExpiring30d) cert\(plural(s.labor.certExpiring30d)) expiring in 30d",
            count: s.labor.certExpiring30d))
        if s.labor.performanceReviewsToday == 0 {
            out.append(CommandAlert(severity: .amber, source: "performance-reviews-none",
                message: "No staff reviews logged today", count: 1))
        }
        push(CommandAlert(severity: .amber, source: "prep-rush",
            message: "\(s.prep.rush) rush prep task\(plural(s.prep.rush))",
            count: s.prep.rush))
        push(CommandAlert(severity: .amber, source: "reservations-to-seat",
            message: "\(s.reservations.booked) reservation\(plural(s.reservations.booked)) still to seat",
            count: s.reservations.booked))
        push(CommandAlert(severity: .amber, source: "tables-dirty",
            message: "\(s.diningTables.dirty) dirty table\(plural(s.diningTables.dirty))",
            count: s.diningTables.dirty))
        push(CommandAlert(severity: .amber, source: "price-moves",
            message: "\(s.priceMoves.total) vendor price move\(plural(s.priceMoves.total)) this week",
            count: s.priceMoves.total))
        push(CommandAlert(severity: .amber, source: "margin-moves",
            message: "\(s.marginMoves.total) dish margin move\(plural(s.marginMoves.total)) this week",
            count: s.marginMoves.total))

        return out
    }

    /// `(deltaPct * 100).toFixed(0)` — round half away from zero, no '+' sign
    /// (JS toFixed never prefixes '+'; a negative keeps its '-').
    private static func formatSignedPct(_ deltaPct: Double) -> String {
        let v = deltaPct * 100
        let rounded = (v < 0 ? -1.0 : 1.0) * (abs(v)).rounded()
        return String(Int(rounded))
    }
}
