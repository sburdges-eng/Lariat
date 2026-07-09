# Lariat Kitchen Assistant v2 — Local Model + Vertex AI Training: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fine-tune a 4B/8B-class local model on runtime-shaped Lariat data via Vertex AI (≤$200), pick the best candidate on the real eval harness, and flip `lari-the-kitchen-assistant` in place so web + native both serve it on the 16GB M4.

**Architecture:** A dataset generator that imports the *production* prompt builders (`GROUNDED_SYSTEM`, `renderQueryCatalog`, `buildGroundedContext`, `extractAction`) so every training example matches the serving format byte-for-byte; a Vertex AI custom-job QLoRA sweep (TRL) that ends each job with on-VM GGUF q4_K_M conversion; a local eval/selection/flip stage on the M4.

**Tech Stack:** Node 22 (`--experimental-strip-types` to import repo `.ts`), TRL/peft/bitsandbytes on Vertex prebuilt PyTorch containers, llama.cpp GGUF, Ollama ≥0.24, gcloud CLI.

**Spec:** `docs/superpowers/specs/2026-07-09-lariat-ka-v2-local-model-design.md`

## Global Constraints

- GCP project `devvy-490312`, billing account `01A733-66BAB6-4297C6`, budget **$200 target** (guard aborts jobs if projection exceeds $200).
- Deployed Ollama model name stays **`lari-the-kitchen-assistant`** (native GUI app reads the compiled default, not `.env.local`).
- Modelfile has **no SYSTEM block** (prompts live only in `lib/ollama.ts`) — preserved.
- Serving params: temperature 0.2, top_p 0.85, num_predict 512, **num_ctx 16384**.
- All requests send `think: false` — candidates must tolerate it (chatml template, no `.Think`).
- `data/lariat.db` is the **live production DB** — generator reads a snapshot only, via `LARIAT_DATA_DIR`.
- Dataset seed: **20260709**. Dataset output is **gitignored** (derived business data).
- No training data from HR/labor/PII sources; client names pseudonymized.
- Base models (pinned): `Qwen/Qwen3-8B`, `Qwen/Qwen3-4B-Instruct-2507`, `meta-llama/Llama-3.1-8B-Instruct` (skip Llama automatically if `HF_TOKEN` absent/unaccepted).
- All work in worktree `.claude/worktrees/lariat-ka-v2-local-model`, branch `feat/lariat-ka-v2-local-model`.
- Before every commit: run the repo verify gates relevant to the change; `detect_changes()` via GitNexus before the final commit set.

---

### Task 1: Scaffolding, DB snapshot, preflight

**Files:**
- Create: `training/gcp/preflight.sh`
- Modify: `.gitignore` (append artifact dirs)
- Create (untracked, runtime): `training/datasetv2/out/`, `training/gcp/artifacts/`, `training/gcp/snapshot/`

**Interfaces:**
- Produces: `training/gcp/snapshot/lariat.db` (read-only snapshot used by every generator run via `LARIAT_DATA_DIR=training/gcp/snapshot`); preflight exit 0 = environment sane.

- [ ] **Step 1: Append to `.gitignore`**

```gitignore
# KA v2 training pipeline (derived data / model artifacts — never commit)
training/datasetv2/out/
training/gcp/artifacts/
training/gcp/snapshot/
training/gcp/*.log
```

- [ ] **Step 2: Write `training/gcp/preflight.sh`**

```bash
#!/usr/bin/env bash
# KA v2 preflight — verifies every local dependency the pipeline needs,
# and snapshots the live DB so nothing downstream ever touches it.
# Usage: bash training/gcp/preflight.sh [--skip-snapshot]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CANON="${LARIAT_CANONICAL_REPO:-$HOME/Dev/hospitality/Lariat}"
fail() { echo "PREFLIGHT FAIL: $1" >&2; exit 1; }

command -v node >/dev/null || fail "node not on PATH"
node -e 'process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)' || fail "node >= 22 required"
command -v gcloud >/dev/null || fail "gcloud not installed"
command -v sqlite3 >/dev/null || fail "sqlite3 not installed"
command -v ollama >/dev/null || fail "ollama not installed"
command -v hermes >/dev/null || fail "hermes CLI not installed (eval grader)"
hermes config show >/dev/null 2>&1 || fail "hermes not configured (eval grader)"
gcloud config get-value project 2>/dev/null | grep -q devvy-490312 || fail "gcloud project != devvy-490312"

# .ts import bridge — same mechanism run-eval.mjs uses
node --experimental-strip-types --no-warnings -e \
  "import('$REPO/lib/ollama.ts').then(m => { if (!m.GROUNDED_SYSTEM) throw new Error('no GROUNDED_SYSTEM'); })" \
  || fail "cannot import lib/ollama.ts via --experimental-strip-types"

if [[ "${1:-}" != "--skip-snapshot" ]]; then
  [[ -f "$CANON/data/lariat.db" ]] || fail "live DB not found at $CANON/data/lariat.db"
  mkdir -p "$HERE/snapshot"
  # .backup takes a consistent read snapshot even with WAL active
  sqlite3 "file:$CANON/data/lariat.db?mode=ro" ".backup '$HERE/snapshot/lariat.db'"
  # generator needs the tracked data/ satellites too (cache json, seeds)
  echo "snapshot: $(du -h "$HERE/snapshot/lariat.db" | cut -f1) at $HERE/snapshot/lariat.db"
fi
echo "PREFLIGHT OK"
```

- [ ] **Step 3: Run it**

Run: `bash training/gcp/preflight.sh`
Expected: `snapshot: ...` line + `PREFLIGHT OK`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add .gitignore training/gcp/preflight.sh
git commit -m "chore(training): ka-v2 scaffolding, preflight + live-DB snapshot guard"
```

---

### Task 2: Eval harness — ollama gate + ollama-only mode (TDD)

**Files:**
- Create: `training/eval/tally.mjs`
- Modify: `training/eval/run-eval.mjs`
- Test: `tests/js/test-eval-tally.mjs`
- Modify: `package.json` (add `test:eval-tally` script)

**Interfaces:**
- Produces: `tallyVerdicts(entries, leg) -> {pass, partial, fail, error, score}` (score = pass + 0.5*partial); env flags `EVAL_REQUIRE_OLLAMA=1` (exit 2 if Ollama unreachable; ollama tally gates exit), `EVAL_OLLAMA_ONLY=1` (skip the hermes candidate leg; grading still via hermes). Default behavior with no flags is byte-identical to today.

- [ ] **Step 1: Write the failing test `tests/js/test-eval-tally.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { tallyVerdicts } from '../../training/eval/tally.mjs';

test('tallies claude leg with mixed verdicts', () => {
  const entries = [
    { runners: { claude: { ok: true, verdict: 'PASS' } } },
    { runners: { claude: { ok: true, verdict: 'PARTIAL' } } },
    { runners: { claude: { ok: false, error: 'x' } } },
  ];
  assert.deepEqual(tallyVerdicts(entries, 'claude'),
    { pass: 1, partial: 1, fail: 0, error: 1, score: 1.5 });
});

test('tallies ollama leg; missing runner counts as error', () => {
  const entries = [
    { runners: { claude: { ok: true, verdict: 'PASS' }, ollama: { ok: true, verdict: 'FAIL' } } },
    { runners: { claude: { ok: true, verdict: 'PASS' } } }, // no ollama entry
  ];
  assert.deepEqual(tallyVerdicts(entries, 'ollama'),
    { pass: 0, partial: 0, fail: 1, error: 1, score: 0 });
});

test('UNKNOWN verdict counts as error', () => {
  const entries = [{ runners: { ollama: { ok: true, verdict: 'UNKNOWN' } } }];
  assert.equal(tallyVerdicts(entries, 'ollama').error, 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/js/test-eval-tally.mjs`
Expected: FAIL — `Cannot find module .../training/eval/tally.mjs`

- [ ] **Step 3: Write `training/eval/tally.mjs`**

```js
// Pure verdict tally, extracted so the gate logic is unit-testable.
// A leg entry that is missing, not-ok, or graded UNKNOWN counts as error.
export function tallyVerdicts(entries, leg) {
  const t = { pass: 0, partial: 0, fail: 0, error: 0, score: 0 };
  for (const e of entries) {
    const r = e.runners?.[leg];
    const v = r && r.ok ? (r.verdict || 'UNKNOWN') : 'ERROR';
    if (v === 'PASS') t.pass++;
    else if (v === 'PARTIAL') t.partial++;
    else if (v === 'FAIL') t.fail++;
    else t.error++;
  }
  t.score = t.pass + 0.5 * t.partial;
  return t;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `node --test tests/js/test-eval-tally.mjs`
Expected: 3 passing.

- [ ] **Step 5: Wire flags into `run-eval.mjs`**

Edits to `training/eval/run-eval.mjs` (additive; default path unchanged):

a. After line 45 (`const OLLAMA_MODEL = ...`) add:

```js
const REQUIRE_OLLAMA = process.env.EVAL_REQUIRE_OLLAMA === '1';
const OLLAMA_ONLY = process.env.EVAL_OLLAMA_ONLY === '1';
```

b. Add import at top with the other imports:

```js
import { tallyVerdicts } from './tally.mjs';
```

c. In `main()`, right after `const useOllama = await ollamaReachable();`:

```js
  if (REQUIRE_OLLAMA && !useOllama) {
    console.error(`EVAL_REQUIRE_OLLAMA=1 but Ollama is unreachable at ${OLLAMA_URL}`);
    process.exit(2);
  }
```

d. Guard the claude leg (the `// --- claude leg (always) ---` block) with `if (!OLLAMA_ONLY) { ... }` and when skipped set `entry.runners.claude = { ok: false, error: 'skipped (EVAL_OLLAMA_ONLY)' };` — grading of the ollama leg is untouched.

e. Replace the inline per-scenario tally variables' final use: keep the existing console lines, then before the exit-code decision compute:

```js
  const claudeTally = tallyVerdicts(results, 'claude');
  const ollamaTally = useOllama ? tallyVerdicts(results, 'ollama') : null;
  if (ollamaTally) {
    console.log(`ollama-leg: PASS=${ollamaTally.pass} PARTIAL=${ollamaTally.partial} FAIL=${ollamaTally.fail} ERR=${ollamaTally.error} score=${ollamaTally.score}`);
  }
```

Add `ollama_totals: ollamaTally` to the `summary` object.

f. Exit-code block becomes:

```js
  if (REQUIRE_OLLAMA) {
    // Gate on the deployed-model leg. Threshold: any FAIL or ERROR fails the
    // gate; PARTIAL tolerated (historical deployed baseline is 8-9/10).
    if (!ollamaTally || ollamaTally.fail > 0 || ollamaTally.error > 0) process.exit(1);
  } else if (!OLLAMA_ONLY) {
    // original behavior: frozen 10/10 claude-leg baseline
    if (claudeTally.fail > 0 || claudeTally.error > 0 || claudeTally.partial > 0) process.exit(1);
  }
```

(The pre-existing `totalPass/totalFail/...` counters can be deleted in favor of `claudeTally` — keep the printed `totals:` line, sourcing from `claudeTally`.)

- [ ] **Step 6: Verify no regression + add npm script**

In `package.json` scripts add: `"test:eval-tally": "node --test tests/js/test-eval-tally.mjs"`.
Run: `npm run test:eval-tally` → pass. Run `node --experimental-strip-types --no-warnings -e "import('./training/eval/run-eval.mjs')"` — should not throw at import time (won't run main… `main()` runs on import; instead verify with `EVAL_SCENARIOS=/dev/null` expecting exit 2 crash path, or simply run `npm run eval:assistant-prompt` later in Task 15 as the live check).

- [ ] **Step 7: Commit**

```bash
git add training/eval/tally.mjs training/eval/run-eval.mjs tests/js/test-eval-tally.mjs package.json
git commit -m "feat(eval): ollama-leg gate (EVAL_REQUIRE_OLLAMA) + ollama-only mode + tested tally"
```

---

### Task 3: Dataset v2 core — RNG, scrub, contamination filter, emit (TDD)

**Files:**
- Create: `training/datasetv2/core.mjs`
- Test: `tests/js/test-dataset-v2-core.mjs`
- Modify: `package.json` (script `test:dataset-v2`)

**Interfaces:**
- Produces:
  - `makeRng(seed:number) -> () => number` (mulberry32, deterministic)
  - `pick(rng, arr)`, `shuffle(rng, arr)` (non-mutating)
  - `buildScrubber(clientNames: string[]) -> (s: string) => string` (deterministic pseudonyms "Client A", "Client B"… by sorted order; whole-word, case-insensitive)
  - `shingles(text, n=8) -> Set<string>` (word n-grams, lowercased, punctuation-stripped)
  - `contaminated(example, scenarioShingleSet) -> boolean` (any user-message shingle ∈ scenario set)
  - `emitJsonl(path, rows)` / row shape `{messages:[{role:'system',content},{role:'user',content},{role:'assistant',content}], meta:{slice:string}}` — meta is stripped at emit time into a sidecar stats file.

- [ ] **Step 1: Write failing tests `tests/js/test-dataset-v2-core.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, pick, shuffle, buildScrubber, shingles, contaminated } from '../../training/datasetv2/core.mjs';

test('rng is deterministic for a fixed seed', () => {
  const a = makeRng(20260709), b = makeRng(20260709);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('shuffle is deterministic and non-mutating', () => {
  const src = [1, 2, 3, 4, 5];
  const out1 = shuffle(makeRng(7), src);
  const out2 = shuffle(makeRng(7), src);
  assert.deepEqual(out1, out2);
  assert.deepEqual(src, [1, 2, 3, 4, 5]);
});

test('scrubber pseudonymizes client names, whole word, case-insensitive', () => {
  const scrub = buildScrubber(['Acme Corp', 'Blue Ranch']);
  assert.equal(scrub('Invoice for acme corp and Blue Ranch.'), 'Invoice for Client A and Client B.');
  assert.equal(scrub('Acmecorp stays'), 'Acmecorp stays');
});

test('contamination detects 8-gram overlap with scenarios', () => {
  const scen = shingles('the brisket has been sitting at 90 F for three hours what do I do');
  const bad = { messages: [{ role: 'user', content: 'X the brisket has been sitting at 90 F for three hours yes' }] };
  const ok = { messages: [{ role: 'user', content: 'scale the bacon jam recipe to fifty quarts please' }] };
  assert.equal(contaminated(bad, scen), true);
  assert.equal(contaminated(ok, scen), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/js/test-dataset-v2-core.mjs` → FAIL (module not found).

- [ ] **Step 3: Implement `training/datasetv2/core.mjs`**

```js
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildScrubber(clientNames) {
  const sorted = [...new Set(clientNames.filter(Boolean))].sort();
  const rules = sorted.map((name, i) => ({
    re: new RegExp(`\\b${esc(name)}\\b`, 'gi'),
    to: `Client ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`,
  }));
  return (s) => rules.reduce((acc, r) => acc.replace(r.re, r.to), s);
}

const norm = (t) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

export function shingles(text, n = 8) {
  const w = norm(text);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

export function contaminated(example, scenarioShingleSet, n = 8) {
  const user = example.messages.find((m) => m.role === 'user')?.content || '';
  for (const sh of shingles(user, n)) if (scenarioShingleSet.has(sh)) return true;
  return false;
}

export function emitJsonl(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  const clean = rows.map(({ meta, ...rest }) => rest);
  writeFileSync(path, clean.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return clean.length;
}
```

- [ ] **Step 4: Run tests → pass; add npm script**

`"test:dataset-v2": "node --test tests/js/test-dataset-v2-core.mjs tests/js/test-dataset-v2-slices.mjs"` (second file arrives in Task 5; until then point at the core file only and extend in Task 5).

- [ ] **Step 5: Commit**

```bash
git add training/datasetv2/core.mjs tests/js/test-dataset-v2-core.mjs package.json
git commit -m "feat(training): dataset-v2 core — seeded rng, PII scrubber, contamination filter"
```

---

### Task 4: Dataset v2 — real context + entity sampling

**Files:**
- Create: `training/datasetv2/sources.mjs`

**Interfaces:**
- Consumes: `LARIAT_DATA_DIR` env (points at `training/gcp/snapshot` merged view — see Step 1), production `lib/kitchenAssistantContext.ts::buildGroundedContext`, `lib/dbQueryTool.ts::renderQueryCatalog`, `lib/dbQueryRegistry.ts`, `lib/ollama.ts::GROUNDED_SYSTEM`.
- Produces (all async, loaded once):
  - `loadSources() -> { recipes, menuItems, orderGuideItems, beoEvents, stations, allergenMatrix, clientNames, complianceRules }` (plain arrays/objects read from the snapshot DB via `better-sqlite3` readonly + `data/cache/*.json`)
  - `buildRuntimeUserMessage({ contextText, catalog, history, message, directive }) -> string` — byte-identical template to `app/api/kitchen-assistant/route.js` (`CONTEXT (authoritative — only use these facts for operational claims):\n\n{contextText}\n\n{queryCatalog}\n{semanticSearchCatalog}{historyBlock}---\nCOOK MESSAGE:\n{message}` + directive block)
  - `realContext(message, {hasPin}) -> Promise<string>` — calls `buildGroundedContext` against the snapshot
  - `ACTION_DIRECTIVE` and `answerFormatBlock(devSearch:boolean)` — exact strings copied from `route.js:295-322`
  - `GROUNDED` — re-export of `GROUNDED_SYSTEM`.

**Notes for the implementer:**
- The snapshot dir only holds `lariat.db`; `buildGroundedContext` also reads `data/cache/*.json` through `lib/data.ts`, which resolves from `LARIAT_DATA_DIR`. Therefore Step 1 populates the snapshot dir as a full data-dir view: copy (cp -R) the worktree-tracked `data/cache`, `data/normalized`, `data/seeds`, `data/templates`, `data/inventory` into `training/gcp/snapshot/` next to `lariat.db`. Do this inside `preflight.sh` (extend it) so the view is rebuilt on every preflight.
- `clientNames` = `SELECT DISTINCT client FROM beo_events WHERE client IS NOT NULL` + `SELECT DISTINCT contact_name FROM beo_events` (check actual columns with `sqlite3 snapshot/lariat.db '.schema beo_events'` first; use whatever name/contact columns exist).
- The exact directive strings must be copy-pasted from `app/api/kitchen-assistant/route.js` lines 295–322 at implementation time (single source of truth; do not paraphrase). Add a comment in `sources.mjs` naming the source lines and a drift test in Task 5 Step 1 that greps `route.js` for the literal sentinel `ACTION ENGINE DIRECTIVE:` and `ANSWER FORMAT:` to ensure both still exist.

- [ ] **Step 1: Extend `preflight.sh`** — after the sqlite `.backup`, add:

```bash
  for d in cache normalized seeds templates inventory; do
    [[ -d "$REPO/data/$d" ]] && rm -rf "$HERE/snapshot/$d" && cp -R "$REPO/data/$d" "$HERE/snapshot/$d"
  done
```

- [ ] **Step 2: Implement `training/datasetv2/sources.mjs`** — module skeleton:

```js
// Loads real Lariat entities + production prompt builders for dataset v2.
// MUST be run with:  LARIAT_DATA_DIR=training/gcp/snapshot node --experimental-strip-types ...
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

if (!process.env.LARIAT_DATA_DIR) {
  throw new Error('dataset v2 must run with LARIAT_DATA_DIR pointing at the snapshot dir');
}
const SNAP = process.env.LARIAT_DATA_DIR;

const { GROUNDED_SYSTEM } = await import('../../lib/ollama.ts');
const { buildGroundedContext } = await import('../../lib/kitchenAssistantContext.ts');
const { renderQueryCatalog } = await import('../../lib/dbQueryTool.ts');

export const GROUNDED = GROUNDED_SYSTEM;

export async function realContext(message, { hasPin = false } = {}) {
  const { contextText } = await buildGroundedContext('main', message, { hasPin });
  return contextText;
}

export function catalogFor(tier) { return renderQueryCatalog(tier); }

// ---- exact route.js template ----------------------------------------------
export const SEMANTIC_CATALOG = `
SEMANTIC SEARCH ACTION:
- For fuzzy recipe, BEO, or kitchen audit-memory lookup, you may emit:
  { "action": "semantic_search", "query": "natural language search text", "limit": 6 }
- This action is read-only and available at cook tier.
- Use it when exact names are missing, for example "that wedding cake recipe with the cherry filling".`;

export const ACTION_DIRECTIVE = `…copy verbatim from app/api/kitchen-assistant/route.js:295-315…`;
export function answerFormatBlock() {
  return `…copy verbatim from route.js:317-322 with readActionException = 'if the read-only db_query catalog or semantic_search action is the right tool'…`;
}

export function buildRuntimeUserMessage({ contextText, tier = 'cook', history = '', message, directive = '' }) {
  const historyBlock = history ? `\n---\n${history}\n` : '\n';
  let u = `CONTEXT (authoritative — only use these facts for operational claims):\n\n${contextText}\n\n${catalogFor(tier)}\n${SEMANTIC_CATALOG}${historyBlock}---\nCOOK MESSAGE:\n${message}`;
  if (directive) u += directive;
  return u;
}

export function loadSources() {
  const db = new Database(join(SNAP, 'lariat.db'), { readonly: true });
  const recipes = JSON.parse(readFileSync(join(SNAP, 'cache', 'recipes.json'), 'utf8'));
  const allergenMatrix = JSON.parse(readFileSync(join(SNAP, 'cache', 'allergen_matrix.json'), 'utf8'));
  const orderGuideItems = db.prepare('SELECT ingredient, base_qty, unit FROM order_guide_items').all();
  const menuItems = db.prepare('SELECT * FROM entities_menu_items LIMIT 500').all();
  const beoEvents = db.prepare('SELECT * FROM beo_events').all();
  const stations = JSON.parse(readFileSync(join(SNAP, 'cache', 'stations.json'), 'utf8'));
  const complianceRules = readFileSync(join(SNAP, 'normalized', 'compliance_rules.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  const clientNames = beoEvents.flatMap((e) => [e.client, e.contact_name, e.client_name]).filter(Boolean);
  db.close();
  return { recipes, allergenMatrix, orderGuideItems, menuItems, beoEvents, stations, complianceRules, clientNames };
}
```

(Adjust column/JSON key names to reality — inspect with `sqlite3 ... '.schema'` and `head -c 600 snapshot/cache/*.json` first. `'main'` as locationId: verify the real default location id with `SELECT DISTINCT location_id FROM order_guide_items LIMIT 3` and use that literal.)

- [ ] **Step 3: Smoke-run**

Run:
```bash
LARIAT_DATA_DIR=training/gcp/snapshot node --experimental-strip-types --no-warnings -e "
const s = await import('./training/datasetv2/sources.mjs');
const src = s.loadSources();
console.log('recipes', src.recipes.length ?? Object.keys(src.recipes).length, 'clients', src.clientNames.length);
const ctx = await s.realContext('what is 86 today?', {});
console.log('ctx chars', ctx.length);
console.log(s.buildRuntimeUserMessage({ contextText: ctx.slice(0,200), message: 'test' }).slice(0, 300));
"
```
Expected: non-zero recipe count, context chars ≤ 12000, template preview matching route.js shape.

- [ ] **Step 4: Commit**

```bash
git add training/datasetv2/sources.mjs training/gcp/preflight.sh
git commit -m "feat(training): dataset-v2 sources — real DB/context sampling via production builders"
```

---

### Task 5: Dataset v2 — slice generators (TDD on the invariants)

**Files:**
- Create: `training/datasetv2/slices.mjs`
- Test: `tests/js/test-dataset-v2-slices.mjs`

**Interfaces:**
- Consumes: Task 3 core + Task 4 sources.
- Produces: `generateAll(sources, rng, opts) -> example[]` where every example is `{messages:[system,user,assistant], meta:{slice}}`. Slices and target counts (before filtering): `action_json` 1500, `db_query` 600, `grounded_qa` 1200, `allergen` 300, `haccp` 400, `refusal` 400.

**Slice construction rules (binding):**
- **action_json** (command path): user message built with `buildRuntimeUserMessage({..., directive: ACTION_DIRECTIVE})`; assistant target = ` ```json\n{...}\n``` ` fenced action object **first**, then one short kitchen-voice confirmation line. Cover all 10 write actions, weighted: eighty_six 200, update_inventory 200, line_check 200, scale_recipe 250, update_order_guide 150, beo_add_prep 120, maintenance 120, give_gold_star 60, haccp_receive 120, generate_prep 80. Entities drawn from real recipes/order-guide/BEO ids via `pick(rng, ...)`; phrasing from ≥8 imperative templates per action (e.g. scale_recipe: "scale {recipe} to {n}x", "I need {n} batches of {recipe}", "bump {recipe} up {n} times", "quadruple the {recipe}" → multiplier 4 …). For scale_recipe/beo_add_prep/generate_prep the confirmation line must NOT contain any computed ingredient quantity (rule 10). line_check with a temperature: emit `reading_f` + `temp_point_id`, `status` MUST be absent from the JSON when reading_f is present.
- **db_query** (question path): directive = `answerFormatBlock()`; assistant target = fenced db_query JSON with a real registry `name` + only declared params, then `Here's what I found:` or nothing. Cover all 30 registry names (import the registry live: `const { listQueriesForTier } = await import('../../lib/dbQueryTool.ts')` — or read names via `renderQueryCatalog` parsing; prefer the typed export if present). Manager-tier queries: generate under `tier:'manager'`. Include ~60 `semantic_search` examples.
- **grounded_qa**: real context via `realContext(question)`; questions generated from the entities *actually present in that context* (parse recipe names back out of contextText, or ask about the recipe used to seed the message). Assistant answers ONLY from facts in the context, kitchen voice, bullets.
- **allergen**: questions about real dishes' allergens; answers cite the triggering ingredient from the allergen matrix, always include cross-contact caveat + manager escalation, NEVER the words "safe", "free of", "does not contain".
- **haccp**: temps/cooling/receiving/TPHC questions; answers cite exact FDA numbers from `HACCP_BLOCK` (165/15s poultry, 155 ground, 145 fish, 140 hot-hold, 135→70/2h then 70→41/4h 6h total, ≤41 walk-in, ≤0 freezer, ≤41 receiving); cooling-violation cases must declare non-compliance + corrective action + log/escalate.
- **refusal**: questions whose answers are NOT in the provided context (live POS numbers, future schedules, guest counts, prices not on file, items absent from context) → state it's not in today's Cockpit data, point to the correct real source (Recipe Hub / 86 board / manager / Toast / order guide), fabricate nothing.
- Every assistant target in prose slices ≤ ~120 words, bullets preferred (num_predict 512 budget).

- [ ] **Step 1: Write failing invariant tests `tests/js/test-dataset-v2-slices.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Slices import production .ts — run generation once via a strip-types child,
// dumping a small deterministic sample to stdout as JSON.
function sample(n = 200) {
  const out = execFileSync(process.execPath,
    ['--experimental-strip-types', '--no-warnings', 'training/datasetv2/sample-for-tests.mjs', String(n)],
    { env: { ...process.env, LARIAT_DATA_DIR: 'training/gcp/snapshot' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}
const rows = sample();

test('every action_json example round-trips extractAction with a known action', () => {
  const ACTIONS = new Set(['eighty_six','update_inventory','line_check','maintenance','scale_recipe',
    'update_order_guide','beo_add_prep','give_gold_star','haccp_receive','generate_prep','db_query','semantic_search']);
  for (const r of rows.filter((r) => ['action_json','db_query'].includes(r.meta.slice))) {
    const { payload } = r.extracted; // sample script pre-runs extractAction
    assert.ok(payload, `no payload extracted: ${r.messages[2].content.slice(0, 120)}`);
    assert.ok(ACTIONS.has(payload.action), `unknown action ${payload.action}`);
  }
});

test('line_check with reading_f never carries status', () => {
  for (const r of rows.filter((r) => r.extracted?.payload?.action === 'line_check')) {
    const p = r.extracted.payload;
    if (p.reading_f != null) assert.equal(p.status, undefined);
  }
});

test('allergen answers never claim safety', () => {
  for (const r of rows.filter((r) => r.meta.slice === 'allergen')) {
    const a = r.messages[2].content.toLowerCase();
    for (const banned of ['is safe', 'free of', 'does not contain', "doesn't contain"]) {
      assert.ok(!a.includes(banned), `banned phrase "${banned}" in: ${a.slice(0, 140)}`);
    }
    assert.match(a, /cross[- ]contact/);
    assert.match(a, /manager/);
  }
});

test('system message is the live GROUNDED_SYSTEM on every row', () => {
  for (const r of rows) assert.match(r.messages[0].content, /^You are a kitchen assistant for a restaurant using the Lariat Cockpit app\./);
});

test('user messages carry the runtime CONTEXT template', () => {
  for (const r of rows) assert.match(r.messages[1].content, /^CONTEXT \(authoritative — only use these facts for operational claims\):/);
});
```

- [ ] **Step 2: Write `training/datasetv2/sample-for-tests.mjs`**

```js
// Emits the first N generated examples as JSON (with extractAction pre-run)
// so plain node:test files don't need --experimental-strip-types themselves.
import { makeRng } from './core.mjs';
import { loadSources } from './sources.mjs';
import { generateAll } from './slices.mjs';
const { extractAction } = await import('../../lib/extractAction.ts');

const n = parseInt(process.argv[2] || '200', 10);
const rows = (await generateAll(loadSources(), makeRng(20260709), { perSliceCap: Math.ceil(n / 6) })).slice(0, n);
for (const r of rows) r.extracted = extractAction(r.messages[2].content);
process.stdout.write(JSON.stringify(rows));
```

- [ ] **Step 3: Run tests → FAIL (slices.mjs missing)**

Run: `node --test tests/js/test-dataset-v2-slices.mjs`

- [ ] **Step 4: Implement `training/datasetv2/slices.mjs`**

Implement `generateAll(sources, rng, {perSliceCap})` per the binding rules above. Structure:

```js
import { pick, shuffle } from './core.mjs';
import { GROUNDED, realContext, buildRuntimeUserMessage, ACTION_DIRECTIVE, answerFormatBlock } from './sources.mjs';

const row = (user, assistant, slice) => ({
  messages: [
    { role: 'system', content: GROUNDED },
    { role: 'user', content: user },
    { role: 'assistant', content: assistant },
  ],
  meta: { slice },
});
const fence = (obj) => '```json\n' + JSON.stringify(obj) + '\n```';

async function genScaleRecipe(sources, rng, n) { /* templates -> fence({action:'scale_recipe',recipe:slug,multiplier}) + confirmation */ }
// ... one generator per action / slice, each ~15-30 lines, following the binding rules ...

export async function generateAll(sources, rng, opts = {}) { /* call every slice generator, honor perSliceCap, return flat array */ }
```

Context reuse note: `realContext()` costs a real context build (~100ms+, may cold-load vector packs). Build a pool of ~120 real contexts keyed by representative messages (one per slice family × entity bucket) and reuse across examples within a slice — vary the COOK MESSAGE, not the context, except grounded_qa where question and context must cohere (generate the question FROM the sampled context's entities).

- [ ] **Step 5: Run tests until green**

Run: `node --test tests/js/test-dataset-v2-slices.mjs`
Expected: all 5 invariant tests pass. Update `test:dataset-v2` npm script to include both test files.

- [ ] **Step 6: Commit**

```bash
git add training/datasetv2/slices.mjs training/datasetv2/sample-for-tests.mjs tests/js/test-dataset-v2-slices.mjs package.json
git commit -m "feat(training): dataset-v2 slice generators with invariant tests"
```

---

### Task 6: Dataset v2 — assembler + full generation

**Files:**
- Create: `training/datasetv2/generate.mjs`
- Modify: `package.json` (script `training:generate-v2`)

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces: `training/datasetv2/out/train.jsonl`, `out/val.jsonl` (90/10), `out/stats.json` `{perSlice, dropped:{contaminated, invalidAction}, totals, seed, generatedAt}` — stats committed? No: out/ is gitignored; stats content is pasted into the PR body instead.

- [ ] **Step 1: Implement `training/datasetv2/generate.mjs`**

```js
// Entry point: LARIAT_DATA_DIR=training/gcp/snapshot node --experimental-strip-types training/datasetv2/generate.mjs
import { readFileSync } from 'node:fs';
import { makeRng, shuffle, buildScrubber, shingles, contaminated, emitJsonl } from './core.mjs';
import { loadSources } from './sources.mjs';
import { generateAll } from './slices.mjs';
const { extractAction } = await import('../../lib/extractAction.ts');

const SEED = 20260709;
const rng = makeRng(SEED);
const sources = loadSources();

// scenario contamination set (user + context shingles of all 10 eval scenarios)
const scenarios = JSON.parse(readFileSync('training/eval/scenarios.json', 'utf8'));
const scenShingles = new Set();
for (const sc of scenarios) for (const sh of shingles(`${sc.user} ${sc.context}`)) scenShingles.add(sh);

const scrub = buildScrubber(sources.clientNames);
let rows = await generateAll(sources, rng, {});
const dropped = { contaminated: 0, invalidAction: 0 };
rows = rows.filter((r) => {
  if (contaminated(r, scenShingles)) { dropped.contaminated++; return false; }
  if (['action_json', 'db_query'].includes(r.meta.slice)) {
    const { payload } = extractAction(r.messages[2].content);
    if (!payload) { dropped.invalidAction++; return false; }
  }
  return true;
});
for (const r of rows) for (const m of r.messages) m.content = scrub(m.content);

const mixed = shuffle(rng, rows);
const valN = Math.floor(mixed.length * 0.1);
const val = mixed.slice(0, valN), train = mixed.slice(valN);
const perSlice = {};
for (const r of mixed) perSlice[r.meta.slice] = (perSlice[r.meta.slice] || 0) + 1;
emitJsonl('training/datasetv2/out/train.jsonl', train);
emitJsonl('training/datasetv2/out/val.jsonl', val);
const stats = { seed: SEED, totals: { train: train.length, val: val.length }, perSlice, dropped };
emitJsonl('training/datasetv2/out/stats.json', [stats]); // single-line JSON is fine
console.log(JSON.stringify(stats, null, 2));
```

npm script: `"training:generate-v2": "LARIAT_DATA_DIR=training/gcp/snapshot node --experimental-strip-types --no-warnings training/datasetv2/generate.mjs"`.

- [ ] **Step 2: Generate + eyeball**

Run: `npm run training:generate-v2`
Expected: stats JSON with train ≈ 3,800–4,000 / val ≈ 420–440, dropped counts small (<3%). Then manually inspect 10 random rows: `shuf -n 3 training/datasetv2/out/train.jsonl | python3 -m json.tool | head -120` — check fenced JSON placement, context realism, kitchen voice.

- [ ] **Step 3: PII spot-check**

Run: `for n in $(sqlite3 "file:training/gcp/snapshot/lariat.db?mode=ro" "SELECT DISTINCT client FROM beo_events WHERE client IS NOT NULL"); do grep -c "$n" training/datasetv2/out/train.jsonl && echo "LEAK: $n"; done; echo done`
Expected: only `done` (no LEAK lines). (Adapt the column per Task 4's schema check.)

- [ ] **Step 4: Commit**

```bash
git add training/datasetv2/generate.mjs package.json
git commit -m "feat(training): dataset-v2 assembler — contamination filter, PII scrub, 90/10 split"
```

---

### Task 7: Vertex training script (`train.py`) + requirements

**Files:**
- Create: `training/gcp/train.py`
- Create: `training/gcp/requirements.txt`

**Interfaces:**
- Consumes: GCS `gs://<bucket>/data/train.jsonl`, `val.jsonl` (chat-format `{messages:[...]}`).
- Produces (to `gs://<bucket>/runs/<run_id>/`): `model-q4_k_m.gguf`, `adapters/`, `metrics.json` `{run_id, base_model, val_loss, train_runtime_s, config}`.
- CLI: `python train.py --base <hf_id> --chat-template chatml|llama3 --run-id <id> --bucket <name> --lora-r <int> --lr <float> --epochs <int> --max-seq 8192 [--subset N]`.

- [ ] **Step 1: Write `training/gcp/requirements.txt`**

```
transformers>=4.51,<5
trl>=0.17,<0.20
peft>=0.15
bitsandbytes>=0.45
accelerate>=1.3
datasets>=3.2
sentencepiece
protobuf
gguf
huggingface_hub
google-cloud-storage
```

- [ ] **Step 2: Write `training/gcp/train.py`**

```python
#!/usr/bin/env python3
"""Lariat KA v2 — QLoRA SFT on Vertex AI, ends with on-VM GGUF q4_K_M.

Runs inside a Vertex prebuilt PyTorch GPU container. Deps are pinned in
requirements.txt (installed by the job's wrapper command, see launch-sweep).
"""
import argparse, json, os, shutil, subprocess, tempfile, time

CHATML = (
    "{% for message in messages %}{{ '<|im_start|>' + message['role'] + '\n' "
    "+ message['content'] + '<|im_end|>' + '\n' }}{% endfor %}"
    "{% if add_generation_prompt %}{{ '<|im_start|>assistant\n' }}{% endif %}"
)
LLAMA3 = None  # use the tokenizer's native template for llama-3.1

def sh(cmd, **kw):
    print(f"+ {cmd}", flush=True)
    subprocess.run(cmd, shell=True, check=True, **kw)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True)
    ap.add_argument('--chat-template', choices=['chatml', 'llama3'], required=True)
    ap.add_argument('--run-id', required=True)
    ap.add_argument('--bucket', required=True)
    ap.add_argument('--lora-r', type=int, default=16)
    ap.add_argument('--lr', type=float, default=2e-4)
    ap.add_argument('--epochs', type=int, default=3)
    ap.add_argument('--max-seq', type=int, default=8192)
    ap.add_argument('--subset', type=int, default=0, help='smoke: cap train rows')
    a = ap.parse_args()
    t0 = time.time()

    import torch
    from datasets import load_dataset
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from peft import LoraConfig
    from trl import SFTTrainer, SFTConfig
    from google.cloud import storage

    gcs = storage.Client()
    bkt = gcs.bucket(a.bucket)
    os.makedirs('/tmp/data', exist_ok=True)
    for split in ('train', 'val'):
        bkt.blob(f'data/{split}.jsonl').download_to_filename(f'/tmp/data/{split}.jsonl')

    ds = load_dataset('json', data_files={'train': '/tmp/data/train.jsonl', 'val': '/tmp/data/val.jsonl'})
    if a.subset:
        ds['train'] = ds['train'].select(range(min(a.subset, len(ds['train']))))
        ds['val'] = ds['val'].select(range(min(max(a.subset // 10, 8), len(ds['val']))))

    tok = AutoTokenizer.from_pretrained(a.base, trust_remote_code=True)
    if a.chat_template == 'chatml':
        tok.chat_template = CHATML  # plain chatml — no <think> scaffolding, matches the Ollama TEMPLATE
    bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4',
                             bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.bfloat16)
    model = AutoModelForCausalLM.from_pretrained(
        a.base, quantization_config=bnb, torch_dtype=torch.bfloat16,
        attn_implementation='sdpa', device_map='auto', trust_remote_code=True)

    peft_cfg = LoraConfig(r=a.lora_r, lora_alpha=2 * a.lora_r, lora_dropout=0.05, bias='none',
                          task_type='CAUSAL_LM',
                          target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'])
    cfg = SFTConfig(output_dir='/tmp/out', num_train_epochs=a.epochs, learning_rate=a.lr,
                    per_device_train_batch_size=1, gradient_accumulation_steps=8,
                    gradient_checkpointing=True, max_length=a.max_seq, packing=False,
                    bf16=True, logging_steps=20, eval_strategy='epoch', save_strategy='no',
                    lr_scheduler_type='cosine', warmup_ratio=0.03, optim='paged_adamw_8bit',
                    report_to=[])
    trainer = SFTTrainer(model=model, args=cfg, train_dataset=ds['train'],
                         eval_dataset=ds['val'], processing_class=tok, peft_config=peft_cfg)
    trainer.train()
    val = trainer.evaluate()
    trainer.save_model('/tmp/out/adapters')

    # merge LoRA into bf16 base for GGUF conversion
    del model, trainer
    torch.cuda.empty_cache()
    from peft import PeftModel
    base = AutoModelForCausalLM.from_pretrained(a.base, torch_dtype=torch.bfloat16,
                                                device_map='cpu', trust_remote_code=True)
    merged = PeftModel.from_pretrained(base, '/tmp/out/adapters').merge_and_unload()
    merged.save_pretrained('/tmp/merged', safe_serialization=True)
    tok.save_pretrained('/tmp/merged')

    # GGUF: convert (pure python) + quantize (small CPU cmake build)
    sh('git clone --depth 1 https://github.com/ggml-org/llama.cpp /tmp/llama.cpp')
    sh('pip install -q -r /tmp/llama.cpp/requirements/requirements-convert_hf_to_gguf.txt')
    sh('python /tmp/llama.cpp/convert_hf_to_gguf.py /tmp/merged --outtype f16 --outfile /tmp/model-f16.gguf')
    sh('cmake -S /tmp/llama.cpp -B /tmp/llama.cpp/build -DGGML_CUDA=OFF -DLLAMA_BUILD_TESTS=OFF '
       '-DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=OFF && '
       'cmake --build /tmp/llama.cpp/build --target llama-quantize -j')
    sh('/tmp/llama.cpp/build/bin/llama-quantize /tmp/model-f16.gguf /tmp/model-q4_k_m.gguf q4_k_m')

    prefix = f'runs/{a.run_id}'
    bkt.blob(f'{prefix}/model-q4_k_m.gguf').upload_from_filename('/tmp/model-q4_k_m.gguf', timeout=1200)
    for root, _, files in os.walk('/tmp/out/adapters'):
        for f in files:
            p = os.path.join(root, f)
            bkt.blob(f'{prefix}/adapters/{os.path.relpath(p, "/tmp/out/adapters")}').upload_from_filename(p)
    metrics = {'run_id': a.run_id, 'base_model': a.base, 'val_loss': val.get('eval_loss'),
               'train_runtime_s': round(time.time() - t0),
               'config': {'lora_r': a.lora_r, 'lr': a.lr, 'epochs': a.epochs, 'max_seq': a.max_seq}}
    bkt.blob(f'{prefix}/metrics.json').upload_from_string(json.dumps(metrics, indent=2))
    print('DONE', json.dumps(metrics))

if __name__ == '__main__':
    main()
```

- [ ] **Step 3: Local syntax check**

Run: `python3 -m py_compile training/gcp/train.py && echo OK`
Expected: `OK`. (Full validation is the Stage-0 smoke job, Task 11.)

- [ ] **Step 4: Commit**

```bash
git add training/gcp/train.py training/gcp/requirements.txt
git commit -m "feat(training): Vertex QLoRA train script with on-VM GGUF q4_K_M export"
```

---

### Task 8: Sweep config + launcher (TDD on matrix/projection math)

**Files:**
- Create: `training/gcp/sweep-config.json`
- Create: `training/gcp/sweep-lib.mjs`
- Create: `training/gcp/launch-sweep.mjs`
- Test: `tests/js/test-sweep-lib.mjs`

**Interfaces:**
- Produces: `expandMatrix(config) -> job[]` (`{runId, base, chatTemplate, machineType, acceleratorType, region, loraR, lr, epochs, estHours, estCost}`); `projectCost(jobs) -> number`; `pruneToBudget(jobs, capUsd, spentUsd) -> job[]` (keeps highest-priority per config order, drops from the tail); `gcloudArgs(job, config) -> string[]` (args array for `gcloud ai custom-jobs create`).
- `launch-sweep.mjs` CLI: `node training/gcp/launch-sweep.mjs [--smoke] [--spent <usd>]` — creates jobs, writes `training/gcp/artifacts/launched.json` (`{jobs:[{runId, jobName, region, state:'LAUNCHED', estCost}]}`).

- [ ] **Step 1: Write `training/gcp/sweep-config.json`**

```json
{
  "project": "devvy-490312",
  "bucket": "lariat-train-us-central1",
  "regions": ["us-central1", "us-east4", "us-west1", "europe-west4"],
  "containerUri": "us-docker.pkg.dev/vertex-ai/training/pytorch-gpu.2-4.py310:latest",
  "budgetUsd": 200,
  "rates": { "a2-highgpu-1g": 4.25, "g2-standard-8": 1.0, "g2-standard-12": 1.2 },
  "bases": [
    { "id": "Qwen/Qwen3-8B",              "chatTemplate": "chatml", "machineType": "a2-highgpu-1g", "acceleratorType": "NVIDIA_TESLA_A100", "acceleratorCount": 1, "estHoursPerEpoch": 1.6, "gated": false, "tag": "q3-8b" },
    { "id": "Qwen/Qwen3-4B-Instruct-2507", "chatTemplate": "chatml", "machineType": "g2-standard-8", "acceleratorType": "NVIDIA_L4", "acceleratorCount": 1, "estHoursPerEpoch": 2.2, "gated": false, "tag": "q3-4b" },
    { "id": "meta-llama/Llama-3.1-8B-Instruct", "chatTemplate": "llama3", "machineType": "a2-highgpu-1g", "acceleratorType": "NVIDIA_TESLA_A100", "acceleratorCount": 1, "estHoursPerEpoch": 1.6, "gated": true, "tag": "ll31-8b" }
  ],
  "grid": [
    { "loraR": 16, "lr": 2e-4, "epochs": 3 },
    { "loraR": 32, "lr": 1e-4, "epochs": 3 },
    { "loraR": 32, "lr": 2e-4, "epochs": 2 }
  ],
  "maxSeq": 8192,
  "smoke": { "base": "Qwen/Qwen3-4B-Instruct-2507", "subset": 200, "epochs": 1, "estHours": 0.7 }
}
```

- [ ] **Step 2: Failing tests `tests/js/test-sweep-lib.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandMatrix, projectCost, pruneToBudget, gcloudArgs } from '../../training/gcp/sweep-lib.mjs';

const config = JSON.parse(readFileSync('training/gcp/sweep-config.json', 'utf8'));

test('matrix expands bases x grid, skips gated without HF_TOKEN', () => {
  const jobs = expandMatrix(config, { hfToken: '' });
  assert.equal(jobs.length, 2 * config.grid.length);
  assert.ok(jobs.every((j) => !j.base.startsWith('meta-llama')));
  const withTok = expandMatrix(config, { hfToken: 'hf_x' });
  assert.equal(withTok.length, 3 * config.grid.length);
});

test('cost projection = hours * rate summed', () => {
  const jobs = [{ estHours: 2, machineType: 'g2-standard-8' }, { estHours: 1, machineType: 'a2-highgpu-1g' }];
  assert.equal(projectCost(jobs, config.rates), 2 * 1.0 + 1 * 4.25);
});

test('pruneToBudget drops tail jobs until projection fits', () => {
  const jobs = Array.from({ length: 9 }, (_, i) => ({ runId: `j${i}`, estHours: 10, machineType: 'a2-highgpu-1g' }));
  const kept = pruneToBudget(jobs, 100, 0, config.rates);
  assert.equal(kept.length, 2); // 2 * 42.5 = 85 <= 100, 3 would be 127.5
});

test('gcloudArgs shape', () => {
  const [job] = expandMatrix(config, { hfToken: '' });
  const args = gcloudArgs(job, config);
  assert.equal(args[0], 'ai');
  assert.ok(args.includes('custom-jobs'));
  assert.ok(args.some((s) => s.includes(`--region=${job.region}`)));
  assert.ok(args.some((s) => s.includes('machine-type=' + job.machineType)));
});
```

- [ ] **Step 3: Run → FAIL; implement `training/gcp/sweep-lib.mjs`**

```js
export function expandMatrix(config, { hfToken }) {
  const bases = config.bases.filter((b) => !b.gated || !!hfToken);
  const jobs = [];
  for (const b of bases) {
    for (const g of config.grid) {
      const estHours = b.estHoursPerEpoch * g.epochs + 0.6; // +GGUF/convert overhead
      jobs.push({
        runId: `${b.tag}-r${g.loraR}-lr${g.lr}-e${g.epochs}`.replace(/[.]/g, 'p'),
        base: b.id, chatTemplate: b.chatTemplate, machineType: b.machineType,
        acceleratorType: b.acceleratorType, acceleratorCount: b.acceleratorCount,
        region: config.regions[0], loraR: g.loraR, lr: g.lr, epochs: g.epochs,
        estHours, estCost: 0,
      });
    }
  }
  for (const j of jobs) j.estCost = j.estHours * config.rates[j.machineType];
  return jobs;
}

export const projectCost = (jobs, rates) =>
  jobs.reduce((s, j) => s + j.estHours * rates[j.machineType], 0);

export function pruneToBudget(jobs, capUsd, spentUsd, rates) {
  const kept = [];
  let acc = spentUsd;
  for (const j of jobs) {
    const c = j.estHours * rates[j.machineType];
    if (acc + c <= capUsd) { kept.push(j); acc += c; }
  }
  return kept;
}

export function gcloudArgs(job, config) {
  const cmd = [
    'pip install -q -r requirements.txt',
    `python train.py --base ${job.base} --chat-template ${job.chatTemplate} --run-id ${job.runId}` +
      ` --bucket ${config.bucket} --lora-r ${job.loraR} --lr ${job.lr} --epochs ${job.epochs} --max-seq ${config.maxSeq}` +
      (job.subset ? ` --subset ${job.subset}` : ''),
  ].join(' && ');
  return [
    'ai', 'custom-jobs', 'create',
    `--region=${job.region}`,
    `--project=${config.project}`,
    `--display-name=lariat-ka-v2-${job.runId}`,
    `--worker-pool-spec=machine-type=${job.machineType},accelerator-type=${job.acceleratorType},accelerator-count=${job.acceleratorCount},replica-count=1,container-image-uri=${config.containerUri},local-package-path=training/gcp,script=noop.sh`,
    // NOTE: gcloud's script= form generates its own entrypoint; we instead use args to run our command:
    `--args=-c,${JSON.stringify(cmd)}`,
    '--command=bash',
    '--format=json',
  ];
}
```

**Implementation note (binding):** the exact `--worker-pool-spec`/`--command/--args` combination must be validated against `gcloud ai custom-jobs create --help` at execution time — the plan's intent is: prebuilt container + our repo dir (`training/gcp`) shipped via `local-package-path` (gcloud tars & stages it to GCS) + entrypoint `bash -c "pip install -q -r requirements.txt && python train.py ..."`. If `local-package-path` requires `script=`, point `script=train-entry.sh` at a 3-line wrapper that does the pip install + exec python with args from env. Adjust `gcloudArgs` + its test to whatever the CLI actually accepts (the Stage-0 smoke job proves it end-to-end); keep the args-array interface stable. If `HF_TOKEN` is set locally, append `--env-vars=HF_TOKEN=$HF_TOKEN` for gated bases (worker-pool-spec env vars flag per CLI help).

- [ ] **Step 4: Tests green, then write `training/gcp/launch-sweep.mjs`**

```js
// Launches the sweep (or --smoke) via gcloud; records launched.json.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { expandMatrix, projectCost, pruneToBudget, gcloudArgs } from './sweep-lib.mjs';

const config = JSON.parse(readFileSync(new URL('./sweep-config.json', import.meta.url), 'utf8'));
const smoke = process.argv.includes('--smoke');
const spent = parseFloat((process.argv.find((a) => a.startsWith('--spent=')) || '--spent=0').split('=')[1]);

let jobs;
if (smoke) {
  const b = config.bases.find((x) => x.id === config.smoke.base);
  jobs = [{ runId: 'smoke-0', base: b.id, chatTemplate: b.chatTemplate, machineType: b.machineType,
    acceleratorType: b.acceleratorType, acceleratorCount: 1, region: config.regions[0],
    loraR: 16, lr: 2e-4, epochs: config.smoke.epochs, estHours: config.smoke.estHours,
    subset: config.smoke.subset }];
} else {
  jobs = pruneToBudget(expandMatrix(config, { hfToken: process.env.HF_TOKEN || '' }),
    config.budgetUsd, spent, config.rates);
}
console.log(`launching ${jobs.length} job(s), projected $${projectCost(jobs, config.rates).toFixed(2)} (+$${spent} spent)`);

const launched = [];
for (const job of jobs) {
  let lastErr = null;
  for (const region of config.regions) {  // region fallback on quota errors
    try {
      const out = execFileSync('gcloud', gcloudArgs({ ...job, region }, config), { encoding: 'utf8' });
      const meta = JSON.parse(out);
      launched.push({ runId: job.runId, jobName: meta.name, region, state: 'LAUNCHED', estCost: job.estCost });
      console.log(`  ${job.runId} -> ${meta.name} (${region})`);
      lastErr = null; break;
    } catch (e) { lastErr = e; console.error(`  ${job.runId} failed in ${region}: ${String(e.message).slice(0, 200)}`); }
  }
  if (lastErr) launched.push({ runId: job.runId, jobName: null, region: null, state: 'LAUNCH_FAILED', estCost: 0 });
}
mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true });
writeFileSync(new URL('./artifacts/launched.json', import.meta.url), JSON.stringify({ launched }, null, 2));
const failed = launched.filter((l) => l.state === 'LAUNCH_FAILED');
process.exit(failed.length === launched.length ? 1 : 0);
```

- [ ] **Step 5: Run sweep-lib tests**

Run: `node --test tests/js/test-sweep-lib.mjs` → 4 passing.

- [ ] **Step 6: Commit**

```bash
git add training/gcp/sweep-config.json training/gcp/sweep-lib.mjs training/gcp/launch-sweep.mjs tests/js/test-sweep-lib.mjs
git commit -m "feat(training): Vertex sweep matrix, budget pruning, region-fallback launcher"
```

---

### Task 9: Monitor + artifact download

**Files:**
- Create: `training/gcp/monitor.mjs`

**Interfaces:**
- Consumes: `artifacts/launched.json`, `gcloud ai custom-jobs describe <jobName> --region <r> --format json` (`.state` ∈ JOB_STATE_{PENDING,RUNNING,SUCCEEDED,FAILED,CANCELLED}), GCS `runs/<runId>/metrics.json` + `model-q4_k_m.gguf`.
- Produces: `artifacts/status.json` (refreshed each invocation) `{jobs:[{runId, state, elapsedH, costUsd}], totalCostUsd, done:boolean}`; on `--download`, pulls `metrics.json` for every SUCCEEDED run and the **top-4 GGUFs by val_loss** into `artifacts/<runId>/model-q4_k_m.gguf`.
- CLI: `node training/gcp/monitor.mjs [--download]` — single pass, exit 0 done / exit 3 still-running (the orchestrating session decides polling cadence).

- [ ] **Step 1: Implement `training/gcp/monitor.mjs`**

```js
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('./sweep-config.json', import.meta.url), 'utf8'));
const { launched } = JSON.parse(readFileSync(new URL('./artifacts/launched.json', import.meta.url), 'utf8'));
const doDownload = process.argv.includes('--download');
const gc = (args) => execFileSync('gcloud', args, { encoding: 'utf8' });
const gsutil = (args) => execFileSync('gcloud', ['storage', ...args], { encoding: 'utf8' });

const jobs = [];
for (const l of launched.filter((x) => x.jobName)) {
  const d = JSON.parse(gc(['ai', 'custom-jobs', 'describe', l.jobName, `--region=${l.region}`, '--format=json']));
  const start = d.startTime ? new Date(d.startTime).getTime() : Date.now();
  const end = d.endTime ? new Date(d.endTime).getTime() : Date.now();
  const elapsedH = Math.max(0, (end - start) / 3.6e6);
  const rate = config.rates[Object.values(d.jobSpec.workerPoolSpecs[0].machineSpec)[0]] ?? config.rates['g2-standard-8'];
  jobs.push({ runId: l.runId, state: d.state, elapsedH: +elapsedH.toFixed(2), costUsd: +(elapsedH * rate).toFixed(2) });
}
const done = jobs.every((j) => /SUCCEEDED|FAILED|CANCELLED/.test(j.state));
const totalCostUsd = +jobs.reduce((s, j) => s + j.costUsd, 0).toFixed(2);
writeFileSync(new URL('./artifacts/status.json', import.meta.url), JSON.stringify({ jobs, totalCostUsd, done }, null, 2));
console.table(jobs); console.log(`total ≈ $${totalCostUsd}, done=${done}`);

if (doDownload && done) {
  const metrics = [];
  for (const j of jobs.filter((x) => x.state === 'JOB_STATE_SUCCEEDED')) {
    const m = JSON.parse(gsutil(['cat', `gs://${config.bucket}/runs/${j.runId}/metrics.json`]));
    metrics.push(m);
  }
  metrics.sort((a, b) => (a.val_loss ?? 9e9) - (b.val_loss ?? 9e9));
  writeFileSync(new URL('./artifacts/metrics-all.json', import.meta.url), JSON.stringify(metrics, null, 2));
  for (const m of metrics.slice(0, 4)) {
    const dir = new URL(`./artifacts/${m.run_id}/`, import.meta.url);
    mkdirSync(dir, { recursive: true });
    const dst = new URL(`./artifacts/${m.run_id}/model-q4_k_m.gguf`, import.meta.url).pathname;
    if (!existsSync(dst)) gsutil(['cp', `gs://${config.bucket}/runs/${m.run_id}/model-q4_k_m.gguf`, dst]);
  }
  console.log('downloaded top', Math.min(4, metrics.length), 'candidates by val_loss');
}
process.exit(done ? 0 : 3);
```

(Note: the `rate` lookup via machineSpec is fiddly — simplest correct form is to carry `machineType` through `launched.json` from the launcher; do that: add `machineType: job.machineType` in launch-sweep's `launched.push`, and read it here instead of parsing `jobSpec`.)

- [ ] **Step 2: Commit**

```bash
git add training/gcp/monitor.mjs training/gcp/launch-sweep.mjs
git commit -m "feat(training): sweep monitor with cost accounting + top-4 GGUF download"
```

---

### Task 10: Candidate packaging + evaluation runner

**Files:**
- Create: `training/gcp/evaluate-candidates.mjs`
- Create: `training/gcp/Modelfile.qwen-v2.tmpl`, `training/gcp/Modelfile.llama31-v2.tmpl`

**Interfaces:**
- Consumes: `artifacts/<runId>/model-q4_k_m.gguf`, `artifacts/metrics-all.json`, patched eval harness (Task 2).
- Produces: per-candidate Ollama models `lari-ka-cand-<runId>`; `artifacts/eval-results.json` `[{runId, base, ollama:{pass,partial,fail,error,score}, latencyMsMedian, baseline:boolean}]`; console leaderboard.

- [ ] **Step 1: Write the Modelfile templates**

`training/gcp/Modelfile.qwen-v2.tmpl` (chatml — matches train.py's CHATML exactly):

```
FROM {{GGUF_PATH}}
TEMPLATE """{{- if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{- range .Messages }}<|im_start|>{{ .Role }}
{{ .Content }}<|im_end|>
{{ end }}<|im_start|>assistant
"""
PARAMETER stop <|im_end|>
PARAMETER temperature 0.2
PARAMETER top_p 0.85
PARAMETER num_predict 512
PARAMETER num_ctx 16384

# No SYSTEM block on purpose — single source of truth is lib/ollama.ts.
```

`training/gcp/Modelfile.llama31-v2.tmpl`:

```
FROM {{GGUF_PATH}}
TEMPLATE """{{- if .System }}<|start_header_id|>system<|end_header_id|>

{{ .System }}<|eot_id|>{{ end }}{{- range .Messages }}<|start_header_id|>{{ .Role }}<|end_header_id|>

{{ .Content }}<|eot_id|>{{ end }}<|start_header_id|>assistant<|end_header_id|>

"""
PARAMETER stop <|eot_id|>
PARAMETER temperature 0.2
PARAMETER top_p 0.85
PARAMETER num_predict 512
PARAMETER num_ctx 16384

# No SYSTEM block on purpose — single source of truth is lib/ollama.ts.
```

- [ ] **Step 2: Implement `training/gcp/evaluate-candidates.mjs`**

```js
// Packages each downloaded GGUF as an Ollama model and runs the patched eval
// (ollama leg only) against it, plus the DeepSeek baseline. Emits leaderboard.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const REPO = new URL('../../', import.meta.url).pathname;
const metrics = JSON.parse(readFileSync(`${HERE}artifacts/metrics-all.json`, 'utf8'));

function makeModel(runId, base) {
  const gguf = `${HERE}artifacts/${runId}/model-q4_k_m.gguf`;
  if (!existsSync(gguf)) return null;
  const tmpl = base.startsWith('meta-llama') ? 'Modelfile.llama31-v2.tmpl' : 'Modelfile.qwen-v2.tmpl';
  const mf = readFileSync(`${HERE}${tmpl}`, 'utf8').replace('{{GGUF_PATH}}', gguf);
  writeFileSync(`${HERE}artifacts/${runId}/Modelfile`, mf);
  execSync(`ollama create lari-ka-cand-${runId} -f ${HERE}artifacts/${runId}/Modelfile`, { stdio: 'inherit' });
  return `lari-ka-cand-${runId}`;
}

function runEval(model) {
  const t0 = Date.now();
  const r = execFileSync(process.execPath,
    ['--experimental-strip-types', '--no-warnings', 'training/eval/run-eval.mjs'],
    { cwd: REPO, encoding: 'utf8',
      env: { ...process.env, LARIAT_OLLAMA_MODEL: model, EVAL_REQUIRE_OLLAMA: '1', EVAL_OLLAMA_ONLY: '1' },
      // eval exits 1 on gate-fail — capture regardless
    }).toString();
  return { out: r, ms: Date.now() - t0 };
}
// NOTE: wrap runEval in try/catch (execFileSync throws on exit 1) and read the
// freshest results JSON from training/eval/results/ for the structured tally:
function latestResultTotals() {
  const dir = `${REPO}training/eval/results/`;
  const f = readdirSync(dir).filter((x) => x.endsWith('.json')).sort().at(-1);
  const j = JSON.parse(readFileSync(dir + f, 'utf8'));
  return { ollama: j.ollama_totals, model: j.ollama_model };
}

const rows = [];
for (const m of metrics.slice(0, 4)) {
  const model = makeModel(m.run_id, m.base_model);
  if (!model) continue;
  try { runEval(model); } catch { /* gate-fail exit is fine; results file still written */ }
  const t = latestResultTotals();
  rows.push({ runId: m.run_id, base: m.base_model, valLoss: m.val_loss, ...t.ollama, baseline: false });
}
// DeepSeek baseline (existing deployed model)
try { runEval('lari-the-kitchen-assistant'); } catch { /* same */ }
const bt = latestResultTotals();
rows.push({ runId: 'deepseek-baseline', base: 'deepseek-r1:14b', ...bt.ollama, baseline: true });

rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
writeFileSync(`${HERE}artifacts/eval-results.json`, JSON.stringify(rows, null, 2));
console.table(rows.map(({ runId, base, valLoss, pass, partial, fail, error, score }) =>
  ({ runId, base, valLoss, pass, partial, fail, error, score })));
```

Selection rule (applied by the orchestrator, not the script): highest `score` among non-baseline rows; tie → smaller model (4B beats 8B); the winner flips regardless of whether it beats the baseline (owner decision) — but the comparison is reported.

- [ ] **Step 3: Commit**

```bash
git add training/gcp/evaluate-candidates.mjs training/gcp/Modelfile.qwen-v2.tmpl training/gcp/Modelfile.llama31-v2.tmpl
git commit -m "feat(training): candidate packaging (chatml/llama3 templates) + eval leaderboard"
```

---

### Task 11: GCP setup script + EXECUTION: billing, bucket, budget, dataset upload, smoke job

**Files:**
- Create: `training/gcp/setup.sh`

**Interfaces:**
- Produces: billed project, `gs://lariat-train-us-central1`, $200 budget alert, dataset uploaded to `gs://…/data/`.

- [ ] **Step 1: Write `training/gcp/setup.sh`**

```bash
#!/usr/bin/env bash
# One-time GCP setup for the KA v2 sweep. Idempotent. AUTHORIZED SPEND: $200.
set -euo pipefail
PROJECT=devvy-490312
BILLING=01A733-66BAB6-4297C6
BUCKET=lariat-train-us-central1
REGION=us-central1

echo "== linking billing =="
gcloud billing projects link "$PROJECT" --billing-account="$BILLING"
echo "== enabling APIs =="
gcloud services enable aiplatform.googleapis.com storage.googleapis.com billingbudgets.googleapis.com --project "$PROJECT" --quiet
echo "== bucket =="
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location="$REGION" --uniform-bucket-level-access
echo "== budget ($200, alerts 50/75/90/100%) =="
gcloud billing budgets list --billing-account="$BILLING" --format="value(displayName)" | grep -q '^lariat-ka-v2$' || \
  gcloud billing budgets create --billing-account="$BILLING" --display-name=lariat-ka-v2 \
    --budget-amount=200USD \
    --filter-projects="projects/$PROJECT" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.75 \
    --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
echo "SETUP OK"
```

- [ ] **Step 2: Run setup (BILLABLE from here on)**

Run: `bash training/gcp/setup.sh`
Expected: `SETUP OK`. If budget-create fails on permissions, note it in the PR and rely on the launcher's projection guard (the guard is the hard stop either way).

- [ ] **Step 3: Upload dataset**

Run:
```bash
gcloud storage cp training/datasetv2/out/train.jsonl training/datasetv2/out/val.jsonl gs://lariat-train-us-central1/data/
```
Expected: two uploads. Re-run the PII spot-check (Task 6 Step 3) BEFORE this step.

- [ ] **Step 4: Launch Stage-0 smoke**

Run: `node training/gcp/launch-sweep.mjs --smoke`
Expected: 1 job launched (or region-fallback messages then success). If ALL regions fail with quota errors: request quota (`gcloud alpha services quota` or console link printed) and retry with `g2-standard-12`/`NVIDIA_L4` variants; if L4 quota is zero everywhere, try `n1-standard-8`+`NVIDIA_TESLA_T4` for smoke only (rate ≈ $0.75/hr; add to rates).

- [ ] **Step 5: Watch smoke to completion; fix container/CLI issues**

Run: `node training/gcp/monitor.mjs` repeatedly (orchestrator paces polling ≈ every 4 min).
Expected end state: `JOB_STATE_SUCCEEDED` and `gs://…/runs/smoke-0/metrics.json` present, GGUF present. If the job fails: `gcloud ai custom-jobs stream-logs <jobName> --region=<r>` and fix `train.py`/`gcloudArgs`/container tag; re-launch smoke. **The matrix does not launch until smoke succeeds.**

- [ ] **Step 6: Sanity-serve the smoke GGUF locally**

```bash
gcloud storage cp gs://lariat-train-us-central1/runs/smoke-0/model-q4_k_m.gguf training/gcp/artifacts/smoke-0/
# package + one manual prompt through ollama run; verifies TEMPLATE + stop tokens + think:false tolerance
node -e "…makeModel equivalent, or do it by hand:"
ollama create lari-ka-smoke -f <(sed "s|{{GGUF_PATH}}|$PWD/training/gcp/artifacts/smoke-0/model-q4_k_m.gguf|" training/gcp/Modelfile.qwen-v2.tmpl)
curl -s http://127.0.0.1:11434/api/chat -d '{"model":"lari-ka-smoke","stream":false,"think":false,"messages":[{"role":"system","content":"You are a test."},{"role":"user","content":"Say OK."}]}' | head -c 400
ollama rm lari-ka-smoke
```
Expected: valid JSON response, no template garbage, no thinking-capability error.

- [ ] **Step 7: Commit setup script**

```bash
git add training/gcp/setup.sh
git commit -m "feat(training): idempotent GCP setup — billing link, bucket, \$200 budget"
```

---

### Task 12: EXECUTION — full sweep + monitoring

- [ ] **Step 1: Launch the matrix**

Run: `node training/gcp/monitor.mjs || true` then `node training/gcp/launch-sweep.mjs --spent=<smoke cost from status.json>`
Expected: 6 jobs (no HF token) or 9 (with token), projection printed ≤ $200.

- [ ] **Step 2: Poll to completion**

`node training/gcp/monitor.mjs` on a paced loop (orchestrator: ~20-min cadence; jobs run 3–7h). On any `JOB_STATE_FAILED`: `stream-logs`, classify (OOM → drop that config with a note; transient → relaunch once). Budget check each pass: if `totalCostUsd` + projection of running jobs > 200, cancel the youngest running jobs (`gcloud ai custom-jobs cancel`).

- [ ] **Step 3: Download top candidates**

Run: `node training/gcp/monitor.mjs --download`
Expected: `artifacts/metrics-all.json` + up to 4 GGUFs locally.

---

### Task 13: EXECUTION — candidate eval + winner flip

- [ ] **Step 1: Preflight Ollama + hermes; run leaderboard**

```bash
ollama serve >/dev/null 2>&1 &   # if not already running
node training/gcp/evaluate-candidates.mjs
```
Expected: console leaderboard + `artifacts/eval-results.json` including `deepseek-baseline` row.

- [ ] **Step 2: Measure M4 fit for the winner**

```bash
/usr/bin/time -l ollama run lari-ka-cand-<winner> "quick check: say OK" 2>&1 | grep -E "maximum resident|real"
ollama ps
```
Record model size + RSS in the PR body.

- [ ] **Step 3: Flip**

```bash
ollama cp lari-the-kitchen-assistant lari-ka-deepseek-backup
mkdir -p training/models && cp training/gcp/artifacts/<winner>/model-q4_k_m.gguf training/models/lari-ka-v2.gguf
```
Rewrite `training/Modelfile` (tracked) to:

```
FROM ./models/lari-ka-v2.gguf
```
…followed by the winner family's TEMPLATE/stop/params block from the matching `.tmpl`, and this comment footer:

```
# No SYSTEM block here on purpose. The single source of truth for the
# system prompt is `lib/ollama.ts` — GROUNDED_SYSTEM / CREATIVE_SYSTEM.
# v2 (2026-07): fine-tuned <base> (QLoRA, runtime-shaped dataset v2, Vertex AI).
# Rollback: `ollama cp lari-ka-deepseek-backup lari-the-kitchen-assistant`
# (or rebuild from the old deepseek-r1:14b Modelfile in git history).
```

Add `training/models/` to `.gitignore` (GGUF is 2.5–5GB — never commit; the PR records the GCS path).

```bash
ollama create lari-the-kitchen-assistant -f training/Modelfile
```

- [ ] **Step 4: Post-flip eval on the real name**

Run: `EVAL_REQUIRE_OLLAMA=1 npm run eval:assistant-prompt`
Record the ollama-leg line for the PR. (Gate: no FAIL/ERROR; PARTIALs reported.)

---

### Task 14: Docs, comments, native warning update

**Files:**
- Modify: `LariatNative/Sources/LariatModel/OllamaClient.swift` (lines 7-8 comment only)
- Modify: `training/SETUP.md`, `CHANGELOG.md`, `.env.example`
- Create: `training/gcp/README.md`

- [ ] **Step 1: Update the native warning comment** — replace the "do NOT change — the qwen variant fails the assistant eval" comment with:

```swift
/// Default model: `lari-the-kitchen-assistant`. Since 2026-07 this name is the
/// fine-tuned KA v2 model (see training/gcp/README.md); rebuilding the same
/// Ollama name is the supported upgrade path — the GUI app reads this compiled
/// default, not .env.local. Do not point at unevaluated variants; gate flips
/// with `EVAL_REQUIRE_OLLAMA=1 npm run eval:assistant-prompt`.
```

Comment-only change; still run `cd LariatNative && swift build` to prove it compiles.

- [ ] **Step 2: `training/gcp/README.md`** — one page: pipeline diagram (generate → upload → smoke → sweep → monitor → evaluate → flip), every command from Tasks 11–13, the rollback command, M4 serving tuning (`OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_KEEP_ALIVE=30m`), cost table from the actual run.

- [ ] **Step 3: `training/SETUP.md`** — add a "v2 (current)" section on rebuilding `lari-the-kitchen-assistant` from `training/Modelfile` + GCS GGUF path; mark the deepseek pull instructions as the rollback path. `CHANGELOG.md`: entry under Unreleased. `.env.example`: comment noting num_ctx 16384 and the v2 model.

- [ ] **Step 4: Commit**

```bash
git add LariatNative/Sources/LariatModel/OllamaClient.swift training/SETUP.md CHANGELOG.md .env.example training/gcp/README.md training/Modelfile .gitignore
git commit -m "feat(assistant): flip lari-the-kitchen-assistant to KA v2 fine-tune; docs + rollback path"
```

---

### Task 15: EXECUTION — verification gates + GUI smoke + PR + teardown

- [ ] **Step 1: Full gates**

Run: `npm run verify` (typecheck, lint, unit/rules/i18n/BEO node tests, build) — all green. Plus `node --test tests/js/test-eval-tally.mjs tests/js/test-dataset-v2-core.mjs tests/js/test-dataset-v2-slices.mjs tests/js/test-sweep-lib.mjs`.

- [ ] **Step 2: GitNexus regression check**

Run `detect_changes({scope: "compare", base_ref: "main"})` — confirm only expected symbols (eval harness, new training modules) are affected.

- [ ] **Step 3: GUI smoke** (run-lariat skill): start the app, open the kitchen assistant panel, ask "what's 86 today?" (question path) and "scale bacon jam to 3x" (command path, PIN 0708) — screenshot both; confirm the fenced JSON never leaks to the user-visible answer.

- [ ] **Step 4: PR**

`git push -u origin feat/lariat-ka-v2-local-model` and `gh pr create` with body containing: eval leaderboard table (all candidates + deepseek baseline), dataset stats JSON, actual cost table from `status.json` + budget console note, M4 memory numbers (old ~9GB vs new working set), GCS artifact inventory, rollback one-liner. Footer: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 5: Teardown check**

`node training/gcp/monitor.mjs` — all terminal states; `gcloud ai custom-jobs list --region=us-central1 --filter='state=JOB_STATE_RUNNING' --format='value(name)'` per used region — empty. Bucket retained (artifacts). Print final actual spend.

- [ ] **Step 6: Memory update** — update the project memory: qwen-not-ready note superseded (v2 flip), lariat-native-port-status pointer, new memory for the training pipeline location + rollback.

---

## Plan Self-Review (done at write time)

- **Spec coverage:** dataset v2 (Tasks 3–6), Vertex sweep (7–9, 11–12), eval gate + selection (2, 10, 13), flip + zero-code-change (13), docs/comments (14), verification/PR/teardown (15), budget guard (8, 11, 12). ✓
- **Known deliberate deviations:** `sweep-config.json` container tag and exact `gcloud ai custom-jobs create` flag shapes are validated at smoke time (marked "binding note", Task 8) — this is a documented adjust-on-contact point, not a placeholder; the smoke job is the test.
- **Type consistency:** `tallyVerdicts` shape used identically in Tasks 2/10; `launched.json`/`status.json`/`metrics-all.json` field names consistent across 8/9/10; `{{GGUF_PATH}}` token consistent 10/11/13. ✓
