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
    case culinary(CulinarySection)
    case operations(OperationsSection)
    case admin(AdminSection)
  }

  enum ManagerSection: String, Hashable, CaseIterable, Identifiable {
    case command = "Command"
    case analytics = "Analytics"
    case costing = "Costing"
    case purchasing = "Purchasing"
    case morning = "Morning"
    case beo = "BEO"
    case booking = "Booking"
    case playbook = "Playbook"
    case host = "Host"
    case tonightsShows = "Tonight's Shows"
    case savedSpecials = "Saved Specials"
    case management = "Management"
    var id: String { rawValue }
  }

  enum CulinarySection: String, Hashable, CaseIterable, Identifiable {
    case recipes = "Recipes"
    case prep = "Prep"
    case inventory = "Inventory"
    case allergens = "Allergens"
    var id: String { rawValue }
  }

  enum OperationsSection: String, Hashable, CaseIterable, Identifiable {
    case labor = "Labor"
    case floorPlan = "Floor Plan"
    case reservations = "Reservations"
    case goldStars = "Gold Stars"
    case bar = "Bar"
    var id: String { rawValue }
  }

  enum AdminSection: String, Hashable, CaseIterable, Identifiable {
    case adminSettings = "Admin Settings"
    case equipment = "Equipment"
    case datapackSearch = "Datapack Search"
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
            Section("Culinary") {
              ForEach(CulinarySection.allCases) { section in
                Text(section.rawValue).tag(SidebarSelection.culinary(section))
              }
            }
            Section("Operations") {
              ForEach(OperationsSection.allCases) { section in
                Text(section.rawValue).tag(SidebarSelection.operations(section))
              }
            }
            Section("Admin") {
              ForEach(AdminSection.allCases) { section in
                Text(section.rawValue).tag(SidebarSelection.admin(section))
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
      TodayView(
        database: database,
        writeDB: sharedWriteDatabase,
        catalog: stationCatalog,
        onOpenEightySix: { selection = .cook(.eightySix) }
      )
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
    case .cook(.stations):
      if let writeDB = sharedWriteDatabase, let catalog = stationCatalog {
        StationsListView(readDB: database, writeDB: writeDB, catalog: catalog)
      } else {
        TileDegrade(
          title: "Stations unavailable",
          message: "Could not open the write database or station catalog.",
          systemImage: "lock"
        )
      }
    case .cook(.kds):
      if let writeDB = sharedWriteDatabase {
        KdsPunchView(readDB: database, writeDB: writeDB)
      } else {
        TileDegrade(
          title: "KDS unavailable",
          message: "Could not open the write database.",
          systemImage: "lock"
        )
      }
    case .safety(.hub):
      FoodSafetyHubView(
        onOpenTempLog: { selection = .safety(.tempLog) },
        onOpenDateMarks: { selection = .safety(.dateMarks) },
        onOpenCalibrations: { selection = .safety(.calibrations) },
        onOpenCleaning: { selection = .safety(.cleaning) },
        onOpenBreaks: { selection = .safety(.breaks) }
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
    case .safety(.cleaning):
      if let writeDB = sharedWriteDatabase {
        CleaningView(readDB: database, writeDB: writeDB)
      } else {
        TileDegrade(
          title: "Cleaning unavailable",
          message: "Could not open the write database.",
          systemImage: "lock"
        )
      }
    case .safety(.breaks):
      if let writeDB = sharedWriteDatabase {
        BreakBoardView(readDB: database, writeDB: writeDB)
      } else {
        TileDegrade(
          title: "Breaks unavailable",
          message: "Could not open the write database.",
          systemImage: "lock"
        )
      }
    case .manager(.command):
      CommandView(database: database, writeDatabase: sharedWriteDatabase)
    case .manager(.analytics):
      AnalyticsView(database: database)
    case .manager(.costing):
      CostingView(database: database)
    case .manager(.purchasing):
      PurchasingView(database: database)
    case .manager(.morning):
      MorningView(database: database)
    case .manager(.beo):
      BeoView(database: database)
    case .manager(.booking):
      BookingView(database: database)
    case .manager(.playbook):
      PlaybookView(database: database)
    case .manager(.host):
      HostView(database: database)
    case .manager(.tonightsShows):
      TonightsShowsView(database: database)
    case .manager(.savedSpecials):
      SavedSpecialsView(database: database)
    case .manager(.management):
      ManagementRollupView(database: database, writeDatabase: sharedWriteDatabase)
    case .culinary(.recipes):
      RecipesView(database: database)
    case .culinary(.prep):
      PrepView(database: database)
    case .culinary(.inventory):
      InventoryView(database: database)
    case .culinary(.allergens):
      AllergensView(database: database)
    case .operations(.labor):
      LaborView(database: database)
    case .operations(.floorPlan):
      FloorPlanView(database: database)
    case .operations(.reservations):
      ReservationsView(database: database)
    case .operations(.goldStars):
      GoldStarsView(database: database)
    case .operations(.bar):
      BarView(database: database)
    case .admin(.adminSettings):
      AdminSettingsView(database: database)
    case .admin(.equipment):
      EquipmentView(database: database)
    case .admin(.datapackSearch):
      DatapackSearchView(database: database)
    }
  }
}
