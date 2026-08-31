---
title: "KA v4 — an assistant that assists"
date: 2026-08-31
status: draft — training pass; serving-side mitigations shipped separately
canonical_id: ka-v4-usefulness
parent: docs/superpowers/plans/2026-07-10-lariat-ka-v3.md
---

# KA v4 — an assistant that assists

Sean's verdict after the Front 0 smoke: "its ass ain't assisting." He's right,
and the failures are measured, not vibes:

| Live failure (2026-08-31) | Root cause |
|---|---|
| "how many cups of water in the green chilli" → denial, 3/3, with `water 5 cup` verbatim in CONTEXT | WS-5's hard filter dropped every training target with in-prose numbers, over-teaching "never state a quantity" onto question-path lookups |
| "scale the Quesa Birria Recipe by 4" → `unknown recipe slug: 'quesa_birria'` | Model guesses slugs from menu-item names instead of using the catalog's slug |
| "quesa birria recipe" → db_query dead-end | db_query deferred on native; model picks the one read path the device lacks |
| "double cornbread recipe" → routed as question | Classifier lexicon gap — **fixed** (#656) |

## Already shipped (serving-side, no retrain)

- Deterministic direct answers for recipe cards / ingredient quantities /
  recipe book (`lib/assistantDirectAnswers.ts` + Swift twin) — the
  bread-and-butter lookups no longer touch the model at all.
- Classifier scale verbs (#656); native dead-end copy coaches the scale path
  (#657); eval scenario T14 pins the water question.

## v4 training workstreams

1. **Amend the WS-5 number filter** (highest leverage): distinguish
   *verbatim-context* quantities (citable — the value appears in CONTEXT) from
   *computed* quantities (server-owned, still banned). Regenerate targets so
   ingredient-lookup questions answer with the context line.
2. **Slug discipline**: training targets for scale/prep actions must source
   `recipe_slug` from the catalog in CONTEXT, never improvise from menu-item
   names; add adversarial scenarios (menu-item phrasing → correct slug).
   Cheap decoding guarantee to assess: Ollama `format` schema constraining
   `recipe_slug` to the enumerated catalog on command turns.
3. **Read-path routing awareness**: teach "answer from CONTEXT when the fact
   is present; db_query only for facts that are NOT in context" — removes the
   native dead-end class even before any db_query port.
4. **Close the T04 allergen-identification nudge gap** (carried from v3's
   known follow-up).
5. **Eval expansion**: T14 (in-context quantity) is in; add slug-discipline
   scenarios and a "context-present vs context-absent" contrast pair set.
   Gate rule unchanged: flip only beyond grader noise (v3 WS-4 machinery).

## Deliberately NOT in v4

- Native db_query port — separate architecture decision (needs the query
  registry; revisit after C4/C5 when the native app owns more read models).
- Conversation memory for direct answers (stateless facts; revisit if cooks
  reference them in follow-ups).

## Cost/means

Same GCP pipeline as v3 (`training/gcp/`, ~$100 ceiling, sweep + gated eval).
Data regeneration is the bulk of the work; the pipeline itself is proven.
