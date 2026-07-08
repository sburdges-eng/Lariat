import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `safety.allergenLookup` — parity with `/allergen-lookup`
/// (`AllergenLookupClient` + `RecipeAttestations`). SAFETY-CRITICAL posture:
/// a failed per-product lookup must NEVER collapse into "no allergens
/// flagged" — the card renders a distinct "allergens unknown — retry" state.
@Observable @MainActor
final class AllergenLookupViewModel {
    /// One product card (web `ProductCard` props).
    struct ProductCard: Identifiable, Equatable {
        let id: String            // OFF code
        var productName: String
        var brand: String
        var brandOwner: String
        var allergens: [String]
        var traces: [String]
        var ingredientsText: String
        /// Fail-loud flag: chip fetch failed — render UnknownChip, never
        /// the "no allergens flagged" chip.
        var error = false
    }

    enum LookupResponse: Equatable {
        case idle
        case loading
        case unavailable
        case error(String)
        case okEmpty
        case okDirect(ProductCard)
        case okList([ProductCard])
    }

    static let unavailableCopy =
        "Reference data is not installed on this Mac. Ask a manager to finish setup."

    var query = ""
    private(set) var response: LookupResponse = .idle

    // ── Attestation panel state ─────────────────────────────────────────
    private(set) var recipeRows: [RecipeAttestationStatus] = []
    private(set) var recipesLoaded = false
    var attestFilter = ""
    var openSlug: String?
    var attestBy = ""
    var attestNote = ""
    var attestError: String?
    var isSubmitting = false
    var showPinSheet = false
    var loadError: String?

    let pinStore: PinSessionStore
    private let datapack: DatapackRepository
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?
    private let locationId: String
    private let loadRecipes: () -> [AllergenRecipe]
    private var recipes: [AllergenRecipe] = []
    private var pendingAction: (() -> Void)?

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase?,
        datapack: DatapackRepository? = nil,
        pinStore: PinSessionStore? = nil,
        locationId: String = LocationScope.resolve(),
        loadRecipes: @escaping () -> [AllergenRecipe] = { AllergenRecipeLoader.load() }
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.datapack = datapack ?? DatapackRepository()
        self.pinStore = pinStore ?? PinSessionStore.shared
        self.locationId = locationId
        self.loadRecipes = loadRecipes
    }

    var writeDatabase: LariatWriteDatabase? { writeDB }
    var datapackAvailable: Bool { datapack.isAvailable }

    private var attestRepo: AllergenAttestationRepository {
        AllergenAttestationRepository(readDB: readDB, writeDB: writeDB)
    }

    // ── Product lookup ──────────────────────────────────────────────────

    func runLookup() {
        guard datapack.isAvailable else {
            response = .unavailable
            return
        }
        switch AllergenLookupHelpers.route(for: query) {
        case .blank:
            response = .idle

        case .offProduct(let code):
            response = .loading
            do {
                guard let product = try datapack.offProduct(code: code) else {
                    response = .okEmpty
                    return
                }
                response = .okDirect(card(from: product))
            } catch {
                response = .error("Lookup failed: \(error.localizedDescription)")
            }

        case .search(let q, let limit):
            response = .loading
            do {
                let hits = try datapack.fts(
                    DatapackSearchCompute.escapeFtsPhrase(q), source: .off, limit: limit)
                if hits.isEmpty {
                    response = .okEmpty
                    return
                }
                // Per-row product resolution. A failed row flags error=true
                // (fail-loud UnknownChip) — never an empty allergen list.
                let cards = hits.map { hit -> ProductCard in
                    do {
                        if let product = try datapack.offProduct(code: hit.hitId) {
                            return card(from: product)
                        }
                    } catch { /* fall through to the unknown card */ }
                    return ProductCard(
                        id: hit.hitId,
                        productName: hit.title ?? "",
                        brand: hit.subtitle ?? "",
                        brandOwner: hit.extra ?? "",
                        allergens: [], traces: [], ingredientsText: "",
                        error: true)
                }
                response = .okList(cards)
            } catch {
                response = .error("Search failed: \(error.localizedDescription)")
            }
        }
    }

    private func card(from product: OffProduct) -> ProductCard {
        ProductCard(
            id: product.code,
            productName: product.productName ?? "",
            brand: product.brands ?? "",
            brandOwner: product.brandOwner ?? "",
            allergens: AllergenLookupHelpers.parseAllergenTags(product.allergensTagsJson),
            traces: AllergenLookupHelpers.parseAllergenTags(product.tracesTagsJson),
            ingredientsText: product.ingredientsText ?? "")
    }

    // ── Attestation panel ───────────────────────────────────────────────

    var filteredRecipeRows: [RecipeAttestationStatus] {
        let q = attestFilter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return recipeRows }
        return recipeRows.filter {
            $0.name.lowercased().contains(q) || $0.recipeSlug.lowercased().contains(q)
        }
    }

    func refreshAttestations() async {
        recipes = loadRecipes()
        do {
            recipeRows = try await attestRepo.statuses(locationId: locationId, recipes: recipes)
            loadError = nil
        } catch {
            loadError = "Could not load allergen attestations"
        }
        recipesLoaded = true
    }

    func submitAttestation(_ recipe: RecipeAttestationStatus) {
        attestError = nil
        guard let session = pinStore.session, session.isValid else {
            pendingAction = { self.submitAttestation(recipe) }
            showPinSheet = true
            return
        }
        guard let writeDB else {
            attestError = "Could not open the write database"
            return
        }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            let user = try ManagementWrite().requireSession(pinStore.session)
            let context = RegulatedWriteContext.nativeMac(pinUser: user)
            _ = try attestRepo.record(
                .init(recipeSlug: recipe.recipeSlug,
                      allergens: recipe.heuristicAllergens,
                      attestedBy: attestBy,
                      note: attestNote.isEmpty ? nil : attestNote),
                recipes: recipes,
                locationId: locationId,
                context: context)
            openSlug = nil
            attestNote = ""
            Task { await refreshAttestations() }
        } catch {
            if let e = error as? AllergenAttestationWriteError {
                attestError = e.errorDescription
            } else {
                attestError = WriteErrorMapper.message(for: error)
            }
        }
    }

    func pinAccepted() {
        showPinSheet = false
        let pending = pendingAction
        pendingAction = nil
        pending?()
    }
}
