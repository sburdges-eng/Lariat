import SwiftUI
import LariatDB

struct AllergensView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "Allergens", message: "Coming soon to native.", systemImage: "exclamationmark.triangle")
      .navigationTitle("Allergens")
  }
}
