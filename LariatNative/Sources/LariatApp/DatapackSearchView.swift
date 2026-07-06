import SwiftUI
import LariatDB
import LariatModel

/// Data-pack reference search — parity with `/datapack-search` (lexical
/// mode): BM25 over USDA Foods / Open Food Facts / Wikibooks Cookbook /
/// FDA Food Code, grouped results, per-row drill-in with cached collapse.
struct DatapackSearchView: View {
    @State private var vm: DatapackSearchViewModel

    init(datapack: DatapackRepository? = nil) {
        _vm = State(wrappedValue: DatapackSearchViewModel(datapack: datapack))
    }

    var body: some View {
        List {
            Section {
                Picker("Source", selection: $vm.source) {
                    ForEach([DatapackSource.all] + DatapackSource.concrete, id: \.self) { s in
                        Text(s.label).tag(s)
                    }
                }
                .onChange(of: vm.source) { vm.runSearch() }
            }

            switch vm.response {
            case .idle:
                Section {
                    Text("Enter a query to search the data pack.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            case .loading:
                Section { ProgressView("Searching…") }
            case .unavailable:
                Section {
                    Text(DatapackSearchViewModel.unavailableCopy).font(.caption)
                }
            case .error(let message):
                Section {
                    Text(message).font(.caption).foregroundStyle(LariatTheme.bad)
                }
            case .ok(let groups):
                if groups.isEmpty {
                    Section { EmptyState(message: "No hits.") }
                } else {
                    ForEach(groups) { group in
                        Section("\(group.source.label) · \(group.hits.count)") {
                            ForEach(group.hits) { hit in
                                hitRow(hit)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Reference")
        .searchable(text: $vm.query, prompt: "ingredient, brand, regulation…")
        .onSubmit(of: .search) { vm.runSearch() }
    }

    @ViewBuilder
    private func hitRow(_ hit: DatapackFtsHit) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                vm.toggleDetail(hit)
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(hit.title ?? "(no title)").font(.subheadline.weight(.semibold))
                    if let subtitle = hit.subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.caption).foregroundStyle(.secondary)
                    }
                    HStack(spacing: 8) {
                        if let extra = hit.extra, !extra.isEmpty {
                            Text(extra)
                        }
                        Text("score \(hit.score, specifier: "%.2f")")
                            .font(.system(.caption2, design: .monospaced))
                        Text("id \(hit.hitId)")
                            .font(.system(.caption2, design: .monospaced))
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(vm.isOpen(hit) ? [.isSelected] : [])

            if vm.isOpen(hit), let entry = vm.entry(for: hit) {
                Divider()
                detailPanel(entry)
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func detailPanel(_ entry: DatapackDetailEntry<DatapackSearchViewModel.Detail>) -> some View {
        switch entry {
        case .loading:
            ProgressView("Loading…")
        case .error(let message, _):
            Text(message).font(.caption).foregroundStyle(LariatTheme.bad)
        case .closed:
            EmptyView()
        case .ok(let detail):
            switch detail {
            case .usda(let food, let nutrients):
                usdaDetail(food, nutrients)
            case .off(let product):
                offDetail(product)
            case .fda(let section):
                fdaDetail(section)
            case .wikibooks(let page):
                wikibooksDetail(page)
            }
        }
    }

    @ViewBuilder
    private func usdaDetail(_ food: UsdaFood, _ nutrients: [UsdaNutrient]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(food.description ?? "(no description)").font(.caption.weight(.semibold))
            Text("fdc_id \(food.fdcId)"
                 + (food.foodCategory.map { " · \($0)" } ?? "")
                 + (food.brandOwner.map { " · \($0)" } ?? "")
                 + (food.sourceArchive.map { " · \($0)" } ?? ""))
                .font(.caption2).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        Group {
            let top = DatapackSearchCompute.pickTopNutrients(nutrients)
            if top.isEmpty {
                Text("No top-line nutrients reported.").font(.caption2).foregroundStyle(.secondary)
            } else {
                ForEach(top, id: \.nutrientId) { n in
                    HStack {
                        Text(n.nutrientName ?? "").foregroundStyle(.secondary)
                        Spacer()
                        Text("\(n.amount.map { JsValueFormat.numberString($0) } ?? "")\(n.unitName.map { " \($0)" } ?? "")")
                            .monospacedDigit()
                    }
                    .font(.caption2)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    @ViewBuilder
    private func offDetail(_ product: OffProduct) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(product.productName ?? "(no product name)").font(.caption.weight(.semibold))
            Text("code \(product.code)" + (product.brands.map { " · \($0)" } ?? ""))
                .font(.caption2).foregroundStyle(.secondary)
            if let ingredients = product.ingredientsText, !ingredients.isEmpty {
                Text("Ingredients").font(.caption2).foregroundStyle(.secondary)
                Text(ingredients).font(.caption2)
            }
            let allergens = AllergenLookupHelpers.parseAllergenTags(product.allergensTagsJson)
            if !allergens.isEmpty {
                Text("Allergens: " + allergens.joined(separator: ", ")).font(.caption2)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func fdaDetail(_ section: FdaSection) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            VStack(alignment: .leading, spacing: 2) {
                Text(section.title ?? "(no title)").font(.caption.weight(.semibold))
                Text((section.sectionId.map { "\($0) · " } ?? "")
                     + (section.chapter.map { "Ch. \($0)" } ?? "")
                     + (section.annex.map { "Annex \($0)" } ?? ""))
                    .font(.caption2).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            ScrollView {
                Text(section.body)
                    .font(.caption2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 240)
        }
    }

    @ViewBuilder
    private func wikibooksDetail(_ page: WikibooksPage) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            VStack(alignment: .leading, spacing: 4) {
                Text(page.title ?? "(no title)").font(.caption.weight(.semibold))
                if let slug = page.slug {
                    Text(slug).font(.caption2).foregroundStyle(.secondary)
                }
                if let summary = page.plainTextSummary, !summary.isEmpty {
                    Text(summary).font(.caption2)
                } else {
                    Text("No summary in index.").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .combine)
            if let urlString = page.sourceUrl, let url = URL(string: urlString) {
                Link(urlString, destination: url).font(.caption2)
            }
        }
    }
}
