import SwiftUI
import LariatDB

struct PurchasingView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "Purchasing", message: "Coming soon to native.", systemImage: "cart")
      .navigationTitle("Purchasing")
  }
}
