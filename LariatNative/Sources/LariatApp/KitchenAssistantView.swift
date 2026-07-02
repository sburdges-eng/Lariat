import SwiftUI
import LariatDB
import LariatModel

/// `cook.assistant` — the LaRi kitchen assistant chat surface. Parity with
/// `app/kitchen-assistant/KitchenAssistantClient.jsx`: message thread, action
/// confirmations (⚡ prefix from the engine), per-turn sources chips, the
/// 30-second undo affordance, the allergen disclaimer footer, and the Ollama
/// reachability row. No streaming — the web calls Ollama with `stream:false`.
struct KitchenAssistantView: View {
    @State private var model: KitchenAssistantViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _model = State(initialValue: KitchenAssistantViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            thread
            Divider()
            composer
            footer
        }
        .navigationTitle("Assistant")
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .sheet(isPresented: $model.showPinSheet) {
            PinEntrySheet(database: model.writeDatabase) { user in
                model.pinVerified(user)
            }
        }
    }

    // ── header ──────────────────────────────────────────────────────

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles")
                .foregroundStyle(LariatTheme.amber)
            VStack(alignment: .leading, spacing: 2) {
                Text("LaRi — kitchen assistant").font(.headline)
                Text(model.modelName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            reachabilityBadge
            tierBadge
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    private var reachabilityBadge: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(model.ollamaReachable == true ? LariatTheme.ok
                      : model.ollamaReachable == false ? LariatTheme.bad : LariatTheme.muted)
                .frame(width: 8, height: 8)
            Text(model.ollamaReachable == true ? "Ollama online"
                 : model.ollamaReachable == false ? "Ollama offline" : "Checking…")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var tierBadge: some View {
        Group {
            if model.hasPin {
                Label("Manager tier", systemImage: "lock.open")
                    .font(.caption)
                    .foregroundStyle(LariatTheme.ok)
            } else {
                Button {
                    model.showPinSheet = true
                } label: {
                    Label("Cook tier", systemImage: "lock")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Enter a manager PIN to unlock actions and manager data")
            }
        }
    }

    // ── thread ──────────────────────────────────────────────────────

    private var thread: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if model.turns.isEmpty {
                        EmptyState(
                            message: "Ask about 86s, line checks, recipes, or say \"86 the salmon\" to act.",
                            systemImage: "bubble.left.and.bubble.right"
                        )
                        .padding(.horizontal)
                    }
                    ForEach(model.turns) { turn in
                        turnRow(turn).id(turn.id)
                    }
                    if model.isThinking {
                        ProgressView("LaRi is thinking…")
                            .padding(.horizontal)
                    }
                }
                .padding(.vertical, 12)
            }
            .onChange(of: model.turns.count) {
                if let last = model.turns.last?.id {
                    withAnimation { proxy.scrollTo(last, anchor: .bottom) }
                }
            }
        }
    }

    @ViewBuilder
    private func turnRow(_ turn: KitchenAssistantViewModel.ChatTurn) -> some View {
        switch turn.role {
        case .cook:
            HStack {
                Spacer(minLength: 60)
                Text(turn.text)
                    .padding(10)
                    .background(LariatTheme.amber.opacity(0.18), in: RoundedRectangle(cornerRadius: 10))
            }
            .padding(.horizontal)
        case .assistant:
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(turn.text)
                        .textSelection(.enabled)
                        .padding(10)
                        .background(bubbleColor(turn), in: RoundedRectangle(cornerRadius: 10))
                    if model.undoAvailable(turn) {
                        Button {
                            model.undo(turnId: turn.id)
                        } label: {
                            Label("Undo (\(model.undoSecondsLeft(turn))s)", systemImage: "arrow.uturn.backward")
                                .font(.caption)
                        }
                        .buttonStyle(.bordered)
                    }
                    if let undoMessage = turn.undoMessage {
                        Label(undoMessage, systemImage: "arrow.uturn.backward.circle.fill")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if !turn.sources.isEmpty {
                        sourcesChips(turn.sources)
                    }
                    if turn.latencyMs > 0 {
                        Text("\(turn.model) · \(turn.latencyMs) ms")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                Spacer(minLength: 60)
            }
            .padding(.horizontal)
        }
    }

    private func bubbleColor(_ turn: KitchenAssistantViewModel.ChatTurn) -> Color {
        if turn.actionError { return LariatTheme.bad.opacity(0.15) }
        if turn.isBlocked { return LariatTheme.warn.opacity(0.18) }
        if turn.actionExecuted { return LariatTheme.ok.opacity(0.12) }
        return Color.gray.opacity(0.12)
    }

    private func sourcesChips(_ sources: [AssistantContextSource]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(sources.enumerated()), id: \.offset) { _, source in
                    Text("\(source.type): \(source.detail)")
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Color.gray.opacity(0.12), in: Capsule())
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // ── composer + footer ───────────────────────────────────────────

    private var composer: some View {
        HStack(spacing: 8) {
            TextField(
                "Ask LaRi… (\"what's 86?\", \"86 the salmon\", \"scale chicken stock by 2\")",
                text: $model.input,
                axis: .vertical
            )
            .textFieldStyle(.roundedBorder)
            .lineLimit(1...4)
            .onSubmit { model.send() }
            Button {
                model.send()
            } label: {
                Image(systemName: "paperplane.fill")
            }
            .disabled(model.input.trimmingCharacters(in: .whitespaces).isEmpty || model.isThinking)
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    private var footer: some View {
        // route.js disclaimer — rides on every response; shown persistently.
        Text(model.disclaimer)
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.bottom, 6)
    }
}
