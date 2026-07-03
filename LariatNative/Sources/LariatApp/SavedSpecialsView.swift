import SwiftUI
import LariatDB

struct SavedSpecialsView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "Saved Specials", message: "Coming soon to native.", systemImage: "star")
      .navigationTitle("Saved Specials")
  }
}
