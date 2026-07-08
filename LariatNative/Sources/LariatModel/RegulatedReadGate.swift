import Foundation

/// Read-side analog of `ManagementWrite`. The web `requirePin` GET protects
/// manager-tier reads (HR reviews, sick-worker PHI history, guest waitlist,
/// costing masters). The native port originally gated only WRITES, so several
/// boards polled `list()`/`load()` regardless of PIN state — a read leak the
/// Phase C1 verify-41 sweep found on performance-reviews, sick-worker,
/// host-waitlist, and the costing/menu boards.
///
/// This centralizes the gate decision that `MorningViewModel.evaluateGate`
/// pioneered so every leaking board shares one tested rule.
public enum RegulatedReadGateState: Equatable, Sendable {
    /// The read may proceed (no PIN configured, or a valid session exists).
    case open
    /// A PIN is configured, none is active, but the surface can present the
    /// PIN sheet to unlock (a write DB is available).
    case locked
    /// A PIN is required but cannot be entered here (no write DB); carries the
    /// operator-facing reason.
    case unavailable(String)
}

public struct RegulatedReadGate {
    public init() {}

    /// Decide whether a manager-tier read may fetch.
    /// - `gateConfigured`: is a manager PIN configured for this deployment
    ///   (`PinVerifier.gateConfigured`)?
    /// - `hasActiveUser`: is there a valid manager-PIN session?
    /// - `canUnlock`: can this surface present the PIN sheet (write DB present)?
    public static func evaluate(
        gateConfigured: Bool,
        hasActiveUser: Bool,
        canUnlock: Bool
    ) -> RegulatedReadGateState {
        if !gateConfigured { return .open }
        if hasActiveUser { return .open }
        return canUnlock
            ? .locked
            : .unavailable("Manager PIN required, but the write database is unavailable.")
    }

    /// Convenience for the common poll guard: may the board fetch right now?
    /// Only `.open` permits a read.
    public static func mayFetch(gateConfigured: Bool, hasActiveUser: Bool) -> Bool {
        evaluate(gateConfigured: gateConfigured, hasActiveUser: hasActiveUser, canUnlock: true) == .open
    }
}
