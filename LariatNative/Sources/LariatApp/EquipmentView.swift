import SwiftUI
import LariatDB

struct EquipmentView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "Equipment", message: "Coming soon to native.", systemImage: "wrench.and.screwdriver")
      .navigationTitle("Equipment")
  }
}
