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
            shellContent(context: ctx)
                .preferredColorScheme(.dark)
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
            ZStack {
                LaRiOS.Colors.background.ignoresSafeArea()
                TileDegrade(
                    title: "Database unavailable",
                    message: "Could not open lariat.db at \(resolveDatabasePath()). " +
                        "Check that the web app has created the database and that " +
                        "LARIAT_DATA_DIR is set if needed.",
                    systemImage: "externaldrive.badge.xmark"
                )
                .foregroundStyle(LaRiOS.Colors.text)
                .lariosPanel()
                .padding(LaRiOS.Spacing.twelve)
            }
            .preferredColorScheme(.dark)
        }
    }

    private var selectedModule: FeatureModule? {
        guard let selectedId else { return nil }
        return FeatureRegistry.module(id: selectedId)
    }

    private var selectedTier: FeatureTier {
        selectedModule?.tier ?? .cook
    }

    private func selectTier(_ tier: FeatureTier) {
        if let first = FeatureRegistry.modules(for: tier).first(where: \.enabled) {
            selectedId = first.id
        }
    }

    @ViewBuilder
    private func shellContent(context: AppContext) -> some View {
        ZStack {
            LaRiOS.Colors.background.ignoresSafeArea()
            VStack(spacing: 0) {
                serviceStrip
                HStack(spacing: 0) {
                    divisionRail
                    boardSidebar
                    detailColumn(context: context)
                }
                commandBar
            }
        }
        .foregroundStyle(LaRiOS.Colors.text)
    }

    private var serviceStrip: some View {
        HStack(spacing: LaRiOS.Spacing.ten) {
            HStack(spacing: LaRiOS.Spacing.six) {
                ZStack {
                    RoundedRectangle(cornerRadius: LaRiOS.Radius.small)
                        .fill(LaRiOS.Colors.accent)
                    Text("L")
                        .font(LaRiOS.Typography.railGlyph)
                        .foregroundStyle(LaRiOS.Colors.onAccent)
                }
                .frame(width: 32, height: 32)
                VStack(alignment: .leading, spacing: LaRiOS.Spacing.one) {
                    Text("THE LARIAT")
                        .font(LaRiOS.Typography.eyebrow)
                        .foregroundStyle(LaRiOS.Colors.accent)
                    Text("Service ledger")
                        .font(LaRiOS.Typography.titleSmall)
                        .foregroundStyle(LaRiOS.Colors.text)
                }
            }
            Divider()
                .overlay(LaRiOS.Colors.hairline)
                .frame(height: 28)
            VStack(alignment: .leading, spacing: LaRiOS.Spacing.one) {
                Text("ACTIVE BOARD")
                    .font(LaRiOS.Typography.eyebrow)
                    .foregroundStyle(LaRiOS.Colors.textMuted)
                Text(selectedModule?.title ?? "None")
                    .font(LaRiOS.Typography.bodyStrong)
                    .foregroundStyle(LaRiOS.Colors.text)
            }
            Spacer(minLength: LaRiOS.Spacing.eight)
            HStack(spacing: LaRiOS.Spacing.four) {
                LaRiOSStatusDot(tone: .ok, size: 7)
                Text("Local DB")
                    .font(LaRiOS.Typography.smallStrong)
                    .foregroundStyle(LaRiOS.Colors.textMuted)
            }
            Button {
                if !isModalUp { showingPalette = true }
            } label: {
                Text("COMMAND")
            }
            .buttonStyle(.larios(.primary))
        }
        .padding(.horizontal, LaRiOS.Spacing.ten)
        .frame(height: LaRiOS.Shell.stripHeight)
        .background(
            LinearGradient(
                colors: [LaRiOS.Colors.panelRaised.opacity(0.92), LaRiOS.Colors.panel],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .overlay(alignment: .bottom) {
            Rectangle().fill(LaRiOS.Colors.hairline).frame(height: 1)
        }
    }

    private var divisionRail: some View {
        VStack(spacing: LaRiOS.Spacing.two) {
            ForEach(FeatureTier.allCases, id: \.self) { tier in
                divisionButton(tier)
            }
            Spacer(minLength: LaRiOS.Spacing.eight)
        }
        .padding(.top, LaRiOS.Spacing.five)
        .padding(.horizontal, LaRiOS.Spacing.four)
        .frame(
            minWidth: LaRiOS.Shell.railWidth,
            idealWidth: LaRiOS.Shell.railWidth,
            maxWidth: LaRiOS.Shell.railWidth,
            maxHeight: .infinity
        )
        .background(
            LinearGradient(
                colors: [LaRiOS.Colors.panel, LaRiOS.Colors.background],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .overlay(alignment: .trailing) {
            Rectangle().fill(LaRiOS.Colors.hairline).frame(width: 1)
        }
    }

    private func divisionButton(_ tier: FeatureTier) -> some View {
        let isActive = tier == selectedTier
        return Button {
            selectTier(tier)
        } label: {
            VStack(spacing: LaRiOS.Spacing.one) {
                Text(tierGlyph(tier))
                    .font(LaRiOS.Typography.railGlyph)
                    .foregroundStyle(isActive ? LaRiOS.Colors.accent : LaRiOS.Colors.textMuted)
                Text(tierShortLabel(tier).uppercased())
                    .font(LaRiOS.Typography.railLabel)
                    .foregroundStyle(isActive ? LaRiOS.Colors.text : LaRiOS.Colors.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
            }
            .frame(width: 48, height: 48)
            .background(isActive ? LaRiOS.Colors.panelRaised : Color.clear, in: RoundedRectangle(cornerRadius: LaRiOS.Radius.small))
            .overlay {
                RoundedRectangle(cornerRadius: LaRiOS.Radius.small)
                    .stroke(isActive ? LaRiOS.Colors.accent : Color.clear, lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .help(tier.rawValue)
    }

    private var boardSidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: LaRiOS.Spacing.two) {
                Text("SERVICE")
                    .font(LaRiOS.Typography.eyebrow)
                    .foregroundStyle(LaRiOS.Colors.textMuted)
                Text(selectedTier.rawValue)
                    .font(LaRiOS.Typography.titleSmall)
                    .foregroundStyle(LaRiOS.Colors.text)
            }
            .padding(.horizontal, LaRiOS.Spacing.eight)
            .padding(.top, LaRiOS.Spacing.eight)
            .padding(.bottom, LaRiOS.Spacing.six)
            .overlay(alignment: .bottom) {
                Rectangle().fill(LaRiOS.Colors.hairline).frame(height: 1)
            }

            ScrollView {
                LazyVStack(alignment: .leading, spacing: LaRiOS.Spacing.two) {
                    Text("Boards")
                        .font(LaRiOS.Typography.stamp)
                        .foregroundStyle(LaRiOS.Colors.textMuted)
                        .padding(.horizontal, LaRiOS.Spacing.eight)
                        .padding(.top, LaRiOS.Spacing.six)
                    ForEach(FeatureRegistry.modules(for: selectedTier)) { module in
                        boardButton(module)
                    }
                }
                .padding(.bottom, LaRiOS.Spacing.ten)
            }
            Spacer(minLength: 0)
            Text("Command-K opens boards. Data stays local.")
                .font(LaRiOS.Typography.xsmall)
                .foregroundStyle(LaRiOS.Colors.textMuted)
                .lineSpacing(2)
                .padding(LaRiOS.Spacing.eight)
                .overlay(alignment: .top) {
                    Rectangle().fill(LaRiOS.Colors.hairline).frame(height: 1)
                }
        }
        .frame(
            minWidth: LaRiOS.Shell.sidebarWidth,
            idealWidth: LaRiOS.Shell.sidebarWidth,
            maxWidth: LaRiOS.Shell.sidebarWidth,
            maxHeight: .infinity,
            alignment: .topLeading
        )
        .background(
            LinearGradient(
                colors: [LaRiOS.Colors.accent.opacity(0.06), Color.clear],
                startPoint: .top,
                endPoint: .center
            )
            .background(LaRiOS.Colors.panel)
        )
        .overlay(alignment: .trailing) {
            Rectangle().fill(LaRiOS.Colors.hairline).frame(width: 1)
        }
    }

    private func boardButton(_ module: FeatureModule) -> some View {
        let isActive = module.id == selectedId
        return Button {
            if module.enabled { selectedId = module.id }
        } label: {
            HStack(spacing: LaRiOS.Spacing.four) {
                Rectangle()
                    .fill(isActive ? LaRiOS.Colors.accent : LaRiOS.Colors.hairline)
                    .frame(width: 2, height: 16)
                Text(module.title)
                    .font(LaRiOS.Typography.sidebarLabel)
                    .foregroundStyle(module.enabled ? LaRiOS.Colors.text : LaRiOS.Colors.textMuted.opacity(0.55))
                    .lineLimit(1)
                Spacer(minLength: LaRiOS.Spacing.four)
                if !module.enabled {
                    Text("Soon")
                        .font(LaRiOS.Typography.eyebrow)
                        .foregroundStyle(LaRiOS.Colors.textMuted.opacity(0.7))
                }
            }
            .padding(.horizontal, LaRiOS.Spacing.six)
            .padding(.vertical, LaRiOS.Spacing.four)
            .background(isActive ? LaRiOS.Colors.panelRaised : Color.clear, in: RoundedRectangle(cornerRadius: LaRiOS.Radius.small))
            .overlay {
                RoundedRectangle(cornerRadius: LaRiOS.Radius.small)
                    .stroke(isActive ? LaRiOS.Colors.accent.opacity(0.82) : Color.clear, lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .disabled(!module.enabled)
        .padding(.horizontal, LaRiOS.Spacing.four)
    }

    private func detailColumn(context: AppContext) -> some View {
        VStack(spacing: 0) {
            activeBoardStrip
            ZStack {
                LaRiOS.Colors.background
                detailView(context: context)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(LaRiOS.Spacing.eight)
            }
            if let catalogError {
                catalogErrorBanner(catalogError)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var activeBoardStrip: some View {
        HStack(spacing: LaRiOS.Spacing.six) {
            Text(tierGlyph(selectedTier))
                .font(LaRiOS.Typography.eyebrow)
                .foregroundStyle(LaRiOS.Colors.accent)
                .padding(.horizontal, LaRiOS.Spacing.four)
                .padding(.vertical, LaRiOS.Spacing.two)
                .background(LaRiOS.Colors.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: LaRiOS.Radius.small))
            Text(selectedModule?.title.uppercased() ?? "NO BOARD")
                .font(LaRiOS.Typography.eyebrow)
                .foregroundStyle(LaRiOS.Colors.text)
            Text(selectedModule?.id ?? "")
                .font(LaRiOS.Typography.xsmall)
                .foregroundStyle(LaRiOS.Colors.textMuted)
            Spacer(minLength: LaRiOS.Spacing.eight)
            Text("Local DB")
                .font(LaRiOS.Typography.xsmall)
                .foregroundStyle(LaRiOS.Colors.textMuted)
        }
        .padding(.horizontal, LaRiOS.Spacing.eight)
        .frame(height: 42)
        .background(LaRiOS.Colors.panel)
        .overlay(alignment: .bottom) {
            Rectangle().fill(LaRiOS.Colors.hairline).frame(height: 1)
        }
    }

    private var commandBar: some View {
        HStack(spacing: LaRiOS.Spacing.eight) {
            Text("NATIVE")
                .font(LaRiOS.Typography.eyebrow)
                .foregroundStyle(LaRiOS.Colors.accent)
            Text("Local SQLite")
                .font(LaRiOS.Typography.xsmall)
                .foregroundStyle(LaRiOS.Colors.textMuted)
            Spacer(minLength: LaRiOS.Spacing.eight)
            PollFreshnessIndicator(poller: activePoller)
            Text("Cmd-R refresh")
                .font(LaRiOS.Typography.xsmall)
                .foregroundStyle(LaRiOS.Colors.textMuted)
        }
        .padding(.horizontal, LaRiOS.Spacing.ten)
        .frame(height: LaRiOS.Shell.commandHeight)
        .background(LaRiOS.Colors.panel)
        .overlay(alignment: .top) {
            Rectangle().fill(LaRiOS.Colors.hairline).frame(height: 1)
        }
    }

    private func tierGlyph(_ tier: FeatureTier) -> String {
        switch tier {
        case .cook: return "LN"
        case .safety: return "SF"
        case .labor: return "LB"
        case .inventory: return "IN"
        case .manager: return "GM"
        case .costing: return "CO"
        case .purchasing: return "PO"
        case .foh: return "FL"
        case .shows: return "SH"
        case .house: return "HS"
        case .beo: return "BE"
        }
    }

    private func tierShortLabel(_ tier: FeatureTier) -> String {
        switch tier {
        case .cook: return "Line"
        case .foh: return "Floor"
        case .manager: return "GM"
        case .purchasing: return "Buy"
        default: return tier.rawValue
        }
    }

    /// Shell-level surface for a station-catalog load failure (names the file +
    /// decode error so the operator knows what to regenerate).
    private func catalogErrorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(LaRiOS.Colors.metal)
            Text("Station catalog unavailable — \(message) " +
                "Regenerate the web app's data/cache files; 86 and station boards " +
                "are degraded until then.")
                .font(LaRiOS.Typography.small)
                .foregroundStyle(LaRiOS.Colors.text)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, LaRiOS.Spacing.eight)
        .padding(.vertical, LaRiOS.Spacing.four)
        .background(LaRiOS.Colors.metal.opacity(0.12))
        .overlay(alignment: .top) { Rectangle().fill(LaRiOS.Colors.metal.opacity(0.45)).frame(height: 1) }
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
