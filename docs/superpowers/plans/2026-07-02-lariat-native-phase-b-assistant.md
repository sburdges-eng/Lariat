# Phase B — Kitchen Assistant (LLM) native port

Worktree: `worktrees/phase-b-assistant`, branch `feat/lariat-native-phase-b-assistant`.
Web spec (system of record): `app/kitchen-assistant/*`, `app/api/kitchen-assistant/{route.js,undo/route.js}`,
`app/api/lari/predictions/route.js`, libs `ollama.ts`, `kitchenAssistantContext.ts`,
`kitchenAssistantUndo.ts`, `lariConversationMemory.ts`, `lariPredictions.ts`,
`cookMessageClassifier.ts`, `extractAction.ts`, `complianceSearch.ts`, `kitchenSemanticSearch.ts`.

## Gap audit result

Nothing of the assistant vertical exists natively. No Ollama/HTTP client anywhere in
`LariatNative` — this port introduces the first one. Reused (NOT re-ported):
`DatapackRepository` (A6.3 lexical FTS + USDA nutrients + FDA sections),
`TempLogCompute.getTempPoint/validateTempReading` (A1), `ReceivingCompute.validateReceivingReading/dbStatus`
(A1), `UnitConvert.normalizeUnit` (A2), `StationCatalog` (stations + line-check templates),
`StaffCatalog`, `HostStandCompute.summarizeWaitlist`, `SplTelemetryCompute.summarizeSpl`,
`SoundRepository`, `AuditedWriteRunner` / `AuditEventWriter`, `LocationScope`, invariant contracts.

## Layering

### LariatModel (pure, TDD from web oracles)
- `Compute/AssistantMessageClassifier.swift` — `cookMessageClassifier.ts` port
  (oracle: test-cook-message-classifier.mjs, every case).
- `Compute/AssistantActionExtractor.swift` — `extractAction.ts` brace-scanner port
  (oracle: test-extract-action.mjs, every case). Payload surfaced as `AssistantActionPayload`
  (action + JSON fields, typed accessors — **no implicit coercion of LLM-supplied values**).
- `AssistantRecords.swift` — conversation turn, undo meta, chat envelope, sources, limits
  (MAX_MESSAGE=2000, MAX_ITEM=300, MAX_NOTE=500), snake_case CodingKeys.
- `Compute/LariConversationMemoryCompute.swift` — `normalizeConversationInputs`
  (UUID gate, cook clip → 'anonymous'), `formatConversationHistoryForPrompt`, TTL/caps constants
  (oracles: test-lari-conversation-memory.mjs pure cases).
- `Compute/AssistantUndoCompute.swift` — `buildKitchenAssistantUndoMeta`, undoable-entity
  config, 30s window, timestamp normalization (oracle: test-kitchen-assistant-undo.mjs meta cases).
- `Compute/LariPredictionsCompute.swift` — `lariPredictions.ts` full port (normalize/sort/trim +
  BEO/sound/host builders + daysUntil; oracle: test-lari-predictions-rules.mjs, every case).
- `OllamaClient.swift` — same env contract as `lib/ollama.ts`: `LARIAT_OLLAMA_URL`
  (default `http://127.0.0.1:11434`), `LARIAT_OLLAMA_MODEL` (default
  **`lari-the-kitchen-assistant`** — unchanged; the qwen variant fails the assistant eval),
  `LARIAT_OLLAMA_TIMEOUT_MS` clamp [5000,120000] default 45000, temperature/max-tokens/num-ctx env
  fallbacks, request body parity (`stream:false`, `think:false`, `top_p:0.85`), error mapping
  (HTTP status + 200-char body clip, "no message content"). Transport is a protocol
  (`OllamaTransport`); tests use stubs, never a live server. **No streaming — the web route uses
  `stream:false`, so native does too (parity, not a deferral).**
- `Compute/AssistantPrompts.swift` — GROUNDED_SYSTEM / ALLERGEN_BLOCK / HACCP_BLOCK /
  SOURCE_BOUNDARIES verbatim (HACCP numbers + citations copied faithfully), user-content
  assembly (context + semantic-search catalog + history block + translation directive +
  action-engine directive vs answer-format).
- `Compute/KitchenSemanticSearchCompute.swift` — tokenize/normalize/score/excerpt/rank port
  (oracle: test-kitchen-semantic-search.mjs scoring cases).
- `Compute/AssistantContextCompute.swift` — every renderer from `kitchenAssistantContext.ts`
  as a pure function over typed rows (86s, inventory, signoffs, line-check progress, failures,
  missing signoffs, equipment down/specs/warranty, repeat/historical 86s, sales velocity + daily
  trend (PIN), recipes + allergen matrix, staff roster, HACCP CCPs, vendor summary, labor summary
  (PIN), gold stars (PIN), performance reviews (PIN), BEO events + stale prep + prep history,
  order guide, USDA formatting incl. `formatUnit`/`USDA_NUTRIENT_PRIORITY`/`PRIORITY_DISPLAY`
  from test-kitchen-assistant-citations.mjs, keyword gates, tier sentinels, trailing
  NOT-IN-THIS-CONTEXT lines, 12k-char truncation). Oracle: test-kitchen-assistant-context-pin.mjs.
- `AssistantDataCaches.swift` — loaders for `recipes.json` (full Recipe shape — `BridgeRecipe`
  only carries slug/name/menu_items), `menu.json`, `food_safety.json`, `vendor_summary.json`,
  `labor_summary.json`, `allergen_matrix.json` (I/O ⇒ model root, mirrors DishBridgeRecipeLoader
  precedent: `[]`/nil on missing/malformed).
- `RecipeCalculating.swift` — protocol + `ExpandResult`/`LeafRow`/`CalculatorError` +
  `formatLeafRowsAsTasks` (pure). Live impl shells to the SAME `scripts/bom_expand_cli.py`
  contract the web uses (single source of truth for BOM math); tests inject stubs — identical
  to the web suites, which never spawn python in CI.

### LariatDB (repositories + engine, in-memory/on-disk GRDB fixtures)
- `AssistantConversationRepository.swift` — sweep/store/load `lari_conversation_turns`
  (oracles: test-lari-conversation-memory.mjs DB cases + test-kitchen-assistant-conversation-memory.mjs).
- `ComplianceSearchRepository.swift` — BM25 FTS over `data/cache/compliance.db` (read-only,
  graceful no-op when absent) + `renderCompliance` (oracle: compliance FTS cases).
- `KitchenSemanticSearchRepository.swift` — local corpus (recipes cache + beo_line_items +
  beo_prep_tasks + safe audit_events) + rank; reference recipes via `DatapackRepository.fts`
  (bucket `recipes`).
- `AssistantContextRepository.swift` — `buildGroundedContext` orchestration: exact section
  order, keyword gates, PIN gating, sources array, truncation.
- `AssistantActionRepository.swift` — **every mutating `payload.action` handler with its full
  web validation ladder**: `eighty_six` (inventory soft-block w/o PIN), `update_inventory`
  (Number.isFinite delta gate), `line_check` (typeof-number reading gate + temp-point server-side
  pass/fail), `maintenance` (LIKE %name% resolve, soft-reject unknown), `scale_recipe`
  (positive multiplier gate, calculator authoritative, ACID batch), `update_order_guide`
  (positive qty gate), `beo_add_prep` (event exists + **cross-location guard**, calculator
  expansion w/ guest_count), `give_gold_star` (stars finite gate + clamp 1–3, roster
  case-insensitive gate, empty-roster fallback), `haccp_receive` (validator; **throw ⇒
  status='fail' red marker**, never 'na'), `generate_prep` (per-task calculator swap, ACID batch).
  All writes in ONE transaction with `audit_events` via AuditedWriteRunner; handler exceptions map
  to `actionError` with a generic operator message (no SQL/PII leak).
- `AssistantUndoRepository.swift` — `undoKitchenAssistantAction` port: 30s window, location
  scope, `actor_source='kitchen_assistant'` + `action='insert'` eligibility, double-undo 409,
  resolve-vs-delete modes, correction row with before/after payload + `note='undo_30s'`,
  append-only original (oracle: test-kitchen-assistant-undo.mjs, every case; web HTTP statuses
  pinned as typed-error `status` values 400/404/409/500).
- `KitchenAssistantEngine.swift` — the route-handler port: message clip → conversation
  normalize → sweep/load history → classifier → **PIN gate BEFORE the LLM (#248)** →
  context build (#247 tiering) → prompt → ollamaChat → extractAction → question-path JSON
  strip (defense-in-depth) → action dispatch → `⚡ ACTION EXECUTED:` prefix → conversation
  store → response envelope (answer/model/sources/latency/actionExecuted/actionError/undo/
  disclaimer). Oracles: test-kitchen-assistant-pin-gate.mjs, -action-hardening.mjs,
  -beo-add-prep-scope.mjs, -undo.mjs (route half) with stub transport + fixture DB.
- `LariPredictionsRepository.swift` — `/api/lari/predictions` data layer for beo/sound/host
  surfaces reusing SoundRepository/SplTelemetryCompute/HostStandCompute (oracle:
  test-lari-predictions-api.mjs DB-semantics cases; the PIN gate is app-layer natively,
  GoldStars precedent).

### LariatApp
- `AssistantOllamaTransport.swift` — URLSession live transport (+ `/api/tags` ping, 3s).
- `KitchenAssistantView.swift` + `KitchenAssistantViewModel.swift` — chat surface: thread,
  input, per-turn sources chips, action confirm + actionError styling, **Undo button with 30s
  expiry countdown**, allergen disclaimer footer (verbatim), Ollama reachability row,
  LariatTheme/EmptyState/labeled ProgressView conventions. PIN tier via `PinSessionStore`
  (hasPin ⇒ manager tier; parity with `hasPinCookie`).
- `AssistantFeatures.swift` — `FeatureModule.cookAssistant`.

## Tier decision (documented)

`cook.assistant`, **cook tier**, title "Assistant". The web surface is deliberately open to
line cooks (questions un-gated; mutations PIN-gated inside the flow). That maps exactly onto
the existing cook tier + in-surface `PinEntrySheet` pattern (Morning precedent) — a new
`.assistant` FeatureTier would put a single board in its own sidebar section for no behavioral
gain. No shell edits (A0 self-registration).

## actor_source (documented, per action)

- All 10 mutating LLM actions: **`kitchen_assistant`** (web literal). This is load-bearing:
  `kitchenAssistantUndo.ts` refuses undo unless `original.actor_source === 'kitchen_assistant'`.
  Using the program's `native_cook` convention would silently break undo eligibility parity, so
  the web literal wins here (divergence from native convention documented + pinned by tests).
- Undo corrections: **`kitchen_assistant_undo`** (web literal), `action='correction'`,
  `replaces_id` → original.
- `code_search`-style `view` audit rows: n/a (deferred, below).

## Deferrals (documented)

1. **`db_query` action + `lib/dbQueryTool.ts` catalog** — out of the briefed lib list. The
   native prompt omits the AVAILABLE DB QUERIES catalog; if the model emits `db_query` anyway
   the engine soft-responds "not available on this device yet — use the web cockpit"
   (read-only surface, no safety regression). Same for the LLM-generated db_query summary.
2. **`code_search` + `lib/devCodeSearch.ts`** — dev-only, env-gated on web; same soft response.
3. **Semantic (BGE) channels** — `kitchenSemanticSearch` reference bucket, FDA/USDA hybrid,
   compliance hybrid all run **lexical** (FTS/BM25) via DatapackRepository /
   ComplianceSearchRepository, exactly like A6.3 and exactly like the web behaves when the
   vector packs are absent. Semantic mode deferred.
4. **Idempotency (`withIdempotency`)** — native convention: no idempotency layer (divergence
   asserted across all prior ports).
5. **LaRi ambient-strip UI** — predictions compute + repository ported with tests; the strip
   is a web-shell affordance with no native host surface yet. Follow-up wave.
6. **Python BOM calculator internals** — kept as the single source of truth; native calls the
   same CLI contract (`scripts/bom_expand_cli.py`) via an injected `RecipeCalculating`; tests
   stub it (web tests never spawn python either).

## Registry edits (minimal, allowed)

`FeatureCatalog.swift` (+1 descriptor), `FeatureRegistry.swift` (+1 line),
`FeatureRegistryTests.swift` (count/id assertions).
