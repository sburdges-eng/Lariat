import Foundation
import GRDB
import LariatModel

/// Typed write errors for allergen attestations — each maps to a web route
/// status branch (asserted in tests).
public enum AllergenAttestationWriteError: Error, Equatable, Sendable, LocalizedError {
    case missingWriteDatabase
    /// 400 (`missing slug`).
    case missingSlug
    /// 400 (`missing attested_by`).
    case missingAttestedBy
    /// 404 (`unknown recipe slug`) — `recordAttestation` returned null on the
    /// web: you can't attest a recipe the heuristic can't see.
    case unknownRecipe(String)

    public var errorDescription: String? {
        switch self {
        case .missingWriteDatabase: return "Could not open the write database"
        case .missingSlug: return "missing slug"
        case .missingAttestedBy: return "missing attested_by"
        case .unknownRecipe(let slug): return "unknown recipe slug \"\(slug)\""
        }
    }
}

/// Reads/writes `allergen_attestations` — behavior parity with
/// `lib/allergenAttestations.ts` + `/api/allergens/attestations`.
///
/// SAFETY-CRITICAL AUDIT POSTURE (pinned by tests):
///   • Append-only: corrections are fresh rows — this repository NEVER
///     UPDATEs or DELETEs an attestation.
///   • Every insert posts its `audit_events` row (entity
///     `allergen_attestation`, action `insert`, payload = the full row)
///     INSIDE the same transaction via `AuditEventWriter.post`.
///   • Rule failures (missing slug / attested_by, unknown recipe) throw
///     BEFORE any write.
///
/// Deliberate divergences (documented per the A5 precedent, asserted in
/// tests): `actor_source` comes from `RegulatedWriteContext` (`native_mac`;
/// the web stamps `manager_ui`), and there is no `withIdempotency` layer.
public struct AllergenAttestationRepository {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase? = nil) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── Status list (GET) ───────────────────────────────────────────────

    /// Attestation status for the given slugs (nil = every recipe in the
    /// cache). Slugs missing from the cache still return (an attestation may
    /// outlive its recipe) with `status: .stale`.
    public func statuses(
        slugs: [String]? = nil,
        locationId: String = LocationScope.resolve(),
        recipes: [AllergenRecipe]
    ) async throws -> [RecipeAttestationStatus] {
        var bySlug: [String: AllergenRecipe] = [:]
        for recipe in recipes { bySlug[recipe.slug] = recipe }
        let targetSlugs = slugs ?? recipes.map(\.slug)

        let latest = try await latestRows(locationId: locationId, slugs: slugs == nil ? nil : targetSlugs)

        return targetSlugs.map { slug in
            let recipe = bySlug[slug]
            let row = latest[slug]
            var status = AttestationStatus.unattested
            if let row {
                let current = AllergenAttestationCompute.computeRecipeFingerprint(
                    slug: slug, recipes: recipes)
                status = AllergenAttestationCompute.status(latest: row, currentFingerprint: current)
            }
            return RecipeAttestationStatus(
                recipeSlug: slug,
                name: recipe?.name ?? slug,
                heuristicAllergens: recipe?.allergens ?? [],
                status: status,
                latest: row)
        }
    }

    /// Single-recipe convenience wrapper.
    public func status(
        slug: String,
        locationId: String = LocationScope.resolve(),
        recipes: [AllergenRecipe]
    ) async throws -> RecipeAttestationStatus {
        guard let first = try await statuses(slugs: [slug], locationId: locationId, recipes: recipes).first
        else { fatalError("statuses dropped slug \"\(slug)\"") }
        return first
    }

    /// Latest attestation row per slug (append-only table: highest id wins).
    private func latestRows(
        locationId: String, slugs: [String]?
    ) async throws -> [String: AllergenAttestationRecord] {
        let wanted = slugs.map(Set.init)
        return try await readDB.pool.read { db in
            let rows = try AllergenAttestationRecord.fetchAll(db, sql: """
                SELECT id, recipe_slug, location_id, allergens_json,
                       recipe_fingerprint, attested_by, note, created_at
                  FROM allergen_attestations
                 WHERE location_id = ?
                 ORDER BY id DESC
                """, arguments: [locationId])
            var latest: [String: AllergenAttestationRecord] = [:]
            for row in rows {
                if let wanted, !wanted.contains(row.recipeSlug) { continue }
                if latest[row.recipeSlug] == nil { latest[row.recipeSlug] = row }
            }
            return latest
        }
    }

    // ── Record (POST, PIN-gated at the surface) ─────────────────────────

    public struct RecordInput: Sendable {
        public var recipeSlug: String
        /// Attested allergen list; nil defaults to the current heuristic set.
        public var allergens: [String]?
        /// Manager identifier. Required.
        public var attestedBy: String
        public var note: String?

        public init(recipeSlug: String, allergens: [String]? = nil,
                    attestedBy: String, note: String? = nil) {
            self.recipeSlug = recipeSlug
            self.allergens = allergens
            self.attestedBy = attestedBy
            self.note = note
        }
    }

    /// Record one attestation (append-only) plus its `audit_events` row in a
    /// single transaction. Throws BEFORE any write on rule failure.
    @discardableResult
    public func record(
        _ input: RecordInput,
        recipes: [AllergenRecipe],
        locationId: String = LocationScope.resolve(),
        context: RegulatedWriteContext
    ) throws -> AllergenAttestationRecord {
        guard let writeDB else { throw AllergenAttestationWriteError.missingWriteDatabase }

        let slug = input.recipeSlug.trimmingCharacters(in: .whitespacesAndNewlines)
        if slug.isEmpty { throw AllergenAttestationWriteError.missingSlug }
        let attestedBy = SpecialsValidators.clipText(
            input.attestedBy.trimmingCharacters(in: .whitespacesAndNewlines), max: 100)
        if attestedBy.isEmpty { throw AllergenAttestationWriteError.missingAttestedBy }

        guard let fingerprint = AllergenAttestationCompute.computeRecipeFingerprint(
            slug: slug, recipes: recipes)
        else { throw AllergenAttestationWriteError.unknownRecipe(slug) }

        let recipe = recipes.first { $0.slug == slug }
        let allergens = AllergenAttestationCompute.normalizeAllergens(
            input.allergens ?? recipe?.allergens ?? [])
        let allergensJson = JsValueFormat.jsonStringArray(allergens)
        let note: String? = input.note.flatMap {
            let trimmed = SpecialsValidators.clipText(
                $0.trimmingCharacters(in: .whitespacesAndNewlines), max: 500)
            return trimmed.isEmpty ? nil : trimmed
        }

        return try writeDB.write { db in
            try db.execute(sql: """
                INSERT INTO allergen_attestations
                  (recipe_slug, location_id, allergens_json, recipe_fingerprint,
                   attested_by, note)
                VALUES (?, ?, ?, ?, ?, ?)
                """, arguments: [slug, locationId, allergensJson, fingerprint, attestedBy, note])

            guard let row = try AllergenAttestationRecord.fetchOne(db, sql: """
                SELECT id, recipe_slug, location_id, allergens_json,
                       recipe_fingerprint, attested_by, note, created_at
                  FROM allergen_attestations WHERE id = ?
                """, arguments: [db.lastInsertedRowID])
            else { throw AllergenAttestationWriteError.missingWriteDatabase }

            // Web parity: payload is the full row; actor_cook_id is the
            // attesting manager's name (`attested_by`).
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "allergen_attestation",
                entityId: row.id,
                action: .insert,
                actorCookId: attestedBy,
                actorSource: context.actorSource,
                payloadJSON: AuditEventWriter.encodePayload(row),
                note: note,
                shiftDate: context.shiftDate,
                locationId: locationId
            ))

            return row
        }
    }
}
