import SwiftUI
import LariatModel

/// Shared cook-identity sheet. When a regulated write was interrupted because
/// no cook was set (`store.hasPendingWrite`), picking a cook auto-retries the
/// stashed write; Cancel (or a swipe-dismiss) drops it and reports `onCancel`
/// so the calling board can say the change was not saved. Resolution happens
/// exactly once, in `onDisappear`, so swipe-dismiss can never leave a stale
/// pending write behind.
struct CookIdentityPicker: View {
    @Bindable var store: CookIdentityStore
    let staff: [StaffMember]
    let staffUnavailable: Bool
    var onDismiss: () -> Void
    /// Called when a pending write existed but no cook was picked.
    var onCancel: () -> Void = {}

    @State private var manualId = ""

    var body: some View {
        NavigationStack {
            Group {
                if staffUnavailable {
                    manualEntry
                } else {
                    List {
                        if store.hasPendingWrite {
                            Section {
                                pendingCaption
                            }
                        }
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
                    Button("Cancel") {
                        onDismiss()
                    }
                }
            }
            .onDisappear { resolvePendingWrite() }
        }
    }

    private var pendingCaption: some View {
        Label(
            "Your change was not saved — pick a cook to record it.",
            systemImage: "exclamationmark.triangle"
        )
        .font(.subheadline)
        .foregroundStyle(.orange)
    }

    private var manualEntry: some View {
        Form {
            if store.hasPendingWrite {
                Section {
                    pendingCaption
                }
            }
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

    /// Single resolution point for the interrupted write — fires on every
    /// dismissal path (pick, manual save, Cancel button, swipe-down).
    private func resolvePendingWrite() {
        guard let pending = store.takePendingWrite() else { return }
        if store.cookId != nil {
            Task { await pending() }
        } else {
            onCancel()
        }
    }
}
