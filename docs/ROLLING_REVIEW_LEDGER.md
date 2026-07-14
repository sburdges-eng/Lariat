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
- **Freeze result:** 🔴 **BLOCKED pending remediation**

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

**⚠ Required native-parity follow-up (out of this branch's scope):** the Critical #2
fingerprint change alters the shared-DB canonical shape. `LariatNative/Sources/
LariatModel/Compute/AllergenAttestationCompute.swift` still computes the **old**
`{slug, ingredients, sub_recipes}` fingerprint — it must add the `allergens` node
key (last, matching web key order) or web and native will disagree on attested vs
stale for the same row. No live rows exist today (0 in `data/lariat.db`), so there
is no data-migration impact, but this must land before native re-attestation ships.
