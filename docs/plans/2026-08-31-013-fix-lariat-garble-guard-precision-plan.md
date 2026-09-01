# Garble-Guard Precision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `isDegenerateAnswer` from destroying truthful kitchen answers, without weakening its ability to catch the failure it was built for (KA v3 mimicking the CONTEXT's XML and looping).

**Status:** Phases 0–1 are ready to implement. **Phase 2 is deliberately blocked** — see "The ordering decision" below. Do not start Phase 2 without Sean's explicit sign-off.

**Origin:** Follow-up to PR #660 (`fix/assistant-garble-guard-order`), which fixed *where* the guard runs. This plan is about *what it matches*.

---

## The ordering decision (read this first)

The obvious move is to retune the heuristic. **Do not start there.** Investigation on 2026-08-31 turned up three things that change the order of work:

1. **There is no corpus.** `lari_conversation_turns` carries an 8-hour TTL and hard-deletes on read (`lib/lariConversationMemory.ts:4`, `:65`). The single real degenerate sample found in the fixture DB expired mid-investigation and could not be re-collected. Every false-positive number in this plan is **synthetic or unreproducible**. Choosing thresholds now means choosing them blind.
2. **The Swift twin cannot fire at all on CRLF input.** Swift's `split(separator: "\n")` does not split `\r\n` (one grapheme cluster), so the whole answer collapses to one line and the native repeat heuristic never trips, while web's does. That is a **fail-open divergence on the iPad deployment target**, live on `main` today, independent of any tuning.
3. **The literal incident question still reaches the LLM.** `"find my pico recipe"` is *not* caught by the deterministic front door — `find` is missing from `STOPWORDS`, so it survives as a leftover token and the matcher bails.

Fixing verified defects before tuning an unmeasured heuristic is the ordering CLAUDE.md §7 argues for. Phase 0 and Phase 1 weaken nothing and need no judgement call. Phase 2 does, and it should be made on data.

---

## Global Constraints

- **Narrowing a guard is a §5 decision, not an implementation detail.** Every Phase 2 option reduces detection somewhere. CLAUDE.md §5 says never weaken a validation silently. Phase 2 requires Sean's explicit call, and the PR description must name exactly what can now slip through.
- **Parity is currently a fiction on this surface.** `lib/extractAction.ts:135-148` and `LariatNative/Sources/LariatModel/Compute/AssistantActionExtractor.swift:103-119` are hand-mirrored with **no shared fixture**. They already disagree on CRLF (above), on line-length units (`line.length`, UTF-16, vs `line.count`, grapheme clusters), and on trimming (`trim()` vs `trimmingCharacters(in: .whitespaces)`).
- **`swift test` cannot run on this machine** (CLT-only, no XCTest — CLAUDE.md §2). Local signal is `swift build` only; the real gate is a pushed branch and a green `native-ci` run. The CLT `swift` interpreter *can* run standalone `.swift` scripts, which is how the CRLF behavior was measured — use that for isolated semantics.
- **`lib/extractAction.ts` triggers no native gate.** `.github/workflows/native-ci.yml:22-40` path-filters on `LariatNative/**`, `tests/fixtures/**`, `lib/db.ts` and five Python scripts. A web-only heuristic PR runs **zero** Swift gates while silently desyncing the twin.
- **Narrowing feeds the replay loop.** The guard is the only thing keeping degenerate text out of conversation memory; storage happens *after* it (`route.js:1086-1092`), and up to 800 chars of a stored answer are spliced into the next prompt (`lib/lariConversationMemory.ts:9`, `:149`). Anything that gets through once is fed back to the model — the documented mechanism of the original incident. Any Phase 2 PR must state its effect on the replay path.
- Neither this change nor its copy sibling is inside a protected contract family (`grep -c -i "kitchen" docs/PROTECTED_CONTRACTS.md` → 0). No schema migration is needed.

---

## What was measured

Against the real 79-recipe cache and the real function:

| Finding | Evidence |
| --- | --- |
| The guard wipes **7 of 13** realistic legitimate answers | probe over renderer-built corpus |
| Dominant FP driver: **23 of 79 real recipes are untagged**, all emitting the identical 36-char line `Tags: none listed — check with a manager.` | `lib/assistantDirectAnswers.ts:200-202`; any answer listing 4 of them is destroyed |
| A truthful line-check answer (`Not logged yet.` under four station headers) is replaced wholesale, end-to-end through the real route | demonstrated defect |
| The **tag signal**, not the repeat signal, is what caught the real incident (48 tags vs threshold 5) | fixture-DB incident text |
| "Repetition density" does **not** separate the incident from legitimate repeats — the incident is *less* repetitive (uniqRatio 0.625) than the FP shapes (0.25–0.33) | measured |
| Live model traffic showed 0 FPs in 270 samples — but only because real answers are short (median ~100 chars, max repeat 2) | **a floor, not a bound**; unreproducible, corpus not persisted |

Two options are already disqualified by existing pinned tests: **raising the repeat threshold** above 6 fails the pinned 6-line loop fixture, and **requiring the same tag name** fails the pinned XML-mimicry fixture (its most frequent name occurs only 3×).

---

## Phase 0 — Repair verified defects (no tuning, no weakening)

### Task 0.1: Swift CRLF + unit parity in the twin

**Files:** Modify `LariatNative/Sources/LariatModel/Compute/AssistantActionExtractor.swift` (:103-119); Modify `LariatNative/Tests/LariatModelTests/AssistantActionExtractorTests.swift`

- [ ] Normalize newlines before splitting: replace `\r\n` and bare `\r` with `\n` (or split on a `CharacterSet.newlines` equivalent) at :111.
- [ ] Switch the length floor at :113 from `line.count` to a UTF-16 count so it matches `lib/extractAction.ts:142`.
- [ ] Add an explicit CRLF fixture (a 6× loop with `\r\n` separators must trip) and a non-BMP/multi-byte fixture pinning the length-unit boundary.
- [ ] Verify locally with a standalone `.swift` script through the CLT interpreter; then push and read `native-ci`. **Do not** claim the native gate green off a local run.

**Ship this alone.** It makes the repeat heuristic *more* active on native, so bundling it with Phase 2 narrowing makes a regression impossible to attribute.

### Task 0.2: Close the deterministic front door on the incident phrasing

**Files:** Modify `lib/assistantDirectAnswers.ts` (STOPWORDS, :57-63); Modify the Swift `AssistantDirectAnswers` stopwords; Modify `tests/js/test-assistant-direct-answers.mjs`

- [ ] Add the lookup verbs that currently survive as leftover tokens: `find`, `pull`, `up`, `get`, `grab`, `where`, `got`.
- [ ] Pin the literal incident question `"find my pico recipe"` asserting `model === 'direct-lookup'`.
- [ ] **Add negative tests.** This widens a path documented to bail whenever unsure (`lib/assistantDirectAnswers.ts:253-255`). A compound question containing "find" must still fall through to the LLM rather than getting a recipe card.

This is a pure widening of a deterministic path — it weakens no validation, and it shrinks the population of answers the guard has to judge at all, which lowers the stakes of Phase 2 rather than resolving it under pressure.

### Task 0.3: Pin the scope invariant that currently exists only in a comment

**Files:** Modify `tests/js/test-kitchen-assistant-garble-guard.mjs`

The guard's safety depends on an undocumented invariant: it runs on **model prose only, never `actionMsg`**. A real query (`accounting_variance_recent`, 30 rows of which 11 are byte-identical) satisfies `isDegenerateAnswer` today and reaches the cook *only* because of that scoping. One refactor away, a real table gets replaced with "came out garbled".

- [ ] Drive the route with a stubbed `db_query` returning 4+ byte-identical rows; assert the cook's answer still **contains** those rows and does **not** match `/came out garbled/`.

---

## Phase 1 — Make the guard measurable (no behavior change)

No threshold decision is defensible until someone can answer "how often does this fire, and on what?" Today a trip is invisible: the answer is replaced, the original is never stored, and the turn self-deletes in 8 hours.

### Task 1.1: Add a degeneracy check to the eval pre-gate

**Files:** Modify `training/eval/format-lint.mjs`; Modify `training/eval/run-eval.mjs`

- [ ] Import `isDegenerateAnswer` as an additional mechanical violation in format-lint. Its current checks are only a `<think>`-block test and a quantity regex — a candidate model that loops XML **passes the "HARD pre-gate" today**, which is the most likely way this incident recurs at scale.
- [ ] Record `tagCount` / `maxRepeat` per candidate response into the scenarios output.
- [ ] Note the limit honestly: `scenarios.json` is ~194 lines and question-shaped, so it will not cover the listing/table shapes that drive the false positives unless scenarios are added.

### Task 1.2: Capture what the guard suppresses

**Files:** Modify `app/api/kitchen-assistant/route.js` (at the guard)

- [ ] When the guard trips, record the pre-replacement text plus `length`, `tagCount`, `maxRepeat`.
- [ ] **Decide the sink deliberately.** Assistant answers can carry cook names, gold-star recipients, and sick-note-adjacent text. A durable table needs its own retention and a call on whether it becomes a protected surface under `docs/PROTECTED_CONTRACTS.md`. Console-only logging is cheaper but ephemeral, which defeats the purpose. **Start with a dev-only sink**; escalate only if the data proves necessary.

---

## Phase 2 — BLOCKED: retune the heuristic

Do not begin without Sean's sign-off, and not before Phase 1 has produced data.

Leading candidate is the **composite**: tightened tag regex, plus (consecutive-run ≥ 4 **OR** repeated lines ≥ 50% of non-empty lines), plus markdown-table-row exclusion. It measured 0 FP / 0 FN over 21 cases — the only variant to score clean — because its two repeat clauses cover each other's blind spots: consecutive-only misses an interleaved repeat, dominance-only misses a loop tail appended to a long good answer.

Its honest cost: the largest diff of the set, four coupled changes so a regression is hard to attribute, and a 0/0 score against a **21-case corpus the investigator authored**, not a captured production sample.

Each clause still narrows something: hyphenless angle-bracket junk, loops punctuated by short lines, and identical repeated table rows all become invisible.

**If Phase 2 proceeds, prefer landing it web + Swift in one commit** — touching `LariatNative/**` is the only thing that makes `native-ci` fire at all, so the Swift edit buys the Swift gate. Consider adding `tests/fixtures/assistant_degenerate_parity.json` (matching the existing `service_date_parity.json` pattern); because `tests/fixtures/**` *is* in native-ci's path filter, the fixture itself would force the Swift gate on every future heuristic edit, converting hand-mirrored parity into an enforced one.

---

## Gate checklist

```
[1] npx -y node@24 --experimental-strip-types --test \
      tests/js/test-extract-action.mjs tests/js/test-kitchen-assistant-garble-guard.mjs
    (DB-touching — CLAUDE.md §2 applies. Baseline 2026-08-31: 31/31.)
[2] npx -y node@24 --experimental-strip-types --test \
      tests/js/test-kitchen-assistant-action-hardening.mjs tests/js/test-kitchen-assistant-undo.mjs \
      tests/js/test-kitchen-assistant-conversation-memory.mjs tests/js/test-assistant-direct-answers.mjs
[3] npm run test:regression-assistant      # the lane owning both guard suites
[5] npm run test:suite-wiring              # MANDATORY if any new tests/js file is added
[6] npm run typecheck                      # route.js carries // @ts-check
[7] npm run lint
[8] npm run version:stamp && npm run verify # full web gate before PR
[9] NATIVE: swift build locally; real gate is a pushed branch + green native-ci (macos-26)
[10] PARITY (manual, non-negotiable): mirror every isDegenerateAnswer edit into
     AssistantActionExtractor.swift:103-119. Editing the Swift file is ALSO what makes native-ci fire.
[11] Coverage floors run in CI (line 85 / branch 81 / func 87) — new branches need matching tests.
```

## Test cases any Phase 2 change must satisfy

**Must stop tripping** (all truthful, all currently destroyed): four identical `• pico de gallo — 2 qt` par lines; four `Tags: eggs` lines across four recipes; five identical `38F — in range` readings; four `| --- | --- |` separators; the same bullet 4× at different indents; five vendor contacts as `Shamrock <orders@shamrockfoods.com>` (tag signal); the line-check answer with `Not logged yet.` under four stations.

**Must keep tripping:** the verbatim incident text (48 tags); the 12× `<ingredient name="diced shallot" />` fixture; the pinned 6-line repetition loop; the pinned XML-mimicry fixture.

**Must stay green:** the three negatives already pinned at `tests/js/test-extract-action.mjs:216-221`, and the PR #660 ordering tests.

**Standing guard, cheap:** run `tryDirectRecipeAnswer` over all 79 recipes in `data/cache/recipes.json` (card, "what's in the X", first-ingredient quantity, four book phrasings) and assert `isDegenerateAnswer` is false for every one. Currently 200/200 pass.

---

## Out of scope, but found here and worth its own work

- **`app/api/specials/route.js` is a second live LLM surface with no guard at all** — same XML context builder, same model, and its answer is **persisted uncapped** and promotable into menu-item and `vendor_ingredient` rows. Fabricated ingredients entering the recipe book is strictly worse than a wiped chat line. See plan 014's closing section; widening to specials must not share a PR with any narrowing here (§5).
- `summarizeDbQueryResult` is a second LLM call whose output reaches the cook through `actionMsg`. PR #660 restored `sanitizeRenderedAnswer` over it; it is still outside `isDegenerateAnswer`'s scope by design (see Task 0.3).
- LariatNative has **no `sanitizeRenderedAnswer` port at all** — web and native are not parallel on that guard either.
