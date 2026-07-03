import SwiftUI
import LariatDB
import LariatModel
import Observation

// MARK: - ViewModel

/// Backs `costing.components` — the dish-components editor
/// (`app/menu-engineering/components/page.tsx` + `ComponentEditor.jsx`).
/// Per-serving quantities of every component a dish pulls: sub-recipes AND
/// raw distributor items. These rows feed the cost roll-up on the
/// menu-performance hub and the costing overview.
///
/// Client-side rules ported from ComponentEditor.jsx: dish name required,
/// per-dish duplicate detection on (componentType, recipeSlug |
/// vendorIngredient lowered), per-row validation messages verbatim. The
/// server-side rules (validateDishComponent + normalize + clip) live in
/// `DishComponentValidation` / `DishComponentsRepository` and throw typed
/// errors BEFORE any write.
@Observable @MainActor final class DishComponentsViewModel {
    struct RowDraft: Identifiable {
        let id = UUID()
        var componentType = "recipe"        // "recipe" | "vendor_item"
        var recipeSlug = ""
        var vendorIngredient = ""
        var qty = ""
        var unit = "oz"
        var notes = ""
    }

    var components: [DishComponentEditorRow] = []
    var recipes: [BridgeRecipe] = []
    var distributors: [DishComponentsRepository.DistributorCandidate] = []
    var coverage: DishCoverageReport?

    var dishName = ""
    var rows: [RowDraft] = [RowDraft()]
    var saving = false
    var formError = ""
    var rowErrors: [UUID: String] = [:]

    var errorText: String?
    var isLoading = true
    var query = ""

    /// False when the write DB failed to open — the view swaps the builder
    /// for a read-only banner and hides delete, instead of letting a full
    /// multi-row dish build fail per-row at save time.
    let canWrite: Bool

    private let poller = BoardPoller()
    private let repo: DishComponentsRepository
    private let hubRepo: MenuEngineeringRepository

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase?,
         locationId: String = LocationScope.resolve()) {
        self.canWrite = writeDB != nil
        self.repo = DishComponentsRepository(readDB: readDB, writeDB: writeDB, locationId: locationId)
        self.hubRepo = MenuEngineeringRepository(database: readDB, locationId: locationId)
        self.recipes = DishBridgeRecipeLoader.load().sorted { $0.name < $1.name }
    }

    func start() {
        // 5 s poll — slower than read-only boards so mid-edit
        // refreshes stay unobtrusive (form state is never touched).
        poller.start(interval: .seconds(5)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.errorText)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        do {
            components = try await repo.list()
            distributors = try await repo.distributorCandidates()
            let bundle = try await hubRepo.fetch()
            let map = DishCostBridge.buildDishComponentMap(
                recipes: recipes,
                recipeCosts: bundle.bridgeInputs.recipeCosts,
                vendorPrices: bundle.bridgeInputs.vendorPrices,
                orderGuideItems: bundle.bridgeInputs.orderGuideItems,
                dishComponents: bundle.bridgeInputs.dishComponents)
            coverage = DishCostBridge.computeDishCoverage(sales: bundle.sales, map: map)
            errorText = nil
            isLoading = false
        } catch {
            errorText = "Fetch error: \(error.localizedDescription)"
            isLoading = false
        }
    }

    // ── grouped/filtered read models ────────────────────────────────────────

    var groupedComponents: [(dish: String, rows: [DishComponentEditorRow])] {
        var order: [String] = []
        var byDish: [String: [DishComponentEditorRow]] = [:]
        for c in components {
            if byDish[c.dishName] == nil { order.append(c.dishName) }
            byDish[c.dishName, default: []].append(c)
        }
        return order.sorted().map { ($0, byDish[$0] ?? []) }
    }

    var visibleGroups: [(dish: String, rows: [DishComponentEditorRow])] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return groupedComponents }
        return groupedComponents.filter { $0.dish.lowercased().contains(q) }
    }

    /// Dish suggestions: unlinked + declared-only + already-edited dishes
    /// (ComponentEditor.jsx candidateDishes).
    var candidateDishes: [String] {
        var set = Set<String>()
        for d in coverage?.unlinkedDishes ?? [] { set.insert(d.itemName) }
        for d in coverage?.declaredOnlyDishes ?? [] { set.insert(d.itemName) }
        for c in components { set.insert(c.dishName) }
        return set.sorted()
    }

    /// Existing rows whose canonical name matches the typed dish
    /// (ComponentEditor.jsx existingForDish — alphanumeric-collapse match).
    var existingForDish: [DishComponentEditorRow] {
        let norm = DishCostBridge.normalizeDishName(dishName)
        guard !norm.isEmpty else { return [] }
        return components.filter { DishCostBridge.normalizeDishName($0.dishName) == norm }
    }

    // ── form actions (ComponentEditor.jsx) ──────────────────────────────────

    func addRow() { rows.append(RowDraft()) }

    func removeRow(_ id: UUID) {
        if rows.count == 1 { rows = [RowDraft()] }
        else { rows.removeAll { $0.id == id } }
    }

    func loadExistingIntoRows() {
        guard !existingForDish.isEmpty else { return }
        rows = existingForDish.map(rowFromComponent)
        formError = ""
        rowErrors = [:]
    }

    func editDish(_ dish: String) {
        dishName = dish
        let rowsForDish = components.filter { $0.dishName == dish }.map(rowFromComponent)
        rows = rowsForDish.isEmpty ? [RowDraft()] : rowsForDish
        formError = ""
        rowErrors = [:]
    }

    private func rowFromComponent(_ c: DishComponentEditorRow) -> RowDraft {
        var r = RowDraft()
        r.componentType = c.componentType
        r.recipeSlug = c.recipeSlug ?? ""
        r.vendorIngredient = c.vendorIngredient ?? ""
        r.qty = c.qtyPerServing.formatted(.number.grouping(.never))
        r.unit = c.unit
        r.notes = c.notes ?? ""
        return r
    }

    /// ComponentEditor.jsx validateRow — messages verbatim.
    private func validateRow(_ r: RowDraft) -> String? {
        if r.componentType == "recipe" {
            if r.recipeSlug.isEmpty { return "Choose a recipe." }
        } else {
            if r.vendorIngredient.trimmingCharacters(in: .whitespaces).isEmpty {
                return "Choose a distributor item."
            }
        }
        if r.qty.isEmpty { return "Qty required." }
        guard let n = Double(r.qty), n.isFinite, n > 0 else { return "Qty must be positive." }
        if r.unit.trimmingCharacters(in: .whitespaces).isEmpty { return "Unit required." }
        return nil
    }

    private func dupKey(_ r: RowDraft) -> String {
        r.componentType == "recipe"
            ? "recipe:\(r.recipeSlug)"
            : "vendor:\(r.vendorIngredient.lowercased().trimmingCharacters(in: .whitespaces))"
    }

    /// ComponentEditor.jsx saveAll: client validation (incl. per-dish dedupe),
    /// then one repository upsert per row; per-row failures keep the row and
    /// show the typed error's message.
    func saveAll() async {
        guard !saving else { return }
        formError = ""
        rowErrors = [:]

        if dishName.trimmingCharacters(in: .whitespaces).isEmpty {
            formError = "Dish name required."
            return
        }
        var seen = Set<String>()
        var errs: [UUID: String] = [:]
        for r in rows {
            let filled = (r.componentType == "recipe" && !r.recipeSlug.isEmpty)
                || (r.componentType == "vendor_item" && !r.vendorIngredient.isEmpty)
            let k = dupKey(r)
            if filled && seen.contains(k) {
                errs[r.id] = "Duplicate component in this dish."
            } else if filled {
                seen.insert(k)
            }
            if let msg = validateRow(r), errs[r.id] == nil { errs[r.id] = msg }
        }
        if !errs.isEmpty {
            rowErrors = errs
            formError = "Fix the highlighted rows."
            return
        }

        saving = true
        defer { saving = false }
        var savedCount = 0
        var rowFails: [UUID: String] = [:]
        for r in rows {
            let draft = DishComponentDraft(
                dishName: dishName.trimmingCharacters(in: .whitespaces),
                componentType: r.componentType,
                recipeSlug: r.componentType == "recipe" ? r.recipeSlug : nil,
                vendorIngredient: r.componentType == "vendor_item"
                    ? r.vendorIngredient.trimmingCharacters(in: .whitespaces) : nil,
                qtyPerServing: Double(r.qty) ?? .nan,
                unit: r.unit.trimmingCharacters(in: .whitespaces),
                notes: r.notes.trimmingCharacters(in: .whitespaces).isEmpty
                    ? nil : r.notes.trimmingCharacters(in: .whitespaces))
            do {
                _ = try repo.upsert(draft)
                savedCount += 1
            } catch {
                rowFails[r.id] = WriteErrorMapper.message(for: error)
            }
        }

        if rowFails.isEmpty {
            dishName = ""
            rows = [RowDraft()]
        } else {
            rowErrors = rowFails
            formError = "Saved \(savedCount) of \(rows.count). Fix failed rows and Save again."
        }
        await refresh()
    }

    func delete(id: Int64) async {
        do {
            try repo.delete(id: id)
            await refresh()
        } catch {
            formError = WriteErrorMapper.message(for: error)
        }
    }
}

// MARK: - Root view

struct DishComponentsView: View {
    @State private var vm: DishComponentsViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase?) {
        _vm = State(wrappedValue: DishComponentsViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.errorText, vm.components.isEmpty {
                TileDegrade(
                    title: "Database unavailable",
                    message: err,
                    systemImage: "externaldrive.badge.xmark"
                )
            } else if vm.isLoading {
                ProgressView("Loading dish components…")
            } else {
                DishComponentsContentView(vm: vm)
            }
        }
        .navigationTitle("Dish components")
        .searchable(text: Binding(get: { vm.query }, set: { vm.query = $0 }), prompt: "Find a dish")
        .task { vm.start() }
        .onDisappear { vm.stop() }
    }
}

// MARK: - Content

private struct DishComponentsContentView: View {
    @Bindable var vm: DishComponentsViewModel

    /// ComponentEditor.jsx COMMON_UNITS.
    private static let commonUnits = ["oz", "g", "lb", "tsp", "tbsp", "cup", "fl oz", "qt", "gal", "each"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Per-serving quantities of every component a dish pulls — sub-recipes (bacon_jam, lariat_rub) AND raw distributor items (buns, patties, cheese slices). These rows feed the cost roll-up on Menu performance and Costing.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                if let c = vm.coverage {
                    (Text("\(c.totalSalesDishes)").bold() + Text(" dishes appear in sales. ")
                        + Text("\(c.fullyLinked)").bold() + Text(" have full per-serving data. ")
                        + Text("\(c.partial + c.declaredOnly)").bold() + Text(" need quantities. ")
                        + Text("\(c.unlinked)").bold() + Text(" have no recipe link at all."))
                        .font(.caption)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
                        .padding(.horizontal)
                }

                if vm.canWrite {
                    builderCard
                        .padding(.horizontal)
                } else {
                    readOnlyBanner
                        .padding(.horizontal)
                }

                existingCard
                    .padding(.horizontal)
            }
            .padding(.vertical)
        }
    }

    /// Shown in place of the builder when the write DB failed to open —
    /// mirrors the purchasing modules' lock-tile degrade, but keeps the
    /// read-only components list below usable.
    private var readOnlyBanner: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("Write database unavailable — read-only", systemImage: "lock")
                .font(.caption)
                .bold()
                .foregroundStyle(LariatTheme.warn)
            Text("The dish builder and delete actions are disabled until the app can open the write database. The existing components below are still current.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(LariatTheme.warn, lineWidth: 1))
    }

    // ── Build a dish (ComponentEditor.jsx form) ─────────────────────────────

    private var builderCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Build a dish")
                .font(.caption)
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .tracking(2)

            HStack(spacing: 8) {
                TextField("Dish name — e.g. ROPE BURGER", text: $vm.dishName)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 340)
                if !vm.candidateDishes.isEmpty {
                    Menu("Suggestions") {
                        ForEach(vm.candidateDishes, id: \.self) { d in
                            Button(d) { vm.dishName = d }
                        }
                    }
                    .frame(maxWidth: 160)
                }
                if !vm.existingForDish.isEmpty {
                    Button("Load \(vm.existingForDish.count) existing") {
                        vm.loadExistingIntoRows()
                    }
                }
                Spacer()
            }

            Text("Components — sub-recipes AND raw distributor items (buns, patties, cheese)")
                .font(.caption2)
                .foregroundStyle(.secondary)

            ForEach($vm.rows) { $row in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Picker("Type", selection: $row.componentType) {
                            Text("Sub-recipe").tag("recipe")
                            Text("Distributor").tag("vendor_item")
                        }
                        .labelsHidden()
                        .frame(width: 130)
                        .onChange(of: row.componentType) { _, _ in
                            row.recipeSlug = ""
                            row.vendorIngredient = ""
                        }

                        if row.componentType == "recipe" {
                            Picker("Recipe", selection: $row.recipeSlug) {
                                Text("— choose recipe —").tag("")
                                ForEach(vm.recipes, id: \.slug) { rc in
                                    Text(rc.name).tag(rc.slug)
                                }
                            }
                            .labelsHidden()
                            .frame(maxWidth: 260)
                        } else {
                            TextField("e.g. Brioche Bun, 8oz Burger Patty", text: $row.vendorIngredient)
                                .textFieldStyle(.roundedBorder)
                                .frame(maxWidth: 220)
                            if !vm.distributors.isEmpty {
                                Menu("Pick") {
                                    ForEach(vm.distributors, id: \.ingredient) { d in
                                        Button(distributorLabel(d)) { row.vendorIngredient = d.ingredient }
                                    }
                                }
                                .frame(width: 70)
                            }
                        }

                        TextField("qty", text: $row.qty)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 70)
                        TextField("unit", text: $row.unit)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 70)
                        Menu("Units") {
                            ForEach(Self.commonUnits, id: \.self) { u in
                                Button(u) { row.unit = u }
                            }
                        }
                        .frame(width: 70)
                        TextField("notes (optional)", text: $row.notes)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 180)
                        Button {
                            vm.removeRow(row.id)
                        } label: {
                            Image(systemName: "xmark.circle")
                        }
                        .buttonStyle(.plain)
                        .help("Remove this component")
                    }
                    if let err = vm.rowErrors[row.id] {
                        Text(err)
                            .font(.caption2)
                            .foregroundStyle(LariatTheme.bad)
                    }
                }
            }

            HStack(spacing: 10) {
                Button("+ Add component") { vm.addRow() }
                Button {
                    Task { await vm.saveAll() }
                } label: {
                    Text(vm.saving
                         ? "Saving…"
                         : "Save \(vm.rows.count) component\(vm.rows.count == 1 ? "" : "s")")
                }
                .buttonStyle(.borderedProminent)
                .disabled(vm.saving)
                if !vm.formError.isEmpty {
                    Text(vm.formError)
                        .font(.caption)
                        .foregroundStyle(LariatTheme.bad)
                }
            }

            Text("Distributor items pull pricing from vendor_prices (preferred) or order_guide_items — pick one with $ if you can. Saving (dish, component) pairs upserts existing rows. Dish names stored canonical (lowercase + alphanumeric); the editor matches case-insensitively.")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }

    private func distributorLabel(_ d: DishComponentsRepository.DistributorCandidate) -> String {
        if let price = d.unitPrice {
            return "\(d.ingredient) — \(d.vendor ?? "—") · \(formatDollars(price, decimals: 3))/\(d.packUnit ?? "?")"
        }
        return "\(d.ingredient) — \(d.vendor ?? "—") · no price"
    }

    // ── Existing components table ───────────────────────────────────────────

    private var existingCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Existing components (\(vm.components.count))")
                .font(.caption)
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .tracking(2)

            if vm.groupedComponents.isEmpty {
                EmptyState(message: "No dish_components rows yet.", systemImage: "fork.knife")
            } else if vm.visibleGroups.isEmpty {
                EmptyState(message: "No dishes match the search.", systemImage: "magnifyingglass")
            } else {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(vm.visibleGroups, id: \.dish) { group in
                        // Read-only session: the builder is hidden, so the
                        // dish name is a plain header instead of an edit link.
                        if vm.canWrite {
                            Button {
                                vm.editDish(group.dish)
                            } label: {
                                Text(group.dish)
                                    .font(.subheadline)
                                    .bold()
                            }
                            .buttonStyle(.plain)
                            .help("Load into builder to edit all components")
                            .padding(.top, 8)
                        } else {
                            Text(group.dish)
                                .font(.subheadline)
                                .bold()
                                .padding(.top, 8)
                        }

                        ForEach(group.rows) { c in
                            HStack(spacing: 10) {
                                Text(c.componentType == "vendor_item" ? "distributor" : "recipe")
                                    .font(.caption2)
                                    .bold()
                                    .foregroundStyle(c.componentType == "vendor_item" ? .blue : LariatTheme.ok)
                                    .frame(width: 70, alignment: .leading)
                                Text(c.recipeSlug ?? c.vendorIngredient ?? "")
                                    .font(.caption)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                Text("\(c.qtyPerServing.formatted()) \(c.unit)")
                                    .font(.caption)
                                    .monospacedDigit()
                                Text(c.notes ?? "—")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .frame(maxWidth: 160, alignment: .leading)
                                Text(String((c.updatedAt ?? "").prefix(16)))
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                                if vm.canWrite {
                                    Button(role: .destructive) {
                                        Task { await vm.delete(id: c.id) }
                                    } label: {
                                        Image(systemName: "trash")
                                    }
                                    .buttonStyle(.plain)
                                    .help("Delete")
                                }
                            }
                            .padding(.vertical, 3)
                            Divider()
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }
}
