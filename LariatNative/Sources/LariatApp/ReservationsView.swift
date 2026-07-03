import SwiftUI
import LariatDB

struct ReservationsView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "Reservations", message: "Coming soon to native.", systemImage: "calendar")
      .navigationTitle("Reservations")
  }
}
