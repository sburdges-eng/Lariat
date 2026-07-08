#if os(macOS)
import AppKit
import Observation
import LariatModel

/// H6d — app-level navigation target for entry points that live outside any one
/// window: the H6a notification tap (wired via `AlertMonitor`) and the H6c
/// menu-bar "Open Command Board" / alert-row tap. Both must resolve to a stable,
/// still-open window; H6d routes them to the **primary** window (earliest-opened
/// still open — see `WindowPrimaryRegistry`). No-op when no window is open.
///
/// Each `RootWindowView` registers on appear and deregisters on disappear, and
/// attaches its `NSWindow` (resolved async via `WindowAccessor`) so the router
/// can bring the right window forward, not just activate the app.
@Observable @MainActor
final class WindowRouter {
    static let shared = WindowRouter()

    private var registry = WindowPrimaryRegistry()
    private var navigators: [Int: (String) -> Void] = [:]
    private var windows: [Int: NSWindow] = [:]
    private var nextToken = 0

    private init() {}

    /// Register a window's navigate closure; returns its token for later
    /// `attachWindow`/`deregister`. The first-registered window is primary.
    func register(navigate: @escaping (String) -> Void) -> Int {
        let token = nextToken
        nextToken += 1
        registry.register(token)
        navigators[token] = navigate
        return token
    }

    /// Attach (or update) the `NSWindow` for a token once `WindowAccessor`
    /// resolves it — used only to bring the primary window forward.
    func attachWindow(_ token: Int, _ window: NSWindow?) {
        windows[token] = window
    }

    func deregister(_ token: Int) {
        registry.deregister(token)
        navigators[token] = nil
        windows[token] = nil
    }

    /// Activate the app, bring the primary window forward, and navigate it.
    func navigate(_ id: String) {
        guard let token = registry.primary, let navigate = navigators[token] else { return }
        NSApp.activate()
        windows[token]?.makeKeyAndOrderFront(nil)
        navigate(id)
    }
}
#endif
