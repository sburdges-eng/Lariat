import Foundation

/// Show-marketing status rules — 1:1 port of `lib/showStatus.ts`.
///
/// Design contract (Approach 1 in the web spec): unknown values render
/// green with their literal label (never red), so novel vocabulary from
/// the booking sheet doesn't break the UI. No I/O. Pure.
public enum ShowPipelineCompute {
    /// The six pipeline stages, in order (KNOWN_STAGES).
    public static let knownStages: [String] = [
        "Inquiry", "Hold", "Offer Out", "Confirmed", "On Sale", "Settled",
    ]

    private static let amberTokens: Set<String> = ["pending", "w", "waiting", "tentative"]
    private static let greenTokens: Set<String> = ["y", "yes", "accepted", "done", "sent"]
    private static let redTokens: Set<String> = ["n", "no"]
    private static let neutralTokens: Set<String> = ["", "-", "–", "—", "na", "n/a"]

    /// Map a single status cell (raw xlsx string) to a color/label badge.
    /// nil behaves like the web's `value == null` → ''.
    public static func statusColor(_ value: String?) -> ShowStatusBadge {
        let raw = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = raw.lowercased()

        if neutralTokens.contains(lower) { return ShowStatusBadge(color: .neutral, label: "—") }
        if redTokens.contains(lower) { return ShowStatusBadge(color: .red, label: lower) }
        if amberTokens.contains(lower) { return ShowStatusBadge(color: .amber, label: lower) }
        if greenTokens.contains(lower) { return ShowStatusBadge(color: .green, label: lower) }

        // Numeric strings ("6.0", "0", "12") → count semantics for posts/door_tix.
        if let num = Double(raw), num.isFinite {
            if num <= 0 { return ShowStatusBadge(color: .neutral, label: "—") }
            return ShowStatusBadge(color: .green, label: jsRoundLabel(num))
        }

        // Anything else: green-with-detail. Approach 1: never red on novelty.
        return ShowStatusBadge(color: .green, label: raw)
    }

    /// Map a row's full status_json to one pipeline stage. Exhaustive —
    /// always one of `knownStages`. Rule ladder (first match wins):
    ///   1. dice_email greenish AND show is past → Settled
    ///   2. create_dice_tickets greenish → On Sale
    ///   3. announce_date greenish + ≥2 of {meta_ads, fb_event, assets, posts} → Confirmed
    ///   4. announce_date greenish + ≥1 marketing field → Offer Out
    ///   5. announce_date greenish alone → Hold
    ///   6. otherwise → Inquiry
    public static func pipelineStage(_ row: [String: String], showIsPast: Bool = false) -> String {
        if showIsPast && isGreenish(row["dice_email"]) { return "Settled" }
        if isGreenish(row["create_dice_tickets"]) { return "On Sale" }
        if isGreenish(row["announce_date"]) {
            let marketingHits = ["meta_ads", "fb_event", "assets", "posts"]
                .filter { isGreenish(row[$0]) }
                .count
            if marketingHits >= 2 { return "Confirmed" }
            if marketingHits >= 1 { return "Offer Out" }
            return "Hold"
        }
        return "Inquiry"
    }

    /// Parse a `shows.status_json` blob into the string map the rules
    /// consume. Scalar coercion mirrors the web path (`JSON.parse` then
    /// `String(value)` inside statusColor): numbers render JS-style
    /// (integral → no decimal point), booleans → "true"/"false",
    /// null → "" (statusColor's `value == null` branch).
    public static func parseStatusJson(_ raw: String?) -> [String: String] {
        guard let raw, !raw.isEmpty,
              let data = raw.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return [:]
        }
        var out: [String: String] = [:]
        for (key, value) in obj {
            switch value {
            case let s as String:
                out[key] = s
            case let n as NSNumber:
                // NSNumber bridges bools too — CFBoolean check keeps `true` ≠ `1`.
                // A `case as Bool` first would swallow JSON 0/1 and render
                // "false"/"true" where the web renders "0"/"1" (count semantics).
                if CFGetTypeID(n) == CFBooleanGetTypeID() {
                    out[key] = n.boolValue ? "true" : "false"
                } else {
                    let d = n.doubleValue
                    if d == d.rounded() && abs(d) < 1e15 {
                        out[key] = String(Int64(d))
                    } else {
                        out[key] = "\(d)"
                    }
                }
            case is NSNull:
                out[key] = ""
            default:
                continue // nested structures never occur in booking-sheet cells
            }
        }
        return out
    }

    static func isGreenish(_ value: String?) -> Bool {
        statusColor(value).color == .green
    }

    /// JS `String(Math.round(n))` without the Int64 trap: round half toward
    /// +infinity in Double space; integral magnitudes < 1e15 render digit-exact.
    /// (Values ≥ ~9.2e18 previously crashed on the Double→Int conversion.)
    private static func jsRoundLabel(_ n: Double) -> String {
        let r = (n + 0.5).rounded(.down)
        if abs(r) < 1e15 { return String(Int64(r)) }
        return "\(r)"
    }
}

// ShowStatusColor / ShowStatusBadge live in ShowStatusCompute.swift — the
// canonical showStatus.ts port (A6.4). Booking's pipeline reuses them.
