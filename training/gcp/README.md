# KA v2 — Vertex AI training pipeline

Fine-tunes the Lariat Kitchen Assistant on a **runtime-shaped dataset** (every
example carries the production `GROUNDED_SYSTEM` + real `CONTEXT` + the live
db_query catalog + the per-turn directive — built by importing the production
prompt builders, not copies) and ships the winner as the same Ollama model name
both apps already use.

```
preflight  ──▶  generate  ──▶  upload  ──▶  smoke job  ──▶  sweep  ──▶  monitor
(snapshot DB)   (dataset v2)    (GCS)      (validates      (A100     (poll +
                                            container)      Spot)     download)
                                                                        │
        flip  ◀──  evaluate-candidates  ◀──  top-4 GGUFs by val_loss ◀──┘
  (same model name,                (real 10-scenario eval, ollama leg,
   both apps pick it up)            DeepSeek baseline for comparison)
```

## Commands (in order)

```bash
bash training/gcp/preflight.sh          # deps + live-DB snapshot (never touches data/lariat.db)
npm run training:generate-v2            # dataset -> training/datasetv2/out/ (gitignored)
bash training/gcp/setup.sh              # billing link, bucket, $200 budget (idempotent)
gcloud storage cp training/datasetv2/out/{train,val}.jsonl gs://lariat-train-us-central1/data/
node training/gcp/launch-sweep.mjs --smoke      # stage-0: 200 rows, 1 epoch — must SUCCEED first
node training/gcp/monitor.mjs                   # exit 3 = running, 0 = all terminal
node training/gcp/launch-sweep.mjs --spent=<smoke $>   # full matrix, budget-pruned
node training/gcp/monitor.mjs --download        # when done: top-4 GGUFs -> artifacts/
node training/gcp/evaluate-candidates.mjs       # leaderboard + baseline (needs ollama serve + hermes)
```

## The flip (zero code change)

The GUI-launched native app reads the **compiled default model name**, not
`.env.local` — so the upgrade path is rebuilding the same Ollama name:

```bash
ollama cp lari-the-kitchen-assistant lari-ka-deepseek-backup   # rollback point
mkdir -p training/models && cp training/gcp/artifacts/<winner>/model-q4_k_m.gguf training/models/lari-ka-v2.gguf
# training/Modelfile points FROM ./models/lari-ka-v2.gguf (see repo history for the deepseek variant)
ollama create lari-the-kitchen-assistant -f training/Modelfile
EVAL_REQUIRE_OLLAMA=1 npm run eval:assistant-prompt            # post-flip gate
```

**Rollback:** `ollama cp lari-ka-deepseek-backup lari-the-kitchen-assistant`

## Serving tuning for a 16GB M4 (semi-in-use)

Set these in the environment that starts `ollama serve` (e.g. `launchctl setenv` or the shell profile):

```bash
OLLAMA_FLASH_ATTENTION=1     # required for KV-cache quantization
OLLAMA_KV_CACHE_TYPE=q8_0    # halves KV memory at num_ctx 16384
OLLAMA_KEEP_ALIVE=30m        # keep the model warm through service
```

Working set: ~2.5–5GB GGUF (4B/8B q4_K_M) + ~0.7GB quantized KV — versus
~9GB for the previous DeepSeek-R1 14B setup.

## Design notes

- **Chat template**: Qwen candidates are trained AND served with the same
  plain-chatml template (`train.py` overrides the tokenizer template;
  `Modelfile.qwen-v2.tmpl` mirrors it) — no `<think>` scaffolding, so the
  clients' `think:false` is trivially satisfied. Llama 3.1 uses its native
  template mirrored in `Modelfile.llama31-v2.tmpl`.
- **Quota reality (2026-07)**: this project's only nonzero Vertex GPU quota is
  `CustomModelTrainingPreemptibleA100GPUsPerProjectPerRegion = 8` in
  us-central1 / europe-west4 / asia-southeast1 — hence `strategy: SPOT` on
  `a2-highgpu-1g`. Spot restarts re-run the job from scratch (`train.py` has no
  resume); the per-job `scheduling.timeout` caps the cost of restart loops.
- **Budget**: `sweep-config.json:budgetUsd` is enforced two ways — a Cloud
  Billing budget (alerts at 50/75/90/100%) and `pruneToBudget()` in the
  launcher, which drops matrix cells that would exceed the cap. `--spent=` lets
  you carry already-incurred cost into the projection.
- **Eval gate**: `EVAL_REQUIRE_OLLAMA=1` makes the ollama (deployed-model) leg
  gate the exit code — any FAIL/ERROR fails, PARTIAL tolerated.
  `EVAL_OLLAMA_ONLY=1` skips the hermes candidate leg for cheap A/B runs
  (grading still uses hermes). Without flags the harness behaves exactly as
  before (claude-leg 10/10 frozen baseline).
- **PII**: dataset generation reads a snapshot only; BEO client names are
  pseudonymized (`Client A/B/…`) in both display and snake_case-ID form,
  names shared with the active staff roster are excluded from scrubbing (the
  serve-time roster renders unscrubbed), and a leak scan runs before upload;
  HR/labor sources are never read.
- **Container image (ACTION NEEDED before 2026-07-24)**: `containerUri` pins
  the prebuilt PyTorch 2.4 training image by immutable digest. Google's
  prebuilt training-container line reaches **end-of-availability 2026-07-24**
  (pytorch-gpu.2-4 is the last version); after that date re-runs must use a
  self-owned image — mirror the digest into this project's Artifact Registry
  or build a small Dockerfile on a current CUDA base (train.py pip-installs
  the ML stack anyway, so any CUDA-12 python 3.10+ base works).
