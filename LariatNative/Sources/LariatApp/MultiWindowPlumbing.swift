import SwiftUI
import LariatModel
#if canImport(AppKit)
import AppKit
#endif

// H6d — per-window active-board publication + focus plumbing. None of this is
// consumed until the shell integration (T3): boards publish their poller upward
// via a preference, each window root reads its own (drives that window's chip),
// and the app-level commands read the *key* window's values via focus.
//
// The preference/modifier are cross-platform (board views are), so `.tracksActiveBoard`
// compiles everywhere and is a harmless no-op on non-macOS (no multi-window there).
// Only `WindowAccessor` (AppKit) is platform-gated.

/// Identity-boxed `BoardPoller?` so it can be a `PreferenceKey` value (which must
/// be `Equatable`) without `BoardPoller` itself being `Equatable`.
struct ActiveBoardPoller: Equatable {
    let poller: BoardPoller?
    static func == (lhs: ActiveBoardPoller, rhs: ActiveBoardPoller) -> Bool {
        lhs.poller === rhs.poller
    }
}

/// Each poller-owning board publishes its poller up to the window root through
/// this preference. Only one board occupies the detail at a time; during the
/// transient overlap while one board disappears and the next appears, last
/// non-nil wins so the chip tracks the incoming board rather than blanking.
struct ActiveBoardPollerKey: PreferenceKey {
    static let defaultValue = ActiveBoardPoller(poller: nil)
    static func reduce(value: inout ActiveBoardPoller, nextValue: () -> ActiveBoardPoller) {
        let next = nextValue()
        if next.poller != nil { value = next }
    }
}

extension View {
    /// Publish this board's poller to its window root (drives that window's
    /// freshness chip + ⌘R). Adopt next to the board's `.onDisappear { vm.stop() }`.
    func tracksActiveBoard(_ poller: BoardPoller) -> some View {
        preference(key: ActiveBoardPollerKey.self, value: ActiveBoardPoller(poller: poller))
    }
}

/// The key window's command surface, published via `.focusedSceneValue` so the
/// app-level `BoardsCommands` (⌘K / ⌘1…⌘0) act on the focused window. Carries
/// closures, so it is intentionally not `Equatable`.
struct WindowChrome {
    let showPalette: () -> Void
    let jumpToTier: (FeatureTier) -> Void
    let isModalUp: Bool
}

private struct WindowChromeKey: FocusedValueKey { typealias Value = WindowChrome }
private struct ActiveBoardPollerFocusKey: FocusedValueKey { typealias Value = BoardPoller }

extension FocusedValues {
    /// The key window's chrome (palette + tier-jump + modal state).
    var windowChrome: WindowChrome? {
        get { self[WindowChromeKey.self] }
        set { self[WindowChromeKey.self] = newValue }
    }
    /// The key window's active-board poller, for ⌘R.
    var activeBoardPoller: BoardPoller? {
        get { self[ActiveBoardPollerFocusKey.self] }
        set { self[ActiveBoardPollerFocusKey.self] = newValue }
    }
}

#if canImport(AppKit)
/// Reports the hosting `NSWindow` up to SwiftUI so `WindowRouter` can bring the
/// *primary* window forward for app-level navigation (H6a tap / H6c menu-bar).
struct WindowAccessor: NSViewRepresentable {
    let onResolve: (NSWindow?) -> Void
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async { onResolve(view.window) }
        return view
    }
    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async { onResolve(nsView.window) }
    }
}
#endif
