import SwiftUI
import LariatDB

struct FloorPlanView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "FloorPlan", message: "Coming soon to native.", systemImage: "square.grid.3x3")
      .navigationTitle("FloorPlan")
  }
}
