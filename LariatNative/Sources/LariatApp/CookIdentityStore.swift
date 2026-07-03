import Foundation

/// Persists cook attribution — parity with web `localStorage.lariat_cook`.
@Observable @MainActor
final class CookIdentityStore {
    static let shared = CookIdentityStore()
    static let storageKey = "lariat_cook"

    var cookId: String? {
        didSet { UserDefaults.standard.set(cookId, forKey: Self.storageKey) }
    }

    private init() {
        cookId = UserDefaults.standard.string(forKey: Self.storageKey)
    }

    func setCookId(_ id: String?) {
        let trimmed = id?.trimmingCharacters(in: .whitespacesAndNewlines)
        cookId = (trimmed?.isEmpty == false) ? trimmed : nil
    }

    // ── Interrupted-write retry (shared cook-picker pattern) ────────────
    //
    // When a regulated write aborts because `cookId` is nil, the VIEW stashes
    // its full submit closure here (including any clear-fields-on-success
    // step) BEFORE `CookIdentityPicker` presents. The picker resolves the
    // stash exactly once on dismissal:
    //   • cook picked  → the pending write auto-retries;
    //   • Cancel/swipe → the stash is dropped and `onCancel` fires so the
    //     board can say the change was not saved (typed fields stay put).
    // Only one picker can be on screen at a time, so a single slot suffices.

    /// The write that was interrupted by the picker, if any.
    private(set) var pendingWrite: (@MainActor () async -> Void)?

    var hasPendingWrite: Bool { pendingWrite != nil }

    /// Stash the interrupted submit for auto-retry after a cook is picked.
    func stashPendingWrite(_ action: @escaping @MainActor () async -> Void) {
        pendingWrite = action
    }

    /// Consume the stash (returns it and clears the slot).
    func takePendingWrite() -> (@MainActor () async -> Void)? {
        defer { pendingWrite = nil }
        return pendingWrite
    }
}
