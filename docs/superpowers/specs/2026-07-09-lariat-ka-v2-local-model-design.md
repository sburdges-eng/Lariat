# Lariat Kitchen Assistant v2 — Local Model + Vertex AI Training

**Date:** 2026-07-09
**Status:** Approved (design approved in-session; spec review waived by owner)
**Branch:** `feat/lariat-ka-v2-local-model`
**Budget:** $200 target on GCP project `devvy-490312` (billing account `01A733-66BAB6-4297C6`), owner-authorized for autonomous spend. Owner chose "use it all" over "hard cap": widen the sweep while projected spend stays under $200.
**Owner decisions:** train and flip regardless (eval is diagnostic, not a blocker); Vertex AI managed jobs only (no GCE VMs); candidates are 8B + 4B class, winner picked by eval score with ties to the smaller model.

## Problem

The Kitchen Assistant runs `lari-the-kitchen-assistant` (DeepSeek-R1 14B, 7.2GB blob, ~9GB
working set with fp16 KV at num_ctx 16384) on a 16GB M4 MacBook Pro that is also in use for
other work. The previous fine-tune attempt (`lari-qwen`, Qwen 2.5 7B, 2026-05-24) failed the
assistant eval's ollama leg 1/10 and was never deployed.

### Why lari-qwen failed (recon findings, 2026-07-09)

1. **Tiny dataset** — 356 QA pairs, generated only from `data/cache/*.json`.
2. **Train/serve format mismatch** — pairs were bare user/assistant turns; at runtime the
   model receives `GROUNDED_SYSTEM` (~3.5k chars) + a `CONTEXT (authoritative)` block (12k-char
   cap) + the 30-query db_query catalog + an 11-schema ACTION ENGINE directive. `max_seq 2048`
   during training also truncated anything prompt-shaped.
3. **Deployment unverifiable** — all fused/GGUF artifacts were deleted; `train-local.sh` falls
   back to *base* Qwen when no GGUF exists, so the evaluated `lari-qwen` may have been base
   Qwen 2.5 7B at `num_ctx 4096` (prompt truncation → the observed hallucination/degeneration).
4. **Eval gate blind spot** — `run-eval.mjs` exit code tallies only the hermes/Claude leg;
   the ollama-leg failure hid behind `totals: PASS=10`.

## Goals

1. A fine-tuned, domain-trained local model that becomes the default for **both** the web app
   and LariatNative, with zero code change to the serving path.
2. Smooth operation on a semi-in-use 16GB M4: model working set ≤ ~6GB (target 2.5–5GB GGUF
   q4_K_M + q8_0 KV cache), 45s timeout comfortably met.
3. A reproducible, autonomous Vertex AI training pipeline in-repo (`training/gcp/`).
4. An eval harness that can actually gate on the deployed (ollama) leg.

## Non-goals

- No streaming, no native in-process inference (MLX/llama.cpp runtime), no new UI. The
  "most advanced tested native backend" is the existing `OllamaClient.swift` +
  `KitchenAssistantEngine` stack (228 assistant-vertical tests, suite 2467/0) — it consumes
  the flip via Ollama HTTP unchanged. The web UI is current main (PR #454 merged).
- No change to `GROUNDED_SYSTEM`/`CREATIVE_SYSTEM` content or the no-SYSTEM-block Modelfile
  convention (prompts live in `lib/ollama.ts` only).
- No training on HR/labor/PII data.

## Design

### 1. Dataset v2 — `training/generate-dataset-v2.mjs`

Every example mirrors the exact runtime shape: `system = GROUNDED_SYSTEM` (imported live from
`lib/ollama.ts`), `user` = realistic runtime message (CONTEXT block from real cache/db data,
db_query catalog, per-turn directive, then the cook's question/command), `assistant` = target
answer or exact action JSON.

| Slice | ~Count | Notes |
|---|---|---|
| Action-JSON commands | 1,500 | all 10 write actions, exact schemas from `app/api/kitchen-assistant/route.js` ACTION ENGINE DIRECTIVE; real recipe/order-guide/BEO entities; JSON object emitted first, no prose math |
| db_query selection | 600 | 30 registry queries × phrasings; correct `{action:"db_query", query_id, params}` |
| Grounded QA | 1,200 | ingredients/allergens/sub-recipes/procedures/menu resolution from `data/cache/*.json` |
| Allergen escalation | 300 | never "safe/free of", cross-contact, escalate to manager |
| HACCP/compliance | 400 | 165°F/15s poultry, 135→70°F/2h→41°F/6h cooling, TPHC 4h, date marks; from `data/normalized/compliance_rules.jsonl` + food_safety templates |
| Refusals/grounding | 400 | answer absent from CONTEXT → state that + point to a real source (Recipe Hub, 86 board, manager, Toast) — never fabricate |

Guards:
- Deterministic seed; 90/10 train/val split.
- **Eval contamination check**: T01–T10 scenario texts excluded by n-gram similarity.
- Every action-JSON target must round-trip through `lib/extractAction.ts` and validate against
  the route's schema expectations before entering the set.
- PII: client names pseudonymized from a fixed pool; HR/labor sources untouched.
- Data read from the canonical checkout (`~/Dev/hospitality/Lariat/data/`), read-only.
- Kitchen voice in all prose targets (short lines, kitchen verbs — T10's bar).

### 2. Vertex AI training — `training/gcp/`

- `setup.sh` — idempotent: link billing `01A733-66BAB6-4297C6` → `devvy-490312`; enable
  `billingbudgets.googleapis.com` (aiplatform + storage already enabled); create
  `gs://lariat-train-us-central1`; create a $200 budget with alerts at 50/75/90/100%.
- `train.py` — TRL SFTTrainer QLoRA (bnb nf4), adapted from the proven
  `training/aws/train_script.py`; **max_seq_length 8192**; flash-attention 2; merges adapters,
  converts to GGUF via llama.cpp `convert_hf_to_gguf.py`, quantizes q4_K_M, uploads
  GGUF + adapters + eval-loss log to GCS.
- `launch-sweep.mjs` + `sweep-config.json` — matrix: bases = Qwen3-8B, Qwen3-4B-Instruct(-2507),
  Llama-3.1-8B-Instruct (skipped automatically if no HF token with license acceptance);
  configs = LoRA r16/r32 × lr {1e-4, 2e-4} × epochs {2,3}, pruned to projected budget.
  8B jobs: `a2-highgpu-1g` (A100-40GB); 4B jobs: `g2-standard-8` (1×L4). Region probing with
  fallback list (us-central1 → us-east4 → us-west1 → europe-west4).
- **Stage 0 smoke job**: 200-example subset, ~30 min, on the cheapest cell — validates
  container, data path, GGUF conversion, and GCS round-trip before the matrix spends.
- `monitor.mjs` — polls `gcloud ai custom-jobs` states + GCS artifacts; per-job runtime caps;
  projected-spend guard aborts remaining jobs if projection exceeds $200.
- Exact base-model revisions (HF repo ids) are resolved at implementation time against the
  Hub (newest stable instruct revisions in the 8B/4B classes); pinned in `sweep-config.json`.

### 3. Eval & selection (local, M4)

- Patch `training/eval/run-eval.mjs` (additive, default behavior unchanged):
  `EVAL_REQUIRE_OLLAMA=1` → exit 2 if Ollama unreachable; separate ollama-leg tally
  (pass/partial/fail counters) printed and stored; ollama tally gates exit only when the flag
  is set.
- Each GGUF → `ollama create lari-ka-cand-<n>` (num_ctx 16384, temp 0.2, top_p 0.85,
  num_predict 512, family-correct stop tokens, no SYSTEM block).
- Same-day DeepSeek baseline run for honest comparison.
- Score = ollama PASS + 0.5·PARTIAL; ties → smaller model. Also measured per candidate on the
  M4: total response latency on T09-style prompts and peak RSS.
- Hermes CLI (grader) preflight-checked before any eval run.

### 4. Flip (owner-approved: flip regardless)

1. `ollama cp lari-the-kitchen-assistant lari-ka-deepseek-backup`
2. New `training/Modelfile` → `FROM ./artifacts/<winner>.gguf` + existing param conventions.
3. `ollama create lari-the-kitchen-assistant -f training/Modelfile` — web + GUI-launched
   native app (which reads compiled defaults, not `.env.local`) both flip with zero code change.
4. Rollback: `ollama cp lari-ka-deepseek-backup lari-the-kitchen-assistant` (documented in
   SETUP.md).
5. Update stale-comment sites: `LariatNative/Sources/LariatModel/OllamaClient.swift:7-8`
   warning, `training/SETUP.md`, `CHANGELOG.md`, `.env.example` guidance.
6. M4 serving guidance documented: `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`,
   `OLLAMA_KEEP_ALIVE=30m` (documentation only — no LaunchAgent writes).

### 5. Verification & delivery

- `npm run verify` (typecheck, lint, unit/rules/i18n/BEO tests, build) in the worktree.
- Eval re-run against the flipped name with `EVAL_REQUIRE_OLLAMA=1`.
- GUI smoke via the run-lariat skill: assistant panel question + PIN-gated command.
- PR: eval comparison table (candidates + DeepSeek baseline), actual per-job Vertex cost
  report, artifacts inventory (GCS paths). Cloud jobs cancelled/complete at teardown; bucket
  retained.

## Risks

- **Vertex GPU quota** on a freshly-billed project may be 0 in some regions — handled by
  region fallback + L4/A100 machine-type fallback; worst case the sweep narrows.
- **Grader dependency** — the eval grader is Claude-via-hermes; a hermes outage produces
  ERROR verdicts. Preflight + rerun-once mitigation.
- **Spot behavior** — Vertex managed jobs are on-demand (no spot); priced into the $200
  projection (8B A100 job ≈ $4–5/hr, 2–4h each; 4B L4 job ≈ $1/hr, 1–3h each).
- **"Flip regardless" regression risk** — if every candidate underperforms DeepSeek, the flip
  still proceeds per owner decision, but the PR will state the regression in the eval table
  and the backup/rollback path is one command.
- **Live DB** — dataset generation reads `data/cache` and `lariat.db` strictly read-only from
  the canonical checkout.
