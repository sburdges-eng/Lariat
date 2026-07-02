import SwiftUI
import LariatDB
import LariatModel

@main
struct LariatApp: App {
  /// Selection is the feature `id` (e.g. `"cook.today"`). The shell is generic:
  /// it never references a specific feature — everything comes from `FeatureRegistry`.
  @State private var selectedId: String? = FeatureRegistry.defaultId
  /// ⌘K command palette (endgame H3) — presented over whichever board is up.
  @State private var showingPalette = false

  private let sharedDatabase: LariatDatabase?
  private let sharedWriteDatabase: LariatWriteDatabase?
  private let stationCatalog: StationCatalog?

  init() {
    let path = resolveDatabasePath()
    sharedDatabase = try? LariatDatabase(path: path)
    sharedWriteDatabase = try? LariatWriteDatabase(path: path)
    stationCatalog = try? StationCatalog.load()
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
      CommandMenu("Boards") {
        Button("Jump to Board…") { showingPalette = true }
          .keyboardShortcut("k", modifiers: .command)
        // Endgame H5: immediate re-poll of the active board (resets backoff too).
        Button("Refresh Now") { BoardPollerHub.shared.active?.refreshNow() }
          .keyboardShortcut("r", modifiers: .command)
        Divider()
        // ⌘1…⌘n jump to the first enabled board of each tier, in sidebar order.
        ForEach(Array(FeatureTier.allCases.prefix(9).enumerated()), id: \.element) { index, tier in
          Button(tier.rawValue) {
            if let first = FeatureRegistry.modules(for: tier).first(where: \.enabled) {
              selectedId = first.id
            }
          }
          .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
        }
      }
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
        // Endgame H5: data-freshness chip for the active board's poller.
        .overlay(alignment: .bottomTrailing) {
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
