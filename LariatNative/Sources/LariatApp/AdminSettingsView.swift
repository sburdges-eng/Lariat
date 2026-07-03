import SwiftUI
import LariatDB

struct AdminSettingsView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "AdminSettings", message: "Coming soon to native.", systemImage: "gear")
      .navigationTitle("AdminSettings")
  }
}
