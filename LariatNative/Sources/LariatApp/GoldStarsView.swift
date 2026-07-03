import SwiftUI
import LariatDB

struct GoldStarsView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "GoldStars", message: "Coming soon to native.", systemImage: "star.fill")
      .navigationTitle("GoldStars")
  }
}
