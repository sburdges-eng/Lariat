import SwiftUI
import LariatDB

struct BookingView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "Booking", message: "Coming soon to native.", systemImage: "calendar")
      .navigationTitle("Booking")
  }
}
