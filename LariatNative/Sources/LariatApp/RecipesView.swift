import SwiftUI
import LariatDB

struct RecipesView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "Recipes", message: "Coming soon to native.", systemImage: "list.bullet")
      .navigationTitle("Recipes")
  }
}
