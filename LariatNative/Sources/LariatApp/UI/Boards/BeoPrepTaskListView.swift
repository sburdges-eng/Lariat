import SwiftUI
import LariatModel

/// The BEO board's "Tasks" tab — a minimal, manually-entered prep-task
/// checklist for the open event (`beo_prep_tasks`). Task text and an
/// optional due date are plain operator-typed strings, matching this app's
/// existing date convention elsewhere on the board (no DatePicker, no
/// parsing). This is intentionally native-only, ahead of the current web
/// board (which has no prep-task UI); it is NOT Studio 5's regex-based
/// auto-generated countdown — that stays out of scope.
///
/// Reads are open; add/toggle both flow through the board's PIN-gated write
/// session via `vm.requestAddPrepTask()` / `vm.requestSetPrepDone(id:done:)`,
/// same as every other write on this board. There is no delete action here
/// — the web route has no `delete_prep` action, so native doesn't add one.
struct BeoPrepTaskListView: View {
    @Bindable var vm: BeoBoardViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if vm.prepTasks.isEmpty {
                    EmptyState(message: "No prep tasks yet. Add one below.", systemImage: "checklist")
                } else {
                    ForEach(vm.prepTasks) { task in
                        taskRow(task)
                        Divider().overlay(LariatBrand.line)
                    }
                }
                addRow
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func taskRow(_ task: BeoPrepTaskRow) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Button {
                vm.requestSetPrepDone(id: task.id, done: !task.done)
            } label: {
                Image(systemName: task.done ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(task.done ? LariatTheme.ok : LariatBrand.inkSoft)
            }
            .buttonStyle(.plain)
            .disabled(vm.isSaving)
            .accessibilityLabel(task.done ? "Mark not done" : "Mark done")

            VStack(alignment: .leading, spacing: 2) {
                Text(task.task)
                    .strikethrough(task.done)
                    .foregroundStyle(task.done ? LariatBrand.inkFaint : LariatBrand.ink)
                if let due = task.dueDate, !due.isEmpty {
                    Text("Due \(due)")
                        .font(.caption2)
                        .foregroundStyle(LariatBrand.inkSoft)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(task.task), \(task.done ? "done" : "not done")\(task.dueDate.map { ", due \($0)" } ?? "")")
    }

    private var addRow: some View {
        HStack(spacing: 8) {
            TextField("New task (e.g. Brine birds)", text: $vm.newPrepTaskText)
            TextField("Due date (optional)", text: $vm.newPrepTaskDueDate)
                .frame(width: 140)
            Button("Add") { vm.requestAddPrepTask() }
                .disabled(vm.isSaving || vm.newPrepTaskText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .textFieldStyle(.roundedBorder)
        .font(.callout)
        .padding(.top, 6)
    }
}
