import SwiftUI
import LariatDB
import LariatModel

@main
struct LariatApp: App {
  /// Selection is the feature `id` (e.g. `"cook.today"`). The shell is generic:
  /// it never references a specific feature — everything comes from `FeatureRegistry`.
  @State private var selectedId: String? = FeatureRegistry.defaultId

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
