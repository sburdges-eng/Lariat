# Assistant Outcome Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the kitchen assistant tell a cook the truth about what just happened to their write — so nobody re-issues an 86 or an inventory move that already landed.

**Origin:** Follow-up to PR #660. That PR fixed the *ordering* so the confirmation survives a garbled epilogue. This plan fixes the *words*, which are still wrong in two ways.

---

## The two defects

**1. "ask me again" now sits under a confirmation.** After PR #660 a cook whose write succeeded but whose model epilogue was garbled sees:

```
⚡ ACTION EXECUTED: 86'd the pico de gallo

That answer came out garbled — ask me again, or ask for a recipe by name (like "pico de gallo recipe").
```

"Ask me again" can read as "re-issue the command." That is the exact double-write PR #660 exists to prevent — the ordering fix moved the hazard rather than removing it.

**2. The prefix lies on the blocked path — and this one is a correctness defect, not a copy preference.** `actionExecuted` is set `true` on *all 30* action branches, including every soft-reject. A rejected write renders literally as:

```
⚡ ACTION EXECUTED: Inventory update blocked — delta "3 bunches" is not a number. Try again with just the count.
```

The banner says the write happened; the sentence says it did not. A cook who reads only the first line believes a write landed that the code explicitly refused. Verified live at `app/api/kitchen-assistant/route.js:546-548` combined with `:1082`.

---

## Global Constraints

- **`docs/UI_COPY_RULES.md` is binding.** Kitchen words, 5th–8th grade, understandable in under 2 seconds, no SaaS jargon, `Avoid multi-clause instructions` (:16), `Show status with plain words` (:84). The current garbled line is one 20-word multi-clause sentence with a parenthetical — the exact shape :16 bans.
- **The rules ban words this surface already uses.** `execute`, `submit`, `generate` are on the never-use list (:41-56) and `inventory → stock` is a mandated replacement (:57-66). `⚡ ACTION EXECUTED` and `Logged inventory update for …` both violate them today. Fixing the garbled line while leaving these is a defensible scope cut — but make it a decision, not an oversight.
- **`actionExecuted` cannot express the three cases.** It is `true` on soft-rejects and on all three read-only actions (`semantic_search`, `code_search`, `db_query`). `actionError` is `false` on most soft-rejects. **A 3-way split cannot be built on existing state.**
- **Parity:** any copy edit lands in both `app/api/kitchen-assistant/route.js` and `LariatNative/Sources/LariatDB/KitchenAssistantEngine.swift:238-239`. `swift test` cannot run locally (CLAUDE.md §2) — the gate is a pushed branch plus green `native-ci`.
- **The copy is currently untested on both sides.** Web has only `/came out garbled/i`, a substring regex that would survive almost any rewording. Swift has nothing asserting the string or the guard order at all.
- Not a protected surface; no migration. Blast radius is small: no production consumer matches on the string, and it is not in the i18n catalog, so `test:i18n` does not gate it.

---

## The plumbing decision (Task 1 gates everything else)

Three variants need a flag that says *a write actually landed*. Two ways to get it:

| Approach | Cost | Correctness |
| --- | --- | --- |
| **New explicit flag** — `actionWrote` beside `actionExecuted`, set at the 10 write sites (web) and 10 `.handled(...)` returns (Swift) | 20 edit points; adds a field to the `public` Swift `Outcome` struct | Correct on all 30 branches — **the only option that is** |
| **Reuse `undo != null`** | Zero new state; `undo` is already in scope at both guard sites | **Wrong on 3 real-write paths** — `scale_recipe`, `beo_add_prep`, `generate_prep` write to the DB but build no undo meta, so a cook who just wrote 12 prep rows gets the "ask me again" copy — precisely the invitation this plan removes |

**Take the explicit flag.** The `undo` shortcut is also time-bombed: the Undo card expires after 30s (`lib/kitchenAssistantUndo.ts:4`) while the answer text does not, so the stored conversation turn would permanently tell a cook to tap a button that is long gone.

---

## Task 1: Add an explicit "a write landed" flag

**Files:** Modify `app/api/kitchen-assistant/route.js`; Modify `LariatNative/Sources/LariatDB/AssistantActionRepository.swift`

- [ ] Web: add `let actionWrote = false;` beside `actionExecuted` (~:357) and set it `true` at the 10 write sites (534, 567, 647, 679, 718, 755, 832, 905, 957, 1024).
- [ ] Swift: add `wrote: Bool = false` to `Outcome` (:26-34) and a `.wrote(_:undo:)` factory beside `.handled` (:38); return it from the 10 success paths.
- [ ] `Outcome` is `public` and its `init` is public — check for other construction sites before changing the shape.
- [ ] Read-only actions (`semantic_search`, `code_search`, `db_query`) must **not** set it: nothing was saved and re-asking is free.

## Task 2: Three-variant replacement copy

**Files:** Modify `app/api/kitchen-assistant/route.js` (the guard); Modify `LariatNative/Sources/LariatDB/KitchenAssistantEngine.swift:238-239`

Two candidate sets, both rules-compliant and both a large improvement on the current line (Flesch-Kincaid 7.6):

**Set A — explicit** (recommended)

| Case | Copy | FK |
| --- | --- | --- |
| no action | `That answer came out garbled. Ask me again, or ask for a recipe by name.` | 1.5 |
| write landed | `Your change is saved. The rest of that answer came out garbled. Do not send it again.` | -0.2 |
| blocked/failed | `Nothing was saved. That answer came out garbled. Ask me again.` | 0.9 |

**Set B — terser**: `Saved. The rest came out garbled. Do not send it again.` / `Not saved. That came out garbled. Ask me again.` Better on 2-second glanceability, and `Saved.` / `Not saved.` matches the status-word style at :84 — but "the rest" is under-specified when the confirmation and the garbled line sit two lines apart, and a cook could read it as the write itself being partly garbled, which is the fear this copy exists to kill.

- [ ] Pick a set. Prefer A for the write-landed case; B's terseness is a fair trade for the other two.
- [ ] "saved" / "not saved" is measured house voice — `en.ts:126`, `:207`, and three `setMsg('Saved.')` sites.
- [ ] Keep a recipe-by-name hint in the no-action variant: it is the only thing steering a cook toward the deterministic path added in `065294d0`.
- [ ] **Do not** silently drop the garbled line on the write-landed path. Suppressing it entirely was considered and rejected: a cook who asked "86 the pico and tell me what's left" would get the confirmation and no acknowledgement that the second half was never answered, and the failure would vanish from the stored turn where anyone debugging KA v3 would look.

## Task 3: Pin the copy with real tests

**Files:** Modify `tests/js/test-kitchen-assistant-garble-guard.mjs`; Create `LariatNative/Tests/.../KitchenAssistantEngineTests` cases

- [ ] Web: assert each of the three variants by its distinguishing phrase, not by `/came out garbled/i`. Three cases: degenerate epilogue after a successful write; after a soft-reject; with no action.
- [ ] Swift: add the first test anywhere asserting the garbled string **and** the guard-before-prefix order. Nothing covers either today.

## Task 4 (decide, don't drift): the prefix contradiction

`⚡ ACTION EXECUTED:` on a blocked write is a correctness defect. Once Task 1's flag exists, the fix is nearly free: `⚡ DONE:` on a landed write, `⛔ NOT DONE:` on a soft-reject or failure, bare `actionMsg` for read-only actions. It also retires a banned word — `done` is both a preferred kitchen word (:33) and a named status word (:84).

- [ ] **Decide explicitly: same PR or next one.** It widens blast radius to *every* action turn and is asserted by `KitchenAssistantEngineTests.swift:166` (`hasPrefix("⚡ ACTION EXECUTED: ")`), `:327`, and `tests/js/test-kitchen-assistant-garble-guard.mjs:57`. It also changes stored conversation text, so old and new turns in `lari_conversation_turns` will read differently.
- [ ] Recommendation: **separate PR, immediately after.** It is copy churn across a write-confirmation surface and deserves its own review — but it should not be left indefinitely, because a cook re-issuing a write they believe already landed is the exact harm PR #660 was written to prevent.

---

## Gate checklist

```
[1] npx -y node@24 --experimental-strip-types --test tests/js/test-kitchen-assistant-garble-guard.mjs
[2] npx -y node@24 --experimental-strip-types --test \
      tests/js/test-kitchen-assistant-action-hardening.mjs tests/js/test-kitchen-assistant-undo.mjs
[3] npm run test:regression-assistant
[6] npm run typecheck      [7] npm run lint
[8] npm run version:stamp && npm run verify
[9] NATIVE: swift build; real gate is a pushed branch + green native-ci (macos-26)
[10] PARITY: mirror route.js copy into KitchenAssistantEngine.swift:238-239
```

**Sequencing against plan 013:** this change is a string plus a boolean; 013's Phase 2 is a behavioral heuristic that can suppress a real answer. Different risk classes — **ship them as separate PRs** so a later false-positive report can be bisected. This one is safe enough to go first and need not wait on 013's blocked phase.

---

## Out of scope, but do not lose it

`app/api/specials/route.js` runs the same model against the same XML context with **no guard at all** — neither `sanitizeRenderedAnswer` nor `isDegenerateAnswer` — and its answer is persisted uncapped (`app/api/specials/saved/route.js:59`, `:112-114`) and promotable into menu-item and `vendor_ingredient` rows via `lib/specialsPromotion.ts`. That is a strictly higher-consequence path than the chat line both these plans are about. It is web-only (native has no specials inference path), so closing it costs no Swift work. Per CLAUDE.md §5 it must not share a PR with any narrowing from plan 013 — but it likely deserves to be scheduled ahead of both.
