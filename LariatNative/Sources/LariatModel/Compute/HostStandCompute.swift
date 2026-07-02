import Foundation

/// Host Stand — pure rule helpers for the FOH waitlist surface.
/// 1:1 port of `lib/hostStand.ts` (the no-I/O contract layer both the web
/// render path and the LaRi prediction builder consume).
public enum HostStandCompute {
    public static let maxPartyNameLength = 80
    public static let maxPhoneLength = 32
    public static let maxNotesLength = 500
    public static let maxPartySize = 200

    /// Defensively coerce a host-supplied party payload. Returns nil when
    /// required fields are missing/malformed (caller maps nil → 400 parity).
    /// Truncates over-long strings rather than rejecting them — host stand
    /// is a fast-typing surface.
    public static func sanitizeWaitlistInput(
        partyName: String?,
        partySize: Double?,
        phone: String? = nil,
        notes: String? = nil
    ) -> SanitizedWaitlistInput? {
        let nameRaw = (partyName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !nameRaw.isEmpty else { return nil }
        let name = String(nameRaw.prefix(maxPartyNameLength))

        guard let sizeNum = partySize, sizeNum.isFinite, sizeNum > 0 else { return nil }
        let size = Swift.min(Int(sizeNum.rounded(.down)), maxPartySize)

        var cleanPhone: String? = nil
        if let phone {
            let p = phone.trimmingCharacters(in: .whitespacesAndNewlines)
            cleanPhone = p.isEmpty ? nil : String(p.prefix(maxPhoneLength))
        }

        var cleanNotes: String? = nil
        if let notes {
            let n = notes.trimmingCharacters(in: .whitespacesAndNewlines)
            cleanNotes = n.isEmpty ? nil : String(n.prefix(maxNotesLength))
        }

        return SanitizedWaitlistInput(
            partyName: name, partySize: size, phone: cleanPhone, notes: cleanNotes
        )
    }

    /// Validate a requested status transition. waiting → seated|left is
    /// legal; everything else (including unknown statuses) is false.
    public static func isValidStatusTransition(_ current: String, _ next: String) -> Bool {
        switch current {
        case "waiting": return next == "seated" || next == "left"
        default: return false
        }
    }

    /// Roll up a waitlist for the day. `nowIso` lets tests time-shift —
    /// production callers pass the current ISO-8601 instant. Returns nils
    /// for derived stats when the underlying set is empty.
    public static func summarizeWaitlist(
        _ parties: [WaitlistPartyRow],
        nowIso: String
    ) -> WaitlistSummary {
        let dayPrefix = String(nowIso.prefix(10)) // YYYY-MM-DD

        var waiting = 0
        var seatedToday = 0
        var leftToday = 0
        var waitSum = 0
        var waitCount = 0
        var longest = 0
        var longestId: Int64? = nil

        for p in parties {
            switch p.status {
            case "waiting":
                waiting += 1
                let wait = minutesBetween(p.joinedAt, nowIso)
                if wait > longest {
                    longest = wait
                    longestId = p.id
                }
            case "seated":
                if let seatedAt = p.seatedAt, seatedAt.hasPrefix(dayPrefix) {
                    seatedToday += 1
                    let wait = minutesBetween(p.joinedAt, seatedAt)
                    if wait >= 0 {
                        waitSum += wait
                        waitCount += 1
                    }
                }
            case "left":
                if let leftAt = p.leftAt, leftAt.hasPrefix(dayPrefix) {
                    leftToday += 1
                }
            default:
                break
            }
        }

        return WaitlistSummary(
            total: parties.count,
            waiting: waiting,
            seatedToday: seatedToday,
            leftToday: leftToday,
            avgWaitMinutes: waitCount > 0
                ? Int((Double(waitSum) / Double(waitCount)).rounded())
                : nil,
            longestWaitMinutes: waiting > 0 ? longest : nil,
            longestWaitPartyId: longestId
        )
    }

    /// Minutes between two ISO timestamps. Floors to whole minutes. Returns
    /// 0 (not negative) when end < start, and 0 on unparseable input.
    public static func minutesBetween(_ startIso: String?, _ endIso: String?) -> Int {
        guard let a = parseIso(startIso), let b = parseIso(endIso) else { return 0 }
        let ms = b.timeIntervalSince(a)
        return Swift.max(0, Int((ms / 60.0).rounded(.down)))
    }

    /// `Date.parse` analog for the timestamp shapes this surface stores:
    /// ISO-8601 with/without fractional seconds; date-only strings parse as
    /// UTC midnight (JS parity).
    static func parseIso(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        let isoFrac = ISO8601DateFormatter()
        isoFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = isoFrac.date(from: raw) { return d }
        let iso = ISO8601DateFormatter()
        if let d = iso.date(from: raw) { return d }
        // SQLite datetime('now') shape: "yyyy-MM-dd HH:mm:ss" (UTC).
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        if let d = f.date(from: raw) { return d }
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: raw)
    }
}

/// Clean add-party payload (SanitizedWaitlistInput in lib/hostStand.ts).
public struct SanitizedWaitlistInput: Sendable, Equatable {
    public let partyName: String
    public let partySize: Int
    public let phone: String?
    public let notes: String?

    public init(partyName: String, partySize: Int, phone: String?, notes: String?) {
        self.partyName = partyName
        self.partySize = partySize
        self.phone = phone
        self.notes = notes
    }
}

/// Day rollup (WaitlistSummary in lib/hostStand.ts).
public struct WaitlistSummary: Sendable, Equatable {
    public let total: Int
    public let waiting: Int
    public let seatedToday: Int
    public let leftToday: Int
    public let avgWaitMinutes: Int?
    public let longestWaitMinutes: Int?
    public let longestWaitPartyId: Int64?

    public init(
        total: Int,
        waiting: Int,
        seatedToday: Int,
        leftToday: Int,
        avgWaitMinutes: Int?,
        longestWaitMinutes: Int?,
        longestWaitPartyId: Int64?
    ) {
        self.total = total
        self.waiting = waiting
        self.seatedToday = seatedToday
        self.leftToday = leftToday
        self.avgWaitMinutes = avgWaitMinutes
        self.longestWaitMinutes = longestWaitMinutes
        self.longestWaitPartyId = longestWaitPartyId
    }
}
