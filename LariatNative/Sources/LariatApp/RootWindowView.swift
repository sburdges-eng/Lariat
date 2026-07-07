import SwiftUI
import LariatDB
import LariatModel

/// H6d — the per-window root. Extracted from `LariatApp` so that `selectedId`,
/// `showingPalette`, and the window's active-board poller are **per-window
/// `@State`** rather than App-global: each window navigates independently and
/// shows its own freshness chip. Board→board navigation uses this window's
/// `AppContext.navigate` (per-window); app-level entry points (H6a notification
/// tap, H6c menu-bar) route through `WindowRouter` to the primary window.
struct RootWindowView: View {
    let database: LariatDatabase?
    let writeDatabase: LariatWriteDatabase?
    let catalog: StationCatalog?
    let catalogError: String?

    /// Per-window selection (was App-global). Everything comes from `FeatureRegistry`.
    @State private var selectedId: String? = FeatureRegistry.defaultId
    /// Per-window ⌘K palette.
    @State private var showingPalette = false
    /// This window's current board poller, published up by the active board via
    /// `ActiveBoardPollerKey` — drives this window's freshness chip + ⌘R, correct
    /// even when the window is not key/frontmost.
    @State private var activePoller: BoardPoller?
    #if os(macOS)
    /// This window's `WindowRouter` registration token (nil until registered).
    @State private var routerToken: Int?
    #endif

    /// True while any sheet (board form, PIN entry, the palette) is presented —
    /// palette/tier-jump navigation must not fire underneath it.
    @MainActor private var isModalUp: Bool {
        #if canImport(AppKit)
        SheetPresenceMonitor.shared.isSheetPresented
        #else
        false
        #endif
    }

    var body: some View {
        content
            .sheet(isPresented: $showingPalette) {
                CommandPaletteView(
                    onSelect: { id in
                        selectedId = id
                        showingPalette = false
                    },
                    onDismiss: { showingPalette = false }
                )
            }
            // The active board publishes its poller up to here (per window).
            .onPreferenceChange(ActiveBoardPollerKey.self) { active in
                activePoller = active.poller
            }
            #if os(macOS)
            // Publish this window's command surface + poller to focus, so the
            // app-level `BoardsCommands` act on the *key* window.
            .focusedSceneValue(\.windowChrome, windowChrome)
            .focusedSceneValue(\.activeBoardPoller, activePoller)
            // Register with the app-level router (first window = primary target
            // for H6a/H6c navigation); attach the NSWindow so it can be brought
            // forward; deregister on close.
            .background(WindowAccessor { window in
                if let token = routerToken { WindowRouter.shared.attachWindow(token, window) }
            })
            .onAppear {
                if routerToken == nil {
                    routerToken = WindowRouter.shared.register(navigate: { id in
                        if !isModalUp { selectedId = id }
                    })
                }
            }
            .onDisappear {
                if let token = routerToken {
                    WindowRouter.shared.deregister(token)
                    routerToken = nil
                }
            }
            #endif
    }

    #if os(macOS)
    /// This window's chrome for the key-window commands (⌘K / ⌘1…⌘0), honoring
    /// the same `isModalUp` guard the inline commands used.
    private var windowChrome: WindowChrome {
        WindowChrome(
            showPalette: { if !isModalUp { showingPalette = true } },
            jumpToTier: { tier in
                guard !isModalUp else { return }
                if let first = FeatureRegistry.modules(for: tier).first(where: \.enabled) {
                    selectedId = first.id
                }
            },
            isModalUp: isModalUp
        )
    }
    #endif

    @ViewBuilder
    private var content: some View {
        if let db = database {
            let ctx = AppContext(
                database: db,
                writeDatabase: writeDatabase,
                catalog: catalog,
                navigate: { selectedId = $0 }
            )
            NavigationSplitView {
                List(selection: $selectedId) {
                    ForEach(FeatureTier.allCases, id: \.self) { tier in
                        Section(tier.rawValue) {
                            ForEach(FeatureRegistry.modules(for: tier)) { module in
                                if module.enabled {
                                    Text(module.title).tag(Optional(module.id))
                                } else {
                                    Text(module.title)
                                        .foregroundStyle(.tertiary)
                                        .badge("Soon")
                                }
                            }
                        }
                    }
                }
                .navigationTitle("Lariat")
            } detail: {
                NavigationStack {
                    detailView(context: ctx)
                }
                .safeAreaInset(edge: .top, spacing: 0) {
                    if let catalogError {
                        catalogErrorBanner(catalogError)
                    }
                }
                // Endgame H5 → H6d: freshness chip for *this window's* active board.
                .safeAreaInset(edge: .bottom, alignment: .trailing, spacing: 0) {
                    PollFreshnessIndicator(poller: activePoller)
                        .padding(12)
                }
            }
            // H6a: local notifications for red signals — app-wide poller started
            // once (AlertMonitor guards double-start). Its tap routes through the
            // app-level WindowRouter (macOS) / this window (elsewhere).
            .task {
                #if os(macOS)
                AlertMonitor.shared.start(db: db, writeDb: writeDatabase,
                                          navigate: { WindowRouter.shared.navigate($0) })
                #else
                AlertMonitor.shared.start(db: db, writeDb: writeDatabase,
                                          navigate: { selectedId = $0 })
                #endif
            }
        } else {
            TileDegrade(
                title: "Database unavailable",
                message: "Could not open lariat.db at \(resolveDatabasePath()). " +
                    "Check that the web app has created the database and that " +
                    "LARIAT_DATA_DIR is set if needed.",
                systemImage: "externaldrive.badge.xmark"
            )
        }
    }

    /// Shell-level surface for a station-catalog load failure (names the file +
    /// decode error so the operator knows what to regenerate).
    private func catalogErrorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(LariatTheme.warn)
            Text("Station catalog unavailable — \(message) " +
                "Regenerate the web app's data/cache files; 86 and station boards " +
                "are degraded until then.")
                .font(.callout)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityElement(children: .combine)
    }

    /// Resolve the selected feature generically from the registry.
    @ViewBuilder
    private func detailView(context: AppContext) -> some View {
        if let id = selectedId, let module = FeatureRegistry.module(id: id) {
            module.makeView(context)
        } else {
            TileDegrade(
                title: "Nothing selected",
                message: "Pick a screen from the sidebar.",
                systemImage: "sidebar.left"
            )
        }
    }
}
