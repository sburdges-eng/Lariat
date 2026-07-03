import SwiftUI
import LariatDB

struct InventoryView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "Inventory", message: "Coming soon to native.", systemImage: "shippingbox")
      .navigationTitle("Inventory")
  }
}
