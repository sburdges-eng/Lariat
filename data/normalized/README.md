# `data/normalized/` — Compliance JSONL corpus

JSONL files in this directory hold the canonical compliance rules used
by the Kitchen Assistant for grounding manager-level legal questions
(CO labor law, CO liquor law, security boundaries, security operations).

## Files

| File | Domain | Rows | Status |
|---|---|---|---|
| `compliance_rules.jsonl` | unified — all four domains | 46 | seed |

## Schema

Every row follows the unified schema in
[`docs/data_sources/colorado_law_liquor_security_dataset_plan.md` §4](../../docs/data_sources/colorado_law_liquor_security_dataset_plan.md):

```json
{
  "id": "stable_unique_id",
  "domain": "labor_law | liquor_law | security_boundaries | security_operations | food_safety | internal_policy",
  "jurisdiction": "Colorado | Lariat",
  "local_jurisdiction": "optional",
  "topic": "short_topic_key",
  "audience": ["owner", "manager", "cook", "server", "bartender", "door_security", "..."],
  "plain_language_summary": "Short operational explanation in 5th-8th grade English.",
  "required_actions": [],
  "prohibited_actions": [],
  "allowed_actions": [],
  "exceptions": [],
  "escalation": {
    "manager_required": false,
    "police_required": false,
    "ems_required": false,
    "documentation_required": false
  },
  "source": {
    "title": "...",
    "publisher": "...",
    "url": "...",
    "effective_date": "UNKNOWN until verified",
    "retrieved_date": "YYYY-MM-DD"
  },
  "verification": {
    "status": "unverified | verified | stale | superseded | internal_house_policy_draft",
    "last_verified": "UNKNOWN | YYYY-MM-DD",
    "review_interval_days": 90
  },
  "notes": []
}
```

## Verification status meanings

- **`unverified`** — composed from common knowledge of the cited
  source. Citations point at the right document but the language has
  not been read against current text. **Treat as starting reference,
  not authoritative.** Most CO labor and CO liquor entries are
  currently `unverified`.
- **`verified`** — read against current source text on `last_verified`
  date. Re-verify before `last_verified + review_interval_days`.
- **`stale`** — past the review interval. Treat as `unverified` until
  re-verified.
- **`superseded`** — the rule has been replaced. `notes` should point
  at the replacement.
- **`internal_house_policy_draft`** — Lariat-specific operational
  policy that has no external statutory source. Most security
  operations rows fall here. Owner approval required before treating
  as authoritative house policy.

## How the Kitchen Assistant grounds against this corpus

Currently: not yet wired. The compliance JSONL is the seed. The
indexing pipeline (`scripts/datapack/build_fts_index.py` +
`build_embeddings_index.py`) will need a small extension to include
this file alongside the existing USDA / OFF / FDA / Wikibooks
sources. Until that lands, the JSONL is human-readable reference
material.

## How to add a new rule

1. Pick a stable id following the convention: `<domain>_<topic>_NNN`
   (e.g., `co_labor_013`, `sec_practice_006`).
2. Match the unified schema exactly (every key required; arrays must
   be present even if empty).
3. Append a single line of compact JSON (no pretty-printing — JSONL is
   one record per line).
4. Run `python3 -c "import json; [json.loads(l) for l in
   open('data/normalized/compliance_rules.jsonl')]"` to confirm the
   file parses.
5. Update this README's row count if the count changed materially.

## How to verify a rule

1. Open the row by id.
2. Read the cited source against current text.
3. Update the `plain_language_summary`, `required_actions`,
   `prohibited_actions`, and `effective_date` if needed.
4. Set `verification.status = "verified"` and
   `verification.last_verified = "<today>"`.
5. Commit with message `verify(compliance): <id> against <source>`.

## Caveat

This is reference material for staff training and AI grounding —
**not legal advice**. Colorado law changes. Local ordinances and
liquor-license conditions vary. For employment, wage-and-hour, liquor
enforcement, or use-of-force questions, route to legal counsel and
HR. Lariat's compliance UI surfaces should display a "verify with
counsel before acting" notice on rows tagged `unverified` or
`internal_house_policy_draft`.
