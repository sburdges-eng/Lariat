import SwiftUI
import LariatDB
import LariatModel

struct PinEntrySheet: View {
    @Environment(\.dismiss) private var dismiss
    let database: LariatWriteDatabase
    let onSuccess: (ManagerPinUser) -> Void

    @State private var pin = ""
    @State private var errorText: String?
    /// Programmatic focus: on macOS, sheets do not reliably focus their first
    /// field, and the high-frequency flow here is "type 4 digits + Return" —
    /// dropped keystrokes are silent (SecureField). Same pattern as
    /// `CommandPaletteView.queryFocused`.
    @FocusState private var pinFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Manager PIN").font(.title2).bold()
            Text("Enter your PIN to confirm this change.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            SecureField("PIN", text: $pin)
                .textFieldStyle(.roundedBorder)
                .focused($pinFocused)
                .onSubmit { submit() }
            if let errorText {
                Text(errorText).font(.caption).foregroundStyle(.red)
            }
            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("OK") { submit() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(pin.isEmpty)
            }
        }
        .padding(24)
        .frame(minWidth: 320)
        .onAppear { pinFocused = true }
    }

    private func submit() {
        errorText = nil
        do {
            let user = try database.pool.read { db in
                try PinVerifier().verify(pin: pin, db: db)
            }
            onSuccess(user)
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
    }
}
