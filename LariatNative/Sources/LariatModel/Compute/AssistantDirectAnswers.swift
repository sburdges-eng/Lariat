import Foundation

/// Port of `lib/assistantDirectAnswers.ts` — deterministic pre-LLM answers
/// for the lookups the model keeps fumbling (2026-08-31 venue failures: the
/// model denied an in-context ingredient quantity 3/3, guessed nonexistent
/// slugs, and dead-ended recipe questions into the deferred db_query).
///
/// Same rationale as the Q-vs-C classifier (#248): routing AND bread-and-
/// butter lookups belong in deterministic code; the LLM handles judgment,
/// conversation, and everything ambiguous. Allergen-intent questions ALWAYS
/// fall through — escalation wording is the model's regulated job.
///
/// Keep answer strings byte-identical with the web twin.
public enum AssistantDirectAnswers {

    public struct DirectAnswer: Equatable, Sendable {
        public let answer: String
        public let sourceDetail: String
    }

    // MARK: - Intent gates (mirror the TS regexes)

    private static let allergenIntent = try! NSRegularExpression(
        pattern: "allerg|gluten|dairy|celiac|shellfish|peanut|tree ?nut|nut[- ]free|soy\\b|sesame|\\bsafe\\b|\\begg[- ]free\\b",
        options: [.caseInsensitive])

    private static let qtyIntent = try! NSRegularExpression(
        pattern: "\\bhow (much|many)\\b|\\bwhat(?: is|'s)? the (amount|quantity)\\b|\\bqty\\b",
        options: [.caseInsensitive])

    private static let cardIntent = try! NSRegularExpression(
        pattern: "\\brecipes?\\b|\\bcard\\b|\\bingredients?\\b|what'?s in\\b|whats in\\b|\\bhow (?:do|to) (?:i |you )?(?:make|prep|build)\\b|\\bshow\\b",
        options: [.caseInsensitive])

    /// Explicit retrieval phrasing wants semantic search, not a card dump.
    private static let retrievalIntent = try! NSRegularExpression(
        pattern: "\\b(find|search|look (?:up|for))\\b",
        options: [.caseInsensitive])

    private static let bookIntent = try! NSRegularExpression(
        pattern: "recipe book|reccipe book|recipe list|list of recipes|what recipes|which recipes|all recipes|all the recipes",
        options: [.caseInsensitive])

    private static func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, options: [], range: NSRange(s.startIndex..., in: s)) != nil
    }

    // MARK: - Normalization (mirror normalizeWord / normalizeText)

    static let stopwords: Set<String> = [
        "how", "much", "many", "what", "whats", "the", "a", "an", "in", "of", "on",
        "for", "with", "to", "i", "you", "we", "do", "does", "is", "are", "it",
        "its", "recipe", "recipes", "card", "show", "me", "use", "uses", "need",
        "needs", "whole", "make", "makes", "amount", "quantity", "qty", "there",
        "and", "please", "hey", "lari",
    ]

    static let unitWords: Set<String> = [
        "cup", "cups", "lb", "lbs", "pound", "pounds", "oz", "ounce", "ounces",
        "qt", "quart", "quarts", "gal", "gallon", "gallons", "tsp", "tbsp",
        "teaspoon", "teaspoons", "tablespoon", "tablespoons", "g", "gram", "grams",
        "kg", "ml", "l", "liter", "liters", "bag", "bags", "can", "cans", "each", "ea",
    ]

    static func normalizeWord(_ w: String) -> String {
        let bare = w.lowercased()
            .folding(options: .diacriticInsensitive, locale: Locale(identifier: "en_US"))
        if bare == "chilli" || bare == "chile" || bare == "chiles" || bare == "chillis" {
            return "chili"
        }
        return bare
    }

    static func normalizeText(_ s: String) -> String {
        s.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .map { normalizeWord(String($0)) }
            .joined(separator: " ")
    }

    private static func containsPhrase(_ haystack: String, _ phrase: String) -> Bool {
        guard !phrase.isEmpty else { return false }
        return (" " + haystack + " ").contains(" " + phrase + " ")
    }

    // MARK: - Recipe resolution (mirror findRecipe)

    struct RecipeMatch {
        let recipe: AssistantRecipe
        let matchedPhrase: String
    }

    /// Candidate vocabulary of one recipe: name + menu items + slug, tokenized.
    private static func recipeTokenVocab(_ r: AssistantRecipe) -> Set<String> {
        var vocab = Set<String>()
        var candidates = [r.name ?? ""]
        candidates.append(contentsOf: r.menuItems ?? [])
        candidates.append((r.slug ?? "").replacingOccurrences(of: "_", with: " "))
        for c in candidates {
            for t in normalizeText(c).split(separator: " ").map(String.init)
            where t.count >= 4 && !stopwords.contains(t) && !unitWords.contains(t) {
                vocab.insert(t)
            }
        }
        return vocab
    }

    static func findRecipe(question: String, recipes: [AssistantRecipe]) -> RecipeMatch? {
        let q = normalizeText(question)
        var best: RecipeMatch?
        var bestLen = 0
        var ambiguous = false

        for r in recipes {
            var candidates = [r.name ?? ""]
            candidates.append(contentsOf: r.menuItems ?? [])
            candidates.append((r.slug ?? "").replacingOccurrences(of: "_", with: " "))
            for c in candidates {
                let phrase = normalizeText(c)
                if phrase.count < 4 { continue }
                if !containsPhrase(q, phrase) { continue }
                if phrase.count > bestLen {
                    best = RecipeMatch(recipe: r, matchedPhrase: phrase)
                    bestLen = phrase.count
                    ambiguous = false
                } else if phrase.count == bestLen, let b = best, b.recipe.slug != r.slug {
                    ambiguous = true
                }
            }
        }
        if best != nil || ambiguous { return ambiguous ? nil : best }

        // Distinctive-token fallback (2026-08-31 "pico" find): a token owned
        // by exactly ONE recipe's vocabulary identifies it; shared tokens
        // ("tacos") stay ambiguous and fall through to the LLM.
        let qTokens = q.split(separator: " ").map(String.init)
            .filter { $0.count >= 4 && !stopwords.contains($0) && !unitWords.contains($0) }
        var hits: [String: (recipe: AssistantRecipe, tokens: [String])] = [:]
        var order: [String] = []
        for t in qTokens {
            var owner: AssistantRecipe?
            var unique = true
            for r in recipes where recipeTokenVocab(r).contains(t) {
                if let o = owner, o.slug != r.slug { unique = false; break }
                owner = r
            }
            guard let owner, unique else { continue }
            let key = owner.slug ?? owner.name ?? ""
            if hits[key] == nil { order.append(key) }
            hits[key, default: (owner, [])].tokens.append(t)
        }
        if hits.count == 1, let key = order.first, let only = hits[key] {
            return RecipeMatch(recipe: only.recipe, matchedPhrase: only.tokens.joined(separator: " "))
        }
        return nil
    }

    // MARK: - Rendering (byte parity with the TS renderers)

    private static func fmtQty(_ qty: JSONNumberOrString?) -> String {
        qty?.display ?? ""
    }

    private static func ingredientLine(_ i: AssistantRecipe.Ingredient) -> String {
        let qty = fmtQty(i.qty)
        let unit = (i.unit ?? "").trimmingCharacters(in: .whitespaces)
        let amount = [qty, unit].filter { !$0.isEmpty }.joined(separator: " ")
        let item = i.item ?? ""
        return amount.isEmpty ? item : "\(item) — \(amount)"
    }

    private static func yieldText(_ r: AssistantRecipe) -> String {
        let qty = fmtQty(r.yieldQty)
        let unit = (r.yieldUnit ?? "").trimmingCharacters(in: .whitespaces)
        let y = [qty, unit].filter { !$0.isEmpty }.joined(separator: " ")
        return y.isEmpty ? "" : "makes \(y)"
    }

    private static func headerLine(_ r: AssistantRecipe) -> String {
        let title = r.name ?? r.slug ?? "Recipe"
        let tail = [yieldText(r), (r.station ?? "").trimmingCharacters(in: .whitespaces)]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        return tail.isEmpty ? title : "\(title) — \(tail)"
    }

    private static func tagsLine(_ r: AssistantRecipe) -> String {
        let tags = (r.allergens ?? []).filter { !$0.isEmpty }
        return tags.isEmpty
            ? "Tags: none listed — check with a manager."
            : "Tags: \(tags.joined(separator: ", "))"
    }

    private static func renderCard(_ r: AssistantRecipe) -> String {
        var lines = [headerLine(r), "Ingredients:"]
        for i in r.ingredients ?? [] { lines.append("• \(ingredientLine(i))") }
        if let subs = r.subRecipes, !subs.isEmpty {
            lines.append("Sub-recipes: \(subs.joined(separator: ", "))")
        }
        lines.append(tagsLine(r))
        return lines.joined(separator: "\n")
    }

    private static func renderQuantity(_ r: AssistantRecipe, hits: [AssistantRecipe.Ingredient]) -> String {
        if hits.count == 1 {
            let amount = ingredientLine(hits[0])
            let y = yieldText(r)
            return y.isEmpty
                ? "\(r.name ?? ""): \(amount)."
                : "\(r.name ?? ""): \(amount) (whole recipe \(y))."
        }
        var lines = [headerLine(r) + ":"]
        for h in hits { lines.append("• \(ingredientLine(h))") }
        return lines.joined(separator: "\n")
    }

    private static func renderBook(_ recipes: [AssistantRecipe]) -> String {
        var byStation: [String: [String]] = [:]
        var order: [String] = []
        for r in recipes {
            var st = (r.station ?? "other").trimmingCharacters(in: .whitespaces)
            if st.isEmpty { st = "other" }
            if byStation[st] == nil { order.append(st) }
            byStation[st, default: []].append(r.name ?? r.slug ?? "")
        }
        var lines = ["\(recipes.count) recipes on file:"]
        for st in order.sorted(by: { $0.localizedCompare($1) == .orderedAscending }) {
            lines.append("\(st.uppercased()): \(byStation[st]!.joined(separator: ", "))")
        }
        lines.append("Full cards live on the Reference board — or ask me for one by name.")
        return lines.joined(separator: "\n")
    }

    private static func leftoverTokens(question: String, matchedPhrase: String) -> [String] {
        let phraseTokens = Set(matchedPhrase.split(separator: " ").map(String.init))
        return normalizeText(question)
            .split(separator: " ")
            .map(String.init)
            .filter { !phraseTokens.contains($0) && !stopwords.contains($0) && !unitWords.contains($0) }
    }

    // MARK: - The deterministic front door (mirror tryDirectRecipeAnswer)

    public static func tryDirectRecipeAnswer(
        message: String, recipes: [AssistantRecipe]
    ) -> DirectAnswer? {
        let m = message.trimmingCharacters(in: .whitespacesAndNewlines)
        if m.isEmpty || recipes.isEmpty { return nil }
        if matches(allergenIntent, m) { return nil }

        if matches(bookIntent, m) {
            return DirectAnswer(
                answer: renderBook(recipes),
                sourceDetail: "recipe book (\(recipes.count) recipes)")
        }

        if matches(retrievalIntent, m) { return nil }

        guard let match = findRecipe(question: m, recipes: recipes) else { return nil }
        let recipe = match.recipe
        let leftovers = leftoverTokens(question: m, matchedPhrase: match.matchedPhrase)

        if matches(qtyIntent, m), !leftovers.isEmpty {
            let hits = (recipe.ingredients ?? []).filter { i in
                let item = normalizeText(i.item ?? "")
                if item.isEmpty { return false }
                let itemTokens = Set(item.split(separator: " ").map(String.init))
                return leftovers.contains { itemTokens.contains($0) }
            }
            if !hits.isEmpty {
                return DirectAnswer(
                    answer: renderQuantity(recipe, hits: hits),
                    sourceDetail: "ingredient lookup: \(recipe.slug ?? recipe.name ?? "")")
            }
            let name = recipe.name ?? ""
            return DirectAnswer(
                answer: "\(name) doesn't list \(leftovers.joined(separator: " ")) as an ingredient. "
                    + "Ask me for the \(name) card to see everything in it.",
                sourceDetail: "ingredient lookup (absent): \(recipe.slug ?? name)")
        }

        // A card renders only when the question is essentially ABOUT the
        // recipe — at most one leftover token beyond the name, scaffolding,
        // and units. More than that means unmodeled intent; the LLM takes it.
        if leftovers.isEmpty || (matches(cardIntent, m) && leftovers.count <= 1) {
            return DirectAnswer(
                answer: renderCard(recipe),
                sourceDetail: "recipe card: \(recipe.slug ?? recipe.name ?? "")")
        }

        return nil
    }
}
