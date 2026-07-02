import Foundation
import GRDB

// Record types for the datapack-search board — row shapes mirror
// `lib/datapackSearch.ts` (`FtsHit`, `UsdaFood`, `UsdaNutrient`,
// `OffProduct`, `FdaSection`, `WikibooksPage`, `stats()`).

/// FTS source selector (`FtsSource`).
public enum DatapackSource: String, CaseIterable, Sendable, Equatable {
    case usda, off, wikibooks, fda, all

    /// The four concrete sources, in the web's display/group order.
    public static let concrete: [DatapackSource] = [.usda, .off, .wikibooks, .fda]

    /// Web dropdown labels (`SOURCE_OPTIONS` in DatapackSearchClient).
    public var label: String {
        switch self {
        case .all: return "All sources"
        case .usda: return "USDA Foods"
        case .off: return "Open Food Facts"
        case .wikibooks: return "Wikibooks Cookbook"
        case .fda: return "FDA Food Code"
        }
    }
}

/// One BM25 hit (`FtsHit`). `id` is stringified — fdc_id / page_id / rowid
/// are integers, the OFF GTIN code is text; `${source}:${id}` keys rows.
public struct DatapackFtsHit: Sendable, Equatable, Identifiable {
    /// BM25 score — LOWER is better (FTS5 convention; typically negative).
    public let score: Double
    public let source: DatapackSource
    public let hitId: String
    /// Display title (description / product name / page title / section title).
    public let title: String?
    /// Subtitle: food category / brands / slug / section_id.
    public let subtitle: String?
    /// Extra context: source archive / brand owner / source url / chapter-annex.
    public let extra: String?

    public var id: String { "\(source.rawValue):\(hitId)" }

    public init(score: Double, source: DatapackSource, hitId: String,
                title: String?, subtitle: String?, extra: String?) {
        self.score = score
        self.source = source
        self.hitId = hitId
        self.title = title
        self.subtitle = subtitle
        self.extra = extra
    }
}

public struct UsdaFood: Codable, FetchableRecord, Sendable, Equatable {
    public let fdcId: Int64
    public let dataType: String?
    public let sourceArchive: String?
    public let description: String?
    public let foodCategory: String?
    public let foodCategoryId: Int64?
    public let brandOwner: String?
    public let gtinUpc: String?
    public let ingredients: String?
    public let servingSize: Double?
    public let servingSizeUnit: String?

    enum CodingKeys: String, CodingKey {
        case fdcId = "fdc_id"
        case dataType = "data_type"
        case sourceArchive = "source_archive"
        case description
        case foodCategory = "food_category"
        case foodCategoryId = "food_category_id"
        case brandOwner = "brand_owner"
        case gtinUpc = "gtin_upc"
        case ingredients
        case servingSize = "serving_size"
        case servingSizeUnit = "serving_size_unit"
    }
}

public struct UsdaNutrient: Codable, FetchableRecord, Sendable, Equatable {
    public let nutrientId: Int64
    public let nutrientName: String?
    public let amount: Double?
    public let unitName: String?

    enum CodingKeys: String, CodingKey {
        case nutrientId = "nutrient_id"
        case nutrientName = "nutrient_name"
        case amount
        case unitName = "unit_name"
    }

    public init(nutrientId: Int64, nutrientName: String?, amount: Double?, unitName: String?) {
        self.nutrientId = nutrientId
        self.nutrientName = nutrientName
        self.amount = amount
        self.unitName = unitName
    }
}

public struct OffProduct: Codable, FetchableRecord, Sendable, Equatable {
    public let code: String
    public let productName: String?
    public let brands: String?
    public let brandOwner: String?
    public let ingredientsText: String?
    public let allergensTagsJson: String?
    public let tracesTagsJson: String?
    public let categoriesTagsJson: String?
    public let countriesEn: String?
    public let nutriscoreGrade: String?
    public let servingSize: String?
    public let sourceUrl: String?

    enum CodingKeys: String, CodingKey {
        case code
        case productName = "product_name"
        case brands
        case brandOwner = "brand_owner"
        case ingredientsText = "ingredients_text"
        case allergensTagsJson = "allergens_tags_json"
        case tracesTagsJson = "traces_tags_json"
        case categoriesTagsJson = "categories_tags_json"
        case countriesEn = "countries_en"
        case nutriscoreGrade = "nutriscore_grade"
        case servingSize = "serving_size"
        case sourceUrl = "source_url"
    }
}

public struct FdaSection: Codable, FetchableRecord, Sendable, Equatable {
    public let rowid: Int64
    public let sectionId: String?
    public let title: String?
    public let chapter: String?
    public let annex: String?
    public let body: String
    public let charCount: Int64?
    public let pageStart: Int64?
    public let pageEnd: Int64?

    enum CodingKeys: String, CodingKey {
        case rowid
        case sectionId = "section_id"
        case title, chapter, annex, body
        case charCount = "char_count"
        case pageStart = "page_start"
        case pageEnd = "page_end"
    }
}

public struct WikibooksPage: Codable, FetchableRecord, Sendable, Equatable {
    public let pageId: Int64
    public let title: String?
    public let slug: String?
    public let sourceUrl: String?
    public let isRedirect: Int64?
    public let redirectTarget: String?
    public let plainTextSummary: String?
    public let wikitextLength: Int64?
    public let categoriesJson: String?

    enum CodingKeys: String, CodingKey {
        case pageId = "page_id"
        case title, slug
        case sourceUrl = "source_url"
        case isRedirect = "is_redirect"
        case redirectTarget = "redirect_target"
        case plainTextSummary = "plain_text_summary"
        case wikitextLength = "wikitext_length"
        case categoriesJson = "categories_json"
    }
}

/// Row counts per indexed table (`stats()`).
public struct DatapackStats: Sendable, Equatable {
    public let sqlite: [String: Int]
    public let fts: [String: Int]

    public init(sqlite: [String: Int], fts: [String: Int]) {
        self.sqlite = sqlite
        self.fts = fts
    }
}
