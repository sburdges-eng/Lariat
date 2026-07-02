import Foundation

// Show-marketing status rules — value-parity port of `lib/showStatus.ts`.
//
// Single source of truth for: how a free-text status cell from Lauren's xlsx
// renders as a color/label, and how a row's full status_json maps to exactly
// one of the six pipeline stages.
//
// Design contract (Approach 1, Q4 in the web spec): unknown values render
// green with their literal label (never red), so novel vocabulary doesn't
// break the UI. Lauren is SoT. No I/O. Pure.

public enum ShowStatusColor: String, Sendable, Equatable {
    case green, amber, red, neutral
}

public struct ShowStatusBadge: Sendable, Equatable {
    public let color: ShowStatusColor
    public let label: String

    public init(color: ShowStatusColor, label: String) {
        self.color = color
        self.label = label
    }
}

/// The six pipeline stages, in web `KNOWN_STAGES` order.
public enum PipelineStage: String, CaseIterable, Sendable, Codable {
    case inquiry = "Inquiry"
    case hold = "Hold"
    case offerOut = "Offer Out"
    case confirmed = "Confirmed"
    case onSale = "On Sale"
    case settled = "Settled"
}

public enum ShowStatusCompute {
    static let amberTokens: Set<String> = ["pending", "w", "waiting", "tentative"]
    static let greenTokens: Set<String> = ["y", "yes", "accepted", "done", "sent"]
    static let redTokens: Set<String> = ["n", "no"]
    static let neutralTokens: Set<String> = ["", "-", "–", "—", "na", "n/a"]

    /// Map a single status cell to a color/label badge. `column` is reserved
    /// for future column-specific rules (unused — parity with the web arg).
    public static func statusColor(_ value: ShowStatusValue?, _ column: String = "") -> ShowStatusBadge {
        let raw: String
        if let value, value != .null {
            raw = value.jsString.trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            raw = ""
        }
        let lower = raw.lowercased()

        if neutralTokens.contains(lower) { return ShowStatusBadge(color: .neutral, label: "—") }
        if redTokens.contains(lower) { return ShowStatusBadge(color: .red, label: lower) }
        if amberTokens.contains(lower) { return ShowStatusBadge(color: .amber, label: lower) }
        if greenTokens.contains(lower) { return ShowStatusBadge(color: .green, label: lower) }

        // Numeric strings ("6.0", "0", "12") → count semantics for posts/door_tix.
        let num = ShowStatusValue.jsNumber(from: raw)
        if num.isFinite {
            if num <= 0 { return ShowStatusBadge(color: .neutral, label: "—") }
            return ShowStatusBadge(
                color: .green,
                label: ShowStatusValue.jsNumberString(jsRound(num))
            )
        }

        // Anything else: green-with-detail. Approach 1: never red on novelty.
        return ShowStatusBadge(color: .green, label: raw)
    }

    /// String convenience — mirrors calling the web fn with a raw xlsx string.
    public static func statusColor(_ value: String?, _ column: String = "") -> ShowStatusBadge {
        statusColor(value.map { ShowStatusValue.string($0) }, column)
    }

    static func isGreenish(_ v: ShowStatusValue?) -> Bool {
        statusColor(v).color == .green
    }

    /// Map a row's full status_json to one pipeline stage. Exhaustive; novel
    /// cell values never demote the row below the stage it would have reached
    /// with `green`. Rule (top-down — first match wins):
    ///   1. dice_email greenish AND show is past → Settled
    ///   2. create_dice_tickets greenish → On Sale
    ///   3. announce_date greenish AND ≥2 of {meta_ads, fb_event, assets, posts} greenish → Confirmed
    ///   4. announce_date greenish AND ≥1 marketing field greenish → Offer Out
    ///   5. announce_date greenish (alone) → Hold
    ///   6. otherwise → Inquiry
    /// `showIsPast` is the caller's clock check (`show_date < today`).
    public static func pipelineStage(
        _ row: [String: ShowStatusValue]?,
        showIsPast: Bool = false
    ) -> PipelineStage {
        let r = row ?? [:]
        if showIsPast && isGreenish(r["dice_email"]) { return .settled }
        if isGreenish(r["create_dice_tickets"]) { return .onSale }
        let announced = isGreenish(r["announce_date"])
        if announced {
            let marketingHits = ["meta_ads", "fb_event", "assets", "posts"]
                .filter { isGreenish(r[$0]) }
                .count
            if marketingHits >= 2 { return .confirmed }
            if marketingHits >= 1 { return .offerOut }
            return .hold
        }
        return .inquiry
    }

    /// JS `Math.round` — half toward +infinity.
    static func jsRound(_ x: Double) -> Double {
        (x + 0.5).rounded(.down)
    }
}
