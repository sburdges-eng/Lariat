# Rolling Review Ledger

Section-by-section freeze review of the Lariat web app. Each entry records a
completed review of one section at one commit, its freeze result, and the rule
for when the section must be re-reviewed.

**How to read an entry**

- **Reviewed at commit** — the exact commit the review was performed against. An
  entry is complete *only* for that commit.
- **Freeze result** — `FROZEN` (cleared to ship / no remediation required) or
  `BLOCKED pending remediation` (required fixes must land before the section is
  considered clean).
- **Re-review rule** — when this section must be reviewed again (default: after
  any scoped change, or after the required fixes land).

Findings severities: **Critical** (must fix), **High** (should fix), **Contract**
(response-envelope / documented-invariant / UI-copy conformance).

---

## Web · Allergen lookup

- **Reviewed at commit:** `16d0f5040770708d85739d541a213cd73fb50054`
- **Review date:** 2026-07-14
- **Freeze result:** 🟢 **FROZEN** — cleared on re-review at `13b1b36` (2026-07-15)
  after all findings landed (PR #539). Original review at `16d0f50`:
  🔴 BLOCKED pending remediation (record preserved below).

**Scope completed**

- `app/allergen-lookup/**`
- `app/api/allergens/attestations/route.js`
- `lib/allergenAttestations.ts`
- the allergen path through `app/api/datapack/search/route.js` and `lib/datapackSearch.ts`
- cache derivation in `scripts/rebuild-cache.mjs`
- the three focused allergen test files

**Explicitly excluded**

- native Swift allergen UI
- repository-wide food-safety behavior

### Findings

**Critical**

1. The POST route can mark a recipe attested while persisting a client-supplied
   allergen list that differs from the current heuristic list.
2. The fingerprint excludes derived allergen output and the heuristic/data
   version, so allergen output can change without staling the attestation.

**High**

1. GET and POST resolve locations differently.
2. Attestation identity is free text instead of the authenticated PIN actor.
3. Malformed or missing Open Food Facts allergen metadata collapses to the same
   empty state as a valid no-allergen result.

**Contract**

1. Response envelopes lack the required `schemaVersion` and explicit invariants.
2. Deleted-recipe attestation visibility does not match the module comment.
3. Some UI copy violates `docs/UI_COPY_RULES.md`.

### Verification

- 64 focused tests passed.
- `npm run typecheck` passed.
- Scoped absolute-path and tracked-`__pycache__` checks were clean.
- Scoped ESLint **failed** on two existing `react/no-unescaped-entities`
  warnings in `app/allergen-lookup/page.jsx`.

### Diagnostic evidence

- The live route accepted an empty list for a milk recipe, returned HTTP 201
  with status `attested`, stored `?location=north` under `default`, and accepted
  an arbitrary actor name.
- A separate probe changed the heuristic list from `[wheat]` to `[sesame, wheat]`
  while preserving the fingerprint and attested status.

### Re-review rule

Treat this entry as complete only for the recorded commit. Re-review this section
after any scoped change or after the required fixes land.

### Remediation (in progress)

Branch `fix/allergen-attestation-hardening` (web-only; native excluded per scope).
The findings above remain the record **at `16d0f50`**; a fresh review at the fix
commit is what flips this section out of BLOCKED.

| Finding | Fix |
| --- | --- |
| Critical #1 | POST never stores a client list. A submitted `allergens` is only a precondition; a mismatch against the server heuristic is rejected **409** (loud, no silent auto-correct). `recordAttestation` always stores the server-computed heuristic set. |
| Critical #2 | `computeRecipeFingerprint` now folds each reachable node's **derived allergen output** into the canonical hash, so a heuristic/data-version change that alters the answer stales the attestation even when ingredient names are unchanged. |
| High #1 | POST resolves location via `locationFromBodyOrRequest(body, req)` — body wins, else the `?location=` query — matching GET. |
| High #2 | Signoff identity + audit actor are bound to the authenticated PIN actor (`pinActor` → `resolveAttestor`). A signed-in manager account forces the name; the env-PIN override keeps the typed name. First route adoption of `pinActor`. |
| High #3 | New `parseAllergenTagsResult` distinguishes a **valid empty** OFF allergen array (declares none) from **absent/null/malformed** (unknown). The card renders a distinct "⚠ not listed — check label" chip instead of "no allergens flagged". |
| Contract #1 | GET/POST/409 envelopes carry `schemaVersion: 'allergen_attestations_v1'`; invariants documented in the route header. |
| Contract #2 | `getAttestationStatuses(null, …)` and the single-slug GET now surface an attestation whose recipe left the cache as `stale` instead of dropping it / 404ing. |
| Contract #3 + lint | Cook-facing "heuristic"/"inferred" replaced with plain "from ingredients"/"guessed"; page.jsx copy reworded to remove the two `react/no-unescaped-entities` warnings. |

**Verification:** 82 focused tests pass (allergen-attestations 27, lookup-helpers 48,
rebuild-cache 7), `tsc --noEmit` clean, scoped ESLint clean, pin-gate coverage 3/0.

**Re-review 2026-07-15 (`13b1b36`, PR #539 merged):** re-verified on merged `main` —
allergen-attestations 27/0, lookup-helpers 48/0, `tsc` clean, scoped ESLint clean.
Section → 🟢 FROZEN.

**⚠ Required native-parity follow-up:** the Critical #2 fingerprint change alters
the shared-DB canonical shape, and native must mirror it (issue #540). **Fix
landed on branch `fix/native-allergen-fingerprint-parity`** (stacked after the
datapack branch): `AllergenAttestationCompute.computeRecipeFingerprint` now
appends the normalized derived-`allergens` key (last, matching web key order);
all node-generated oracle hashes regenerated from the NEW web implementation,
plus a new allergens-only-change staleness test mirroring the web's. Full
`swift build && swift test` green. No live rows exist (0 in `data/lariat.db`),
so no data-migration impact. Merge order: this chain lands together (or native
before any native re-attestation ships).

---

## Web · Data pack search

- **Reviewed at commit:** `16d0f5040770708d85739d541a213cd73fb50054`
- **Review date:** 2026-07-14
- **Freeze result:** 🟢 **FROZEN** — cleared on re-review at `13b1b36` (2026-07-15)
  after all findings landed (PRs #541, #542). Original review at `16d0f50`:
  🔴 BLOCKED pending remediation (record preserved below).

**Scope completed**

- `app/datapack-search/page.jsx`, `app/datapack-search/DatapackSearchClient.jsx`,
  `app/datapack-search/detailsState.ts`
- the four datapack node test files (`test-datapack-search`,
  `test-datapack-search-route`, `test-datapack-search-toggle-detail`,
  `test-datapack-semantic`)
- the non-allergen source paths (USDA / Wikibooks / FDA) and the
  semantic/hybrid ops as they surface through `app/datapack-search`

**Explicitly excluded**

- `app/api/datapack/search/route.js` and `lib/datapackSearch.ts` allergen/OFF
  path — already reviewed in the allergen-lookup entry above (not re-reviewed
  here beyond how this page consumes it)
- native Swift datapack UI; the ML index build (`scripts/`)

Read-only reference-lookup surface: no PIN gate, no writes, no audit — so
severity turns on **food-safety display accuracy**, not data integrity.

### Findings

**High**

1. The OFF drill-in panel (`OffDetail`) understates allergen data two ways:
   (a) `traces_tags_json` ("may contain" cross-contact) is **never rendered** —
   the string `traces` appears nowhere in the client; (b) a null / missing /
   malformed allergen field collapses to an **absent** Allergens section,
   indistinguishable from a product that declares none. On a tool whose stated
   purpose is allergen lookup, both are food-safety false-negatives. This is the
   allergen-lookup **High #3** gap, unported here — and worse, since traces are
   dropped entirely and there is no "unknown / not listed" signal.

**Contract**

2. Duplicated `parseAllergenTags`: the private copy in
   `DatapackSearchClient.jsx` has already diverged from the canonical
   `app/allergen-lookup/allergenLookupHelpers.js` (which now carries the
   known-vs-unknown distinction `parseAllergenTagsResult`). A fix in one will
   not reach the other.
3. UI copy violates `docs/UI_COPY_RULES.md` — developer/ML jargon in
   user-facing controls: the Mode options "Lexical (BM25) / Semantic (BGE) /
   Hybrid (RRF)", the "Bucket" selector and its labels, the per-row raw "id"
   and "score", and "No hits."

**Low / hardening**

4. `page.source_url` (Wikibooks) is rendered as an `<a href>` with no
   URL-scheme check; a `javascript:` / `data:` value in the datapack would
   execute on click. Curated local reference data → low exploitability, but
   validate the scheme before rendering.
5. Passed-through FTS hit fields are trusted at render: `hit.score.toFixed(2)`
   throws if a hybrid pass-through hit's `score` is non-numeric, and `hit.id`
   is rendered raw. Server-controlled → low.

**Test coverage**

6. The 964-line client's render logic (the OFF allergen/trace panel,
   `normalizeSemanticHit`, source grouping) has **no node-test coverage** —
   only `detailsState` and two `app/__tests__` jest tests exist. The
   food-safety-relevant display branches are effectively untested at the node
   level.

### Verification

- 18 focused node tests pass (toggle-detail 10, search 3, route 1, semantic 4).
- Scoped ESLint clean; no absolute paths in the surface; no tracked
  `__pycache__`.
- `tsc --noEmit` clean (these files are unchanged vs `main`).

### Diagnostic evidence

- Code-level, unambiguous: `OffDetail` references only `allergens_tags_json`
  (never `traces_tags_json`) and renders the Allergens block under
  `allergens.length > 0 ? … : null`, so both an empty declared list and an
  absent/malformed field render as no allergen section at all. A live probe was
  not run (the reference data pack may not be installed on this Mac).

### Re-review rule

Treat this entry as complete only for the recorded commit. Re-review this
section after any scoped change or after the required fixes land.

### Remediation (in progress)

Branch `fix/datapack-search-allergen-display`, **stacked on**
`fix/allergen-attestation-hardening` (PR #539) — it reuses that branch's
`parseAllergenTagsResult` helper and the ledger file, neither of which is on
`main` yet. The findings above remain the record **at `16d0f50`**.

| Finding | Status |
| --- | --- |
| High #1 | **Fixed.** `OffDetail` now renders an explicit allergen state — chips / "Declares no allergens" / "⚠ not listed — check label" — so absent/malformed data never reads as safe, and a new **May contain (traces)** row surfaces `traces_tags_json`. Decision logic extracted to a pure, tested `offAllergenView`. |
| Contract #2 | **Fixed** (fix vehicle). The duplicate `parseAllergenTags` is deleted; the panel reuses the canonical `parseAllergenTagsResult` / `cleanAllergenTag`. |
| Coverage #6 | **Partly addressed.** New `tests/js/test-datapack-off-allergen-view.mjs` (8 cases) covers the OFF allergen/trace render decision; the rest of the client stays jest-only. |
| Contract #3 | **Fixed.** Cook-plain copy per `docs/UI_COPY_RULES.md`: "Mode" → "Search by" (Exact words / Similar meaning / Both), "Bucket" → "Look in" (Recipes / Techniques / Safety rules / Ingredients), raw per-row "score"/"id" removed (drill-in panels keep the real identifiers), "No hits." → "No matches.", "Enter a query…" → "Type what you want to look up." Jest label test updated first (RED→GREEN). |
| Low #5 | **Resolved by removal.** Deleting the row-level score display removes the `hit.score.toFixed(2)` code path entirely. |
| Low #4 | **Fixed.** New `safeHttpUrl` guard (http/https only) on the Wikibooks `source_url` href; non-web schemes (`javascript:`, `data:`, `file:`), relative, and malformed values skip the link instead of reaching the browser. |
| Coverage #6 | **Addressed.** `normalizeSemanticHit` / `lookupUrlFor` / `hitKey` / `groupHits` extracted to a pure `hitModel.js` with node tests (13 cases) alongside `offAllergenView` (8) — all flagged render-critical logic now node-covered. |

All findings in this entry now have fixes on `main` (PRs #541, #542).

**Verification:** 87 focused node tests pass (hit-model 13, off-allergen-view 8,
datapack 18, lookup-helpers 48) + jest datapack UI tests 3/3, `tsc --noEmit`
clean, scoped ESLint clean, `next build` OK.

**Re-review 2026-07-15 (`13b1b36`, PRs #541 + #542 merged):** re-verified on merged
`main` — off-allergen-view 8/0, hit-model 13/0, datapack node 18/0, lookup-helpers
48/0, jest datapack UI 3/3, `tsc` clean, scoped ESLint clean. Native fingerprint
parity closed (#540). Section → 🟢 FROZEN.
