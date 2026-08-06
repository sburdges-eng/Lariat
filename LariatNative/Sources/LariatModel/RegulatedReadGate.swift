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
    /// The read may proceed — a valid manager session exists.
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

    /// Shown when the deployment has no manager PIN at all. It must be
    /// actionable: there is nothing to type here, so the operator is sent to
    /// the one board that can create the first PIN without an unlock
    /// (`ManagerPinRepository.createFirst`).
    public static let noPinConfiguredReason =
        "No manager PIN is set. Add one on the Manager → PINs board to open this."

    /// Decide whether a manager-tier read may fetch.
    /// - `gateConfigured`: is a manager PIN configured for this deployment
    ///   (`PinVerifier.gateConfigured`)?
    /// - `hasActiveUser`: is there a valid manager-PIN session?
    /// - `canUnlock`: can this surface present the PIN sheet (write DB present)?
    ///
    /// An unconfigured deployment does NOT open. It used to, matching a web
    /// `pinRequiredForPic()` that returned `pinConfigured()`; web made that
    /// unconditionally `true` on 2026-07-28 because failing open before setup
    /// is finished exposes PHI, pay data, and staff records on exactly the
    /// install least likely to be on a trusted network. This mirrors it.
    public static func evaluate(
        gateConfigured: Bool,
        hasActiveUser: Bool,
        canUnlock: Bool
    ) -> RegulatedReadGateState {
        if hasActiveUser { return .open }
        // No PIN exists to unlock with, so `canUnlock` is irrelevant — offering
        // a PIN sheet here would be a prompt nothing can satisfy.
        if !gateConfigured { return .unavailable(noPinConfiguredReason) }
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
