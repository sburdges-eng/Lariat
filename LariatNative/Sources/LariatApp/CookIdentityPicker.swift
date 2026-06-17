import SwiftUI
import LariatModel

struct CookIdentityPicker: View {
    @Bindable var store: CookIdentityStore
    let staff: [StaffMember]
    let staffUnavailable: Bool
    var onDismiss: () -> Void

    @State private var manualId = ""

    var body: some View {
        NavigationStack {
            Group {
                if staffUnavailable {
                    manualEntry
                } else {
                    List {
                        Section("Who is on the line?") {
                            ForEach(staff) { member in
                                Button {
                                    store.setCookId(member.id)
                                    onDismiss()
                                } label: {
                                    HStack {
                                        Text(member.displayName)
                                        Spacer()
                                        if store.cookId == member.id {
                                            Image(systemName: "checkmark")
                                                .foregroundStyle(.tint)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Pick cook")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Skip for now") {
                        onDismiss()
                    }
                }
            }
        }
    }

    private var manualEntry: some View {
        Form {
            Section {
                Text("Staff list not found. Type your name or id.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                TextField("Cook id", text: $manualId)
                    .autocorrectionDisabled()
            }
            Section {
                Button("Save") {
                    store.setCookId(manualId)
                    onDismiss()
                }
                .disabled(manualId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }
}
