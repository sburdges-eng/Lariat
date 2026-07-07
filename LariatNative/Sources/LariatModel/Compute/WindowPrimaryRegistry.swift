import Foundation

/// H6d — pure ordered registry of open windows, deciding which is "primary": the
/// earliest-registered window still open. Used by the App-layer `WindowRouter` to
/// route app-level navigation (H6a notification tap, H6c menu-bar "Open Command")
/// to a stable window as windows open and close. Windows are identified by opaque
/// Int tokens so this stays free of AppKit/SwiftUI scene types (and unit-testable).
public struct WindowPrimaryRegistry: Equatable {
    /// Registration order of currently-open window tokens; `first` is primary.
    private var order: [Int] = []

    public init() {}

    /// The earliest-registered window still open, or nil when none are.
    public var primary: Int? { order.first }

    public var isEmpty: Bool { order.isEmpty }

    /// Register a window. Idempotent: a token already present keeps its original
    /// position (a re-appearing window must not jump the primary ordering).
    public mutating func register(_ token: Int) {
        guard !order.contains(token) else { return }
        order.append(token)
    }

    /// Remove a closed window. If it was primary, the next-earliest becomes primary.
    public mutating func deregister(_ token: Int) {
        order.removeAll { $0 == token }
    }
}
