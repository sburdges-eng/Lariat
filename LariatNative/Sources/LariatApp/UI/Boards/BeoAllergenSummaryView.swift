import SwiftUI
import LariatModel

/// The BEO board's "Allergens" tab — a read-only, per-event allergen summary
/// for the party's line items, sourced from the real `allergen_attestations`
/// system via `BeoAllergenSummaryCompute` (never Studio 5's hardcoded
/// matrix). SAFETY-CRITICAL: same fail-loud posture as `AllergenLookupView`
/// — a line item that never matched a recipe on file renders a distinct
/// "no recipe on file" flag and must NEVER read as "no allergens flagged".
struct BeoAllergenSummaryPanel: View {
    let rows: [BeoAllergenSummaryRow]
    let loading: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("Allergen lists below are inferred from ingredients unless a manager has attested them in the Allergens lookup. Stale means the recipe changed after signoff.")
                    .font(.caption).foregroundStyle(.secondary)

                if loading {
                    ProgressView("Loading allergen summary…")
                } else if rows.isEmpty {
                    EmptyState(message: "No line items on this event yet.")
                } else {
                    ForEach(rows) { row in
                        rowView(row)
                        Divider().overlay(LariatBrand.line)
                    }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func rowView(_ row: BeoAllergenSummaryRow) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(row.displayName).font(.subheadline.weight(.semibold))
                Spacer()
                statusChip(row)
            }

            if row.matched {
                if row.allergens.isEmpty {
                    Text("no allergens flagged").font(.caption2).foregroundStyle(.secondary)
                } else {
                    HStack(spacing: 6) {
                        ForEach(row.allergens, id: \.self) { tag in
                            Text(tag)
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 8).padding(.vertical, 2)
                                .background(LariatTheme.bad.opacity(0.85), in: Capsule())
                                .foregroundStyle(.white)
                                .accessibilityLabel("Allergen: \(tag)")
                        }
                    }
                }
            } else {
                Text("⚠ no recipe on file — allergens unknown")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(LariatTheme.bad)
                    .accessibilityLabel("Allergens unknown — \(row.itemName) did not match any recipe on file")
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func statusChip(_ row: BeoAllergenSummaryRow) -> some View {
        switch row.status {
        case .attested:
            Text("✓ verified").font(.caption2.weight(.semibold)).foregroundStyle(LariatTheme.ok)
        case .stale:
            Text("⚠ stale").font(.caption2.weight(.semibold)).foregroundStyle(LariatTheme.warn)
        case .unattested:
            Text("heuristic — unverified").font(.caption2).foregroundStyle(.secondary)
        case nil:
            Text("⚠ no recipe on file").font(.caption2.weight(.semibold)).foregroundStyle(LariatTheme.bad)
        }
    }
}
