import SwiftUI
import LariatDB
import LariatModel
#if canImport(AppKit)
import AppKit

/// Unbundled executables (`swift run LariatApp`, no `.app` wrapper/Info.plist)
/// never activate themselves: the window opens behind Terminal and every
/// keyboard-first affordance (⌘K palette, ⌘R, ⌘1…⌘9, field focus) is inert
/// until the user clicks the window. Promote to a regular app and activate on
/// launch — harmless when bundled, essential when run from the CLI.
final class LariatAppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate()
  }
}

/// Tracks whether *any* window currently has a sheet attached (board forms,
/// PIN entry, the palette itself). Menu commands stay live while a sheet is
/// up, so without this guard ⌘K latches the palette behind a form sheet and
/// ⌘1…⌘9 swaps the detail view underneath an open form, tearing it down and
/// discarding the operator's typed data (shell-level twin of the BeoBoard
/// modal-vs-modal fix in PR #401).
@Observable @MainActor
final class SheetPresenceMonitor {
  static let shared = SheetPresenceMonitor()

  private(set) var isSheetPresented = false
  @ObservationIgnored private var observers: [NSObjectProtocol] = []

  private init() {
    let center = NotificationCenter.default
    observers.append(center.addObserver(
      forName: NSWindow.willBeginSheetNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.isSheetPresented = true }
    })
    observers.append(center.addObserver(
      forName: NSWindow.didEndSheetNotification, object: nil, queue: .main
    ) { [weak self] _ in
      // Recount from real window state (async so AppKit finishes detaching):
      // another window's sheet may still be up.
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          self?.isSheetPresented = NSApp.windows.contains { $0.attachedSheet != nil }
        }
      }
    })
  }
}
#endif

@main
struct LariatApp: App {
  #if canImport(AppKit)
  @NSApplicationDelegateAdaptor(LariatAppDelegate.self) private var appDelegate
  #endif

  /// Selection is the feature `id` (e.g. `"cook.today"`). The shell is generic:
  /// it never references a specific feature — everything comes from `FeatureRegistry`.
  @State private var selectedId: String? = FeatureRegistry.defaultId
  /// ⌘K command palette (endgame H3) — presented over whichever board is up.
  @State private var showingPalette = false

  private let sharedDatabase: LariatDatabase?
  private let sharedWriteDatabase: LariatWriteDatabase?
  private let stationCatalog: StationCatalog?
  /// Why the station catalog failed to load, for the shell banner — a bare
  /// `try?` used to swallow this, so one malformed cache file silently
  /// degraded the 86/Stations boards with a message blaming the write DB.
  private let stationCatalogError: String?

  init() {
    let path = resolveDatabasePath()
    sharedDatabase = try? LariatDatabase(path: path)
    sharedWriteDatabase = try? LariatWriteDatabase(path: path)
    do {
      stationCatalog = try StationCatalog.load()
      stationCatalogError = nil
    } catch {
      stationCatalog = nil
      stationCatalogError = error.localizedDescription
    }
  }

  /// True while any sheet (board form, PIN entry, the palette) is presented —
  /// palette/tier-jump navigation must not fire underneath it.
  @MainActor private var isModalUp: Bool {
    #if canImport(AppKit)
    SheetPresenceMonitor.shared.isSheetPresented
    #else
    false
    #endif
  }

  var body: some Scene {
    WindowGroup {
      rootView
        .sheet(isPresented: $showingPalette) {
          CommandPaletteView(
            onSelect: { id in
              selectedId = id
              showingPalette = false
            },
            onDismiss: { showingPalette = false }
          )
        }
    }
    .commands {
      // Endgame H4: keyboard-first macOS. Everything here stays generic —
      // tiers come from `FeatureTier.allCases`, destinations from the registry.
      // Palette/tier-jump items are disabled while any sheet is presented so a
      // menu command can never tear down a form mid-entry (see
      // `SheetPresenceMonitor`); the action-level guards are belt and braces.
      CommandMenu("Boards") {
        Button("Jump to Board…") {
          guard !isModalUp else { return }
          showingPalette = true
        }
        .keyboardShortcut("k", modifiers: .command)
        .disabled(isModalUp)
        // Endgame H5: immediate re-poll of the active board (resets backoff
        // too). Boards without a poller (static/aggregate screens) have
        // nothing to refresh — disable instead of silently no-opping.
        Button("Refresh Now") { BoardPollerHub.shared.active?.refreshNow() }
          .keyboardShortcut("r", modifiers: .command)
          .disabled(BoardPollerHub.shared.active == nil)
        Divider()
        // Jump to the first enabled board of each tier, in sidebar order.
        // Every tier gets a menu entry; the first 9 get ⌘1…⌘9 and the 10th
        // gets ⌘0 (only 10 digit keys exist — later tiers are menu-only).
        ForEach(Array(FeatureTier.allCases.enumerated()), id: \.element) { index, tier in
          Button(tier.rawValue) {
            guard !isModalUp else { return }
            if let first = FeatureRegistry.modules(for: tier).first(where: \.enabled) {
              selectedId = first.id
            }
          }
          .keyboardShortcut(Self.tierShortcut(at: index))
          .disabled(isModalUp)
        }
      }
    }
  }

  /// ⌘1…⌘9 for the first nine tiers, ⌘0 for the tenth, none afterwards.
  private static func tierShortcut(at index: Int) -> KeyboardShortcut? {
    switch index {
    case 0..<9: return KeyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
    case 9: return KeyboardShortcut("0", modifiers: .command)
    default: return nil
    }
  }

  /// The existing shell, unchanged, extracted so the palette sheet can attach
  /// to both the healthy and degraded branches.
  @ViewBuilder
  private var rootView: some View {
    if let db = sharedDatabase {
      let ctx = AppContext(
        database: db,
        writeDatabase: sharedWriteDatabase,
        catalog: stationCatalog,
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
        // Station-catalog load failure: name the file + decode error instead
        // of leaving the 86/Stations degrade tiles to guess at the cause.
        .safeAreaInset(edge: .top, spacing: 0) {
          if let stationCatalogError {
            catalogErrorBanner(stationCatalogError)
          }
        }
        // Endgame H5: data-freshness chip for the active board's poller.
        // A bottom safe-area inset (not an overlay) so dense boards scroll
        // clear of the chip instead of it covering their last row.
        .safeAreaInset(edge: .bottom, alignment: .trailing, spacing: 0) {
          PollFreshnessIndicator()
            .padding(12)
        }
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

  /// Shell-level surface for a station-catalog load failure. The feature tiles
  /// (86, Stations) still degrade, but this names the actual file + decode
  /// error so the operator knows what to regenerate — previously the failure
  /// was fully silent and the tiles blamed the write database.
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

  /// Resolve the selected feature generically from the registry. No per-feature
  /// switch — a new feature is reachable the moment it is in `FeatureRegistry.all`.
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
