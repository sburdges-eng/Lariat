import Foundation

// Tonight · Live pure rules — value-parity port of `lib/showsTonight.ts`.
// No I/O. The tonight repository composes these around the day's show row.

/// Aggregated tonight box-office rollup — mirrors `BoxOfficeSummary` in
/// `lib/showsTonight.ts`. Values are Double DOLLARS rounded to cents
/// (`roundCents`, parity). NOTE (web quirk, ported faithfully): revenue is
/// `qty × face + fees` — fees counted once per line, not ×qty.
public struct TonightBoxOfficeSummary: Sendable, Equatable {
    public let totalQty: Int
    public let scannedQty: Int
    public let totalFaceValue: Double
    public let totalFees: Double
    public let totalRevenue: Double     // face + fees
    public let bySource: [BoxOfficeSource: Bucket]

    public struct Bucket: Sendable, Equatable {
        public var qty: Int
        public var revenue: Double
        public init(qty: Int, revenue: Double) {
            self.qty = qty
            self.revenue = revenue
        }
    }

    public init(
        totalQty: Int, scannedQty: Int, totalFaceValue: Double,
        totalFees: Double, totalRevenue: Double,
        bySource: [BoxOfficeSource: Bucket]
    ) {
        self.totalQty = totalQty
        self.scannedQty = scannedQty
        self.totalFaceValue = totalFaceValue
        self.totalFees = totalFees
        self.totalRevenue = totalRevenue
        self.bySource = bySource
    }
}

/// Attendance status thresholds against scanned percent — mirrors
/// `AttendanceStatus` in `lib/showsTonight.ts`.
public enum AttendanceStatus: String, Sendable, Equatable {
    case unset, under, near, at, over
}

public struct Attendance: Sendable, Equatable {
    public let scannedQty: Int
    public let soldQty: Int
    public let capacity: Int?
    public let scannedPct: Double?   // 0-100+, nil when capacity is unset
    public let soldPct: Double?
    public let status: AttendanceStatus

    public init(
        scannedQty: Int, soldQty: Int, capacity: Int?,
        scannedPct: Double?, soldPct: Double?, status: AttendanceStatus
    ) {
        self.scannedQty = scannedQty
        self.soldQty = soldQty
        self.capacity = capacity
        self.scannedPct = scannedPct
        self.soldPct = soldPct
        self.status = status
    }
}

/// One normalized run-of-show entry from `stage_setups.run_of_show_json` —
/// mirrors `RunOfShowEntry` in `lib/showsTonight.ts` ({time, label}).
public struct TonightRunEntry: Sendable, Equatable {
    public let time: String?
    public let label: String

    public init(time: String?, label: String) {
        self.time = time
        self.label = label
    }
}

public enum ShowsTonightCompute {
    // ── Day resolution ────────────────────────────────────────────────

    /// Pick tonight's show from a location-scoped list (exact date match;
    /// no sort assumed). `today` is ISO YYYY-MM-DD.
    public static func resolveTonightShow(_ rows: [ShowRow]?, today: String) -> ShowRow? {
        guard let rows, !rows.isEmpty else { return nil }
        return rows.first { $0.showDate == today }
    }

    /// The show just before tonight's (strict less-than). With no
    /// `tonightDate`, returns the most recent past show in the list.
    public static func findPreviousShow(_ rows: [ShowRow]?, tonightDate: String?) -> ShowRow? {
        guard let rows, !rows.isEmpty else { return nil }
        let cutoff = tonightDate ?? "9999-12-31"
        var best: ShowRow?
        for r in rows {
            if r.showDate >= cutoff { continue }
            if best == nil || r.showDate > best!.showDate { best = r }
        }
        return best
    }

    // ── Box-office rollup ─────────────────────────────────────────────

    /// Aggregate per-source totals + scanned-in count. Comp + guestlist rows
    /// contribute qty but revenue trusts the row. Unknown sources are skipped
    /// silently (schema CHECK enforces upstream). `scannedQty` counts only
    /// lines with a non-nil `scanned_at` — the door truth.
    public static func summarizeBoxOffice(_ lines: [BoxOfficeLineRow]?) -> TonightBoxOfficeSummary {
        var bySource: [BoxOfficeSource: TonightBoxOfficeSummary.Bucket] =
            Dictionary(uniqueKeysWithValues: BoxOfficeSource.allCases.map {
                ($0, TonightBoxOfficeSummary.Bucket(qty: 0, revenue: 0))
            })
        var totalQty = 0
        var scannedQty = 0
        var totalFace = 0.0
        var totalFees = 0.0

        for l in lines ?? [] {
            guard let src = BoxOfficeSource(rawValue: l.source) else { continue }
            let qty = l.qty
            let face = l.facePrice ?? 0
            let fees = l.fees ?? 0
            let revenue = Double(qty) * face + fees
            bySource[src]!.qty += qty
            bySource[src]!.revenue += revenue
            totalQty += qty
            totalFace += Double(qty) * face
            totalFees += fees
            if l.scannedAt != nil { scannedQty += qty }
        }

        for k in bySource.keys {
            bySource[k]!.revenue = roundCents(bySource[k]!.revenue)
        }
        return TonightBoxOfficeSummary(
            totalQty: totalQty,
            scannedQty: scannedQty,
            totalFaceValue: roundCents(totalFace),
            totalFees: roundCents(totalFees),
            totalRevenue: roundCents(totalFace + totalFees),
            bySource: bySource
        )
    }

    /// Web `roundCents` — `Math.round(n * 100) / 100` (JS round half-up).
    public static func roundCents(_ n: Double) -> Double {
        jsRound(n * 100) / 100
    }

    // ── Attendance ────────────────────────────────────────────────────

    /// Status thresholds against scanned percent:
    ///   under < 50 · near 50–79 · at 80–100 · over > 100.
    /// `capacity` nil / non-finite / ≤0 → status `unset`, nil percents.
    public static func computeAttendance(
        scannedQty: Int?,
        soldQty: Int?,
        capacity: Double?
    ) -> Attendance {
        let scanned = max(0, scannedQty ?? 0)
        let sold = max(0, soldQty ?? 0)
        let cap: Int?
        if let c = capacity, c.isFinite, c > 0 {
            cap = jsFloorClamped(c)
        } else {
            cap = nil
        }

        guard let cap else {
            return Attendance(
                scannedQty: scanned, soldQty: sold, capacity: nil,
                scannedPct: nil, soldPct: nil, status: .unset
            )
        }

        // 0.1% precision — `Math.round(x * 1000) / 10`.
        let scannedPct = jsRound(Double(scanned) / Double(cap) * 1000) / 10
        let soldPct = jsRound(Double(sold) / Double(cap) * 1000) / 10

        let status: AttendanceStatus
        if scannedPct > 100 { status = .over }
        else if scannedPct >= 80 { status = .at }
        else if scannedPct >= 50 { status = .near }
        else { status = .under }

        return Attendance(
            scannedQty: scanned, soldQty: sold, capacity: cap,
            scannedPct: scannedPct, soldPct: soldPct, status: status
        )
    }

    /// Effective capacity: per-show override in `status_json.capacity` beats
    /// the venue default. Non-numeric / 0 / negative overrides fall through.
    /// Nil when neither is set.
    public static func pickEffectiveCapacity(
        _ status: [String: ShowStatusValue]?,
        venueCapacity: Double?
    ) -> Int? {
        if let fromStatus = status?["capacity"] {
            let overrideNum = fromStatus.jsNumber
            if overrideNum.isFinite && overrideNum > 0 {
                return jsFloorClamped(overrideNum)
            }
        }
        if let vc = venueCapacity, vc.isFinite, vc > 0 {
            return jsFloorClamped(vc)
        }
        return nil
    }

    /// `Math.floor` for Int consumers without the Double→Int trap: ingest can
    /// write arbitrary JSON numbers (web floors 1e19 gracefully; a raw `Int()`
    /// conversion crashes ≥ 2^63). Clamps to Int bounds instead.
    public static func jsFloorClamped(_ n: Double) -> Int {
        let f = n.rounded(.down)
        if f >= Double(Int.max) { return Int.max }
        if f < Double(Int.min) { return Int.min }
        return Int(f)
    }

    // ── status_json helpers ───────────────────────────────────────────

    /// Defensive parse: `{}` on nil/empty/malformed/non-object JSON.
    public static func parseStatusJson(_ raw: String?) -> [String: ShowStatusValue] {
        guard let raw, !raw.isEmpty, let data = raw.data(using: .utf8) else { return [:] }
        guard let parsed = try? JSONSerialization.jsonObject(with: data),
              let dict = parsed as? [String: Any] else { return [:] }
        return dict.mapValues { ShowStatusValue.from($0) }
    }

    public enum ShowTimeKey: String, Sendable {
        case doors, set1, set2, curfew
        case doorTime = "door_time"
    }

    /// Best-effort "doors open" lookup — `doors` falls back to `door_time`.
    public static func pickShowTime(
        _ status: [String: ShowStatusValue],
        key: ShowTimeKey
    ) -> String? {
        if case .string(let v)? = status[key.rawValue] {
            let t = v.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { return t }
        }
        if key == .doors { return pickShowTime(status, key: .doorTime) }
        return nil
    }

    // ── Run of show ───────────────────────────────────────────────────

    /// Accepts an array of `{time,label}` / `{at,text}` objects or flat
    /// strings; anything else is skipped. `[]` on malformed/non-array JSON.
    public static func parseRunOfShow(_ raw: String?) -> [TonightRunEntry] {
        guard let raw, !raw.isEmpty, let data = raw.data(using: .utf8) else { return [] }
        guard let parsed = try? JSONSerialization.jsonObject(with: data),
              let arr = parsed as? [Any] else { return [] }
        var out: [TonightRunEntry] = []
        for e in arr {
            if let s = e as? String {
                let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
                if !t.isEmpty { out.append(TonightRunEntry(time: nil, label: t)) }
            } else if let obj = e as? [String: Any] {
                let label = (obj["label"] as? String) ?? (obj["text"] as? String)
                // Web: `if (!label) continue` — empty string is falsy too.
                guard let label, !label.isEmpty else { continue }
                let time = (obj["time"] as? String) ?? (obj["at"] as? String)
                out.append(TonightRunEntry(time: time, label: label))
            }
        }
        return out
    }

    /// JS `Math.round` — half toward +infinity.
    static func jsRound(_ x: Double) -> Double {
        (x + 0.5).rounded(.down)
    }
}
