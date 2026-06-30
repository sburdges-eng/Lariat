# Service Ledger Phase 2 — Surface Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **visual** migration — the per-task oracle is the contrast gate **plus** a route screenshot judged by eye, so tasks are executed **inline** (not dispatched to blind subagents).

**Goal:** Re-tokenize every flat legacy color-alias consumer onto the semantically correct role token, file-by-file (cookbook → estimate → globals), so each surface renders correctly in dark default and flipped `.paper`/`.k-night` contexts.

**Architecture:** Pure CSS. Each task takes one namespace (or small batch), reads its alias usages in context, replaces each with the right role token per the mapping rules below, then verifies via the contrast gate + a before/after screenshot of the route(s) that render it. One commit per namespace.

**Tech Stack:** CSS custom properties; `tests/js/test-design-tokens-contrast.mjs` (node:test); the run-lariat Playwright driver (`.claude/skills/run-lariat/driver.mjs`).

## Global Constraints

- **Worktree:** all work in `feat/service-ledger-phase2` (off `origin/main` @ `a79faa0`). Never edit the main checkout.
- **No new raw hex in consumers** — every replacement is a `var(--role)`.
- **Contrast gate stays green:** `node --test tests/js/test-design-tokens-contrast.mjs` (text/bg ≥ 7:1; accents on `--panel` ≥ 4.5:1; `.paper` accents ≥ 4.5:1).
- **Out of scope (deferred):** deleting alias definitions from `tokens.css`; any guard test forbidding aliases; the `.superpowers/sdd/progress.md` backlog; Increment-2 follow-ups.
- **Commit trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **globals.css only after a rebase** on the latest `origin/main` (concurrent a11y/prefix sweep lands first).

## Mapping rules (the migration's heart)

**MIGRATE these flat, `:root`-only aliases → role tokens, judged by element intent:**

| Alias | Definition | Default target | Notes / judgment |
|---|---|---|---|
| `--ink` | `var(--text)` | `--text` | primary text. If used as a *fill/border* (inverted control), see below. |
| `--bone` | `var(--text)` | `--text` | primary text on dark |
| `--bone-2` | `var(--text-muted)` | `--text-muted` | |
| `--muted` | `var(--text-muted)` | `--text-muted` | secondary text |
| `--char` | `var(--bg)` | `--bg` **if** surface/bg; `--text`/`--text-muted` **if** misused as text | role-misuse fix (see lede `eabdf25`) |
| `--ember` | `var(--accent)` | `--accent` | accent / interactive |
| `--cream` | `var(--panel)` | `--panel` | card fill |
| `--paper` | `var(--panel-2)` | `--panel-2` | raised/placeholder fill |
| `--paper-2` | `var(--panel-2)` | `--panel-2` | |

**RETAIN these (context-aware or no role equivalent — do NOT flatten):**
`--ember-deep` (#b8702a, redefined in `.paper`), `--ember-glow`, `--ink-2`, `--muted-2`, `--paper-3` (all redefined per-context and/or carry a distinct shade with no role token). Retiring/replacing these is a separate later phase.

**Inverted-control rule:** when a *text* token is used as a `background` (e.g. an active chip `background:var(--ink)`), the control is meant to be a filled pill — fix the pair so it's readable: `background:var(--text); color:var(--bg)` (or `--on-accent`). Confirm by screenshot.

## File structure

No files created. Modified: `styles/cookbook.css`, `styles/estimate.css`, `styles/globals.css`. Verification reuses the existing contrast test and the run-lariat driver; screenshots land in the session scratchpad (not committed).

---

### Task 1: cookbook.css — full re-tokenize (`.cookbook-*`)

**Files:**
- Modify: `styles/cookbook.css` (the lede at :59 is already done in `eabdf25`)
- Verify: `tests/js/test-design-tokens-contrast.mjs`; route `/recipes` (dark surface)

**Interfaces:** Produces nothing consumed by later tasks (CSS only). Consumes the mapping rules above.

Usage → target (all on the dark `/recipes` surface; `--ember-deep` retained):

| Line(s) | Selector | Current | → Target |
|---|---|---|---|
| 36, 102, 153, 232, 327, 351, 380 | eyebrow/mode-sub/label/section-count/etc. | `color: var(--muted)` | `color: var(--text-muted)` |
| 48, 99, 120, 165, 197, 225, 318 | title/mode-label/mode-out/search/chip:hover/section-title | `color: var(--ink)` | `color: var(--text)` |
| 52, 106, 362 | title em / mode-sub a / (footer) | `var(--ember-deep)` | **retain** (context-aware shade) |
| 76 | `.cookbook-mode` | `color: var(--char)` | `color: var(--text-muted)` — **misuse fix** (bg token as container text) |
| 79, 82, 90, 91, 125, 126, 174, 175, 196, 256, 262, 263, 298 | mode/dot/search-focus/chip/card accents | `var(--ember)` | `var(--accent)` |
| 191 | `.cookbook-chip` | `color: var(--char)` | `color: var(--text-muted)` — **misuse fix** (resting chip label was bg-dark) |
| 200, 201, 202 | `.cookbook-chip.is-active` | `background:var(--ink); border-color:var(--ink); color:var(--bone)` | `background:var(--text); border-color:var(--text); color:var(--bg)` — **inversion fix** (was light-on-light/blank) |
| 268, 289, 290 | card-photo placeholders | `var(--paper)` / `var(--paper-2)` | `var(--panel-2)` |
| 291 | card-photo placeholder gradient stop | `var(--paper-3)` | **retain** (context-aware) |

- [ ] **Step 1 (baseline):** capture before screenshot.
  Run: `node .claude/skills/run-lariat/driver.mjs --seed --port=3037 --out=$SCRATCH/t1-before /recipes`
- [ ] **Step 2:** apply every MIGRATE replacement in the table (leave the RETAIN rows). Edit `styles/cookbook.css`.
- [ ] **Step 3 (contrast gate):** `node --test tests/js/test-design-tokens-contrast.mjs` — Expected: 11 pass, 0 fail.
- [ ] **Step 4 (visual):** capture after screenshot; compare to before.
  Run: `node .claude/skills/run-lariat/driver.mjs --seed --port=3037 --out=$SCRATCH/t1-after /recipes`
  Confirm: body/headings unchanged; `.cookbook-mode` instructional text now legible; active filter chip is a filled pill with **dark, readable** text.
- [ ] **Step 5 (commit):**
  `git add styles/cookbook.css && git commit -m "style(cookbook): re-tokenize .cookbook-* onto role tokens"`

---

### Task 2: estimate.css — RESOLVED: EXCLUDED from migration (no changes)

**Finding (in-context read, 2026-06-30):** all 11 "alias usages" in `estimate.css`
(`--cream` ×1, `--ink` ×9, `--text: var(--ink)` ×1) are **false positives**. The
`.estimate-doc` block (`styles/estimate.css:3-20`) *defines its own local tokens* with
explicit heritage hex — `--cream:#F4F0E8` (light), `--ink:#1A1814` (dark),
`--display:Georgia` — and every usage is scoped under `.estimate-doc .ed-*`. These are
the deliberate Phase-1 self-scoped overrides that keep the estimate/BEO-share document
dark-ink-on-cream **regardless of the global theme** (the comment: "all rules scoped
under .estimate-doc (no .paper regression)"). The `:378` `.ed-sign-slot` block is the
intentional bridge supplying global role tokens at light heritage values for the
injected SignForm.

**Conclusion:** `estimate.css` is NOT a legacy-alias consumer. Re-tokenizing it onto
global role tokens would regress the heritage document (flip it to the dark cockpit
palette / light-on-light). **No edits.** The migration's real scope is `cookbook.css`
(done) + `globals.css` (157).

---

### Task 3: REBASE before globals.css

- [ ] **Step 1:** `git fetch origin && git rebase origin/main` in the worktree. Resolve any conflicts (expected line-disjoint vs the concurrent prefix/markup sweep).
- [ ] **Step 2:** re-run the contrast gate after rebase to confirm a clean base.
- [ ] **Step 3 (MACP):** claim globals.css: `AGENT_NAME=claude node $MAIN/scripts/agent-session.mjs update --tool claude --claimed "styles/globals.css"`.

---

### Tasks 4–N: globals.css — namespace batches (157 usages, ~30 namespaces)

Each task takes one namespace group, applies the **same per-namespace workflow**, and commits. Because globals.css is large, **enumerate each namespace's usages with grep at execution** (the file may have rebased), apply the mapping rules, and verify on the listed route. Suggested batches and their verification routes:

| Task | Namespace batch | Verify route(s) |
|---|---|---|
| 4 | `.rush`, `.station`, `.phase`, `.tl` (rush board + line) | `/` (`--seed`) |
| 5 | `.beo` (115 selectors) | `/beo`, `/beo/[id]/estimate` |
| 6 | `.fs`, `.cooling`, `.sani`, `.sick`, `.datemark`, `.cert` (food-safety family) | `/food-safety` + subpages |
| 7 | `.gs` (gold-stars), `.breaks`, `.preshift`, `.rcv` | `/gold-stars`, `/eighty-six` |
| 8 | global chrome: `.nav`, `.sidebar`, `.cmdk`, `.lari`, `.command` | any route (visible everywhere) |
| 9 | shared primitives: `.btn`, `.card`, `.chip`, `.alert`, `.status`, `.section`, `.mark`, `.editorial`, `.recipe`, `.install` | `/`, `/install` |

Per task (4–9):
- [ ] **Step 1:** `grep -nE 'var\(--(ink|bone|muted|char|ember|cream|paper|paper-2)\)' styles/globals.css` filtered to the batch's selectors; capture before screenshot of the verify route.
- [ ] **Step 2:** apply MIGRATE replacements (retain the context-aware tokens); fix any misuse/inversion found.
- [ ] **Step 3:** `node --test tests/js/test-design-tokens-contrast.mjs` — Expected: 11 pass.
- [ ] **Step 4:** after screenshot; confirm no dark-default regression and correct render.
- [ ] **Step 5:** `git add styles/globals.css && git commit -m "style(globals): re-tokenize <namespace> onto role tokens"`.

After Task 9: `grep -cE 'var\(--(ink|bone|bone-2|muted|char|ember|cream|paper|paper-2)\)' styles/globals.css styles/cookbook.css` should be **0** (only the retained context-aware tokens `--ember-deep`/`--muted-2`/`--paper-3` remain). That zero is the completion proof for this phase. **`estimate.css` is excluded** — its `--ink`/`--cream` are intentional `.estimate-doc`-local tokens (see Task 2).

## Self-Review

- **Spec coverage:** ✅ full re-tokenize of all three files (Tasks 1, 2, 4–9); ✅ order cookbook→estimate→globals; ✅ globals last + rebase (Task 3); ✅ contrast gate + route screenshots every task; ✅ capstone explicitly out of scope (Global Constraints). Refinement vs spec: context-aware tokens (`--ember-deep` et al.) are **retained**, not flattened — documented in Mapping rules; this narrows the literal count slightly but is the correct semantic call.
- **Placeholder scan:** globals.css tasks intentionally enumerate usages at execution (the file rebases first) — the *workflow* is fully concrete (grep → map → gate → screenshot → commit); not a vague "handle the rest."
- **Type consistency:** N/A (CSS); token names cross-checked against `tokens.css` definitions.
