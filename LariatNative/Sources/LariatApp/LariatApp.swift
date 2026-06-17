import SwiftUI
import LariatDB
import LariatModel

@main
struct LariatApp: App {
  @State private var selection: SidebarSelection = .cook(.today)

  enum SidebarSelection: Hashable {
    case cook(CookDestination)
    case safety(SafetyDestination)
    case manager(ManagerSection)
  }

  enum ManagerSection: String, Hashable, CaseIterable, Identifiable {
    case command = "Command"
    case analytics = "Analytics"
    case costing = "Costing"
    case management = "Management"
    var id: String { rawValue }
  }

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
        NavigationSplitView {
          List(selection: $selection) {
            Section("Cook") {
              ForEach(CookDestination.allCases) { dest in
                if dest.enabled {
                  Text(dest.rawValue).tag(SidebarSelection.cook(dest))
                } else {
                  Text(dest.rawValue)
                    .foregroundStyle(.tertiary)
                    .badge("Soon")
                }
              }
            }
            Section("Safety") {
              ForEach(SafetyDestination.allCases) { dest in
                if dest.enabled {
                  Text(dest.rawValue).tag(SidebarSelection.safety(dest))
                } else {
                  Text(dest.rawValue)
                    .foregroundStyle(.tertiary)
                    .badge("Soon")
                }
              }
            }
            Section("Manager") {
              ForEach(ManagerSection.allCases) { section in
                Text(section.rawValue).tag(SidebarSelection.manager(section))
              }
            }
          }
          .navigationTitle("Lariat")
        } detail: {
          NavigationStack {
            detailView(database: db)
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

  @ViewBuilder
  private func detailView(database: LariatDatabase) -> some View {
    switch selection {
    case .cook(.today):
      TodayView(database: database, onOpenEightySix: { selection = .cook(.eightySix) })
    case .cook(.eightySix):
      if let writeDB = sharedWriteDatabase, let catalog = stationCatalog {
        EightySixView(readDB: database, writeDB: writeDB, catalog: catalog)
      } else {
        TileDegrade(
          title: "86 unavailable",
          message: "Could not open the write database or station catalog.",
          systemImage: "lock"
        )
      }
    case .cook(.stations), .cook(.kds):
      TileDegrade(title: "Coming soon", message: "This cook screen ships in a later phase.", systemImage: "clock")
    case .safety(.hub):
      FoodSafetyHubView(
        onOpenTempLog: { selection = .safety(.tempLog) },
        onOpenDateMarks: { selection = .safety(.dateMarks) },
        onOpenCalibrations: { selection = .safety(.calibrations) }
      )
    case .safety(.tempLog):
      if let writeDB = sharedWriteDatabase {
        TempLogView(readDB: database, writeDB: writeDB)
      } else {
        TileDegrade(
          title: "Temp log unavailable",
          message: "Could not open the write database.",
          systemImage: "lock"
        )
      }
    case .safety(.dateMarks):
      if let writeDB = sharedWriteDatabase {
        DateMarkView(readDB: database, writeDB: writeDB)
      } else {
        TileDegrade(
          title: "Date marks unavailable",
          message: "Could not open the write database.",
          systemImage: "lock"
        )
      }
    case .safety(.calibrations):
      if let writeDB = sharedWriteDatabase {
        CalibrationsView(readDB: database, writeDB: writeDB)
      } else {
        TileDegrade(
          title: "Calibrations unavailable",
          message: "Could not open the write database.",
          systemImage: "lock"
        )
      }
    case .safety(.cleaning), .safety(.breaks):
      TileDegrade(title: "Coming soon", message: "This safety screen ships in P3c.", systemImage: "clock")
    case .manager(.command):
      CommandView(database: database, writeDatabase: sharedWriteDatabase)
    case .manager(.analytics):
      AnalyticsView(database: database)
    case .manager(.costing):
      CostingView(database: database)
    case .manager(.management):
      ManagementRollupView(database: database, writeDatabase: sharedWriteDatabase)
    }
  }
}
