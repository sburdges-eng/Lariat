import SwiftUI
import LariatDB
import LariatModel

/// Allergen lookup — parity with `/allergen-lookup`. SAFETY-CRITICAL: chip
/// rendering is fail-loud. A product whose lookup failed shows a distinct
/// "allergens unknown — retry" chip and must NEVER read as "no allergens
/// flagged" on a kitchen line.
struct AllergenLookupView: View {
    @State private var vm: AllergenLookupViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase?) {
        _vm = State(wrappedValue: AllergenLookupViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        List {
            productSection
            attestationSection
        }
        .navigationTitle("Allergens")
        .searchable(text: $vm.query, prompt: "Product, brand, or barcode (8–14 digits)")
        .onSubmit(of: .search) { vm.runLookup() }
        .task { await vm.refreshAttestations() }
        .sheet(isPresented: $vm.showPinSheet) {
            if let writeDB = vm.writeDatabase {
                PinEntrySheet(database: writeDB) { user in
                    vm.pinStore.save(user: user)
                    vm.pinAccepted()
                }
            }
        }
    }

    // ── Product lookup section ──────────────────────────────────────────

    @ViewBuilder
    private var productSection: some View {
        Section("Product lookup") {
            switch vm.response {
            case .idle:
                Text("Type a product name, brand, or scan a barcode (8–14 digits) to check allergen status.")
                    .font(.caption).foregroundStyle(.secondary)
            case .loading:
                ProgressView("Looking up…")
            case .unavailable:
                Text(AllergenLookupViewModel.unavailableCopy)
                    .font(.caption)
            case .error(let message):
                Text(message).font(.caption).foregroundStyle(LariatTheme.bad)
            case .okEmpty:
                EmptyState(message: "No products matched.")
            case .okDirect(let card):
                productCard(card)
            case .okList(let cards):
                ForEach(cards) { card in
                    productCard(card)
                }
            }
        }
    }

    @ViewBuilder
    private func productCard(_ card: AllergenLookupViewModel.ProductCard) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(card.productName.isEmpty ? "(no product name)" : card.productName)
                .font(.headline)
            if !card.brand.isEmpty {
                Text(card.brand
                     + (card.brandOwner.isEmpty || card.brandOwner == card.brand
                        ? "" : " · \(card.brandOwner)"))
                    .font(.caption).foregroundStyle(.secondary)
            }

            chipRow(card)

            if !card.ingredientsText.isEmpty {
                DisclosureGroup("ingredients") {
                    Text(card.ingredientsText).font(.caption)
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            Text("code \(card.id)")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func chipRow(_ card: AllergenLookupViewModel.ProductCard) -> some View {
        // Fail-loud order: the error chip renders BEFORE the empty path so a
        // failed lookup can never read as a safe answer.
        if card.error {
            chip("⚠ allergens unknown — retry", tone: .unknown)
        } else if card.allergens.isEmpty && card.traces.isEmpty {
            chip("no allergens flagged", tone: .none)
        } else {
            FlowChips(
                allergens: card.allergens.map(AllergenLookupHelpers.cleanAllergenTag).filter { !$0.isEmpty },
                traces: card.traces.map(AllergenLookupHelpers.cleanAllergenTag).filter { !$0.isEmpty })
        }
    }

    private enum ChipTone { case allergen, trace, none, unknown }

    @ViewBuilder
    private func chip(_ label: String, tone: ChipTone) -> some View {
        Text(label)
            .font(.caption2.weight(tone == .allergen || tone == .unknown ? .semibold : .regular))
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(tone == .allergen ? LariatTheme.bad.opacity(0.85) : Color.clear, in: Capsule())
            .overlay(
                Capsule().strokeBorder(
                    tone == .allergen ? LariatTheme.bad
                        : tone == .trace ? LariatTheme.warn
                        : Color.secondary.opacity(0.6),
                    style: StrokeStyle(lineWidth: 1, dash: tone == .allergen ? [] : [3]))
            )
            .foregroundStyle(tone == .allergen ? Color.white
                             : tone == .trace ? LariatTheme.warn : Color.secondary)
            .accessibilityLabel(tone == .unknown ? "Allergen lookup failed for this product" : label)
    }

    /// Allergen (solid ember) + trace (dashed amber) chips, wrapped.
    private struct FlowChips: View {
        let allergens: [String]
        let traces: [String]

        var body: some View {
            VStack(alignment: .leading, spacing: 4) {
                if !allergens.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(allergens, id: \.self) { tag in
                            Text(tag)
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 8).padding(.vertical, 2)
                                .background(LariatTheme.bad.opacity(0.85), in: Capsule())
                                .foregroundStyle(.white)
                                .accessibilityLabel("Allergen: \(tag)")
                        }
                    }
                }
                if !traces.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(traces, id: \.self) { tag in
                            Text("trace · \(tag)")
                                .font(.caption2)
                                .padding(.horizontal, 8).padding(.vertical, 2)
                                .overlay(Capsule().strokeBorder(
                                    LariatTheme.warn, style: StrokeStyle(lineWidth: 1, dash: [3])))
                                .foregroundStyle(LariatTheme.warn)
                                .accessibilityLabel("May contain trace: \(tag)")
                        }
                    }
                }
            }
        }
    }

    // ── House-recipe attestation section ────────────────────────────────

    @ViewBuilder
    private var attestationSection: some View {
        Section {
            Text("Allergen lists below are inferred from ingredients unless a manager has attested them. Stale means the recipe changed after signoff.")
                .font(.caption).foregroundStyle(.secondary)

            if let err = vm.loadError {
                Text(err).font(.caption).foregroundStyle(LariatTheme.bad)
            } else if !vm.recipesLoaded {
                ProgressView("Loading recipes…")
            } else if vm.recipeRows.isEmpty {
                EmptyState(message: "No house recipes are ingested on this Mac.")
            } else {
                TextField("Filter recipes…", text: $vm.attestFilter)
                ForEach(vm.filteredRecipeRows) { recipe in
                    recipeRow(recipe)
                }
            }
        } header: {
            Text("House recipe allergens")
        }
    }

    @ViewBuilder
    private func recipeRow(_ recipe: RecipeAttestationStatus) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(recipe.name).font(.subheadline.weight(.semibold))
                Spacer()
                statusChip(recipe)
            }
            if recipe.heuristicAllergens.isEmpty {
                Text("no allergens flagged").font(.caption2).foregroundStyle(.secondary)
            } else {
                HStack(spacing: 6) {
                    ForEach(recipe.heuristicAllergens, id: \.self) { tag in
                        Text(tag)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(LariatTheme.bad.opacity(0.85), in: Capsule())
                            .foregroundStyle(.white)
                    }
                }
            }

            if vm.openSlug == recipe.recipeSlug {
                TextField("Manager name (required)", text: $vm.attestBy)
                TextField("Note (optional)", text: $vm.attestNote)
                if let err = vm.attestError {
                    Text(err).font(.caption).foregroundStyle(LariatTheme.bad)
                }
                HStack {
                    Button(vm.isSubmitting ? "Saving…" : "Confirm attestation") {
                        vm.submitAttestation(recipe)
                    }
                    .disabled(vm.isSubmitting
                              || vm.attestBy.trimmingCharacters(in: .whitespaces).isEmpty
                              || vm.writeDatabase == nil)
                    Button("Cancel") {
                        vm.openSlug = nil
                        vm.attestError = nil
                    }
                }
                .font(.caption)
                if vm.writeDatabase == nil {
                    Text("Write database unavailable — attestations are recorded on the office Mac.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            } else {
                Button("Attest allergen list (manager)") {
                    vm.openSlug = recipe.recipeSlug
                    vm.attestError = nil
                }
                .font(.caption)
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func statusChip(_ recipe: RecipeAttestationStatus) -> some View {
        switch recipe.status {
        case .attested:
            if let latest = recipe.latest {
                Text("✓ verified \(fmtTs(latest.createdAt)) by \(latest.attestedBy)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(LariatTheme.ok)
                    .accessibilityLabel("Allergens verified \(fmtTs(latest.createdAt)) by \(latest.attestedBy)")
            }
        case .stale:
            if let latest = recipe.latest {
                Text("⚠ stale — recipe changed since \(fmtTs(latest.createdAt)) (\(latest.attestedBy))")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(LariatTheme.warn)
                    .accessibilityLabel("Attestation stale — recipe changed since manager signoff")
            }
        case .unattested:
            Text("heuristic — unverified")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Allergen list is heuristic — not manager-verified")
        }
    }

    /// Web `fmtTs` — "YYYY-MM-DD HH:MM" from the SQLite timestamp.
    private func fmtTs(_ ts: String) -> String {
        String(ts.replacingOccurrences(of: "T", with: " ").prefix(16))
    }
}
