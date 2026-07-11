# Lariat Kitchen Assistant — Local Training Setup

Mac training guide for the Lariat kitchen assistant model.

> **v2 (current, 2026-07):** `lari-the-kitchen-assistant` is now the KA v2
> fine-tune — a Vertex AI QLoRA model trained on a runtime-shaped dataset and
> shipped as a local GGUF. Build/rebuild it with:
>
> ```bash
> ollama create lari-the-kitchen-assistant -f training/Modelfile
> ```
>
> The GGUF ships outside git (see `training/gcp/README.md` for the GCS
> artifact path, the full training pipeline, and the M4 serving tuning —
> `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`). Keep
> `LARIAT_ASSISTANT_NUM_CTX=16384` — the assistant prompt overflows 4096 and
> truncation causes fabrication.
>
> **Rollback to DeepSeek:** `ollama cp lari-ka-deepseek-backup
> lari-the-kitchen-assistant` (or follow the DeepSeek steps below with the
> pre-v2 Modelfile from git history). The sections below describe that
> original DeepSeek setup and remain the rollback path.

## Prerequisites

- macOS with Apple Silicon (tested on M4, 16 GB unified memory)
- Node.js 18+
- Homebrew

## 1. Install Ollama

```bash
brew install ollama
ollama serve          # leave running in a background terminal
```

## 2. Pull the base model

Recommended (fits comfortably in 16 GB+):

```bash
ollama pull deepseek-r1:14b
```

Optional smaller model (for 8 GB Air):

```bash
ollama pull deepseek-r1:7b
```

## 3. Create the custom model

The `Modelfile` bakes in the Lariat system prompt so every chat session
starts with the grounded kitchen-assistant rules:

```bash
ollama create lari-the-kitchen-assistant -f training/Modelfile
```

Verify it loaded:

```bash
ollama list            # should show "lari-the-kitchen-assistant"
ollama run lari-the-kitchen-assistant "What are you?"
```

## 4. Configure the app

Create `.env.local` in the project root (or copy the template below):

```env
LARIAT_OLLAMA_MODEL=lari-the-kitchen-assistant
# Optional overrides:
# LARIAT_OLLAMA_URL=http://127.0.0.1:11434
# LARIAT_ASSISTANT_TEMPERATURE=0.2
# LARIAT_ASSISTANT_MAX_TOKENS=512
# LARIAT_ASSISTANT_NUM_CTX=4096
# LARIAT_OLLAMA_TIMEOUT_MS=45000
```

Then restart the dev server:

```bash
npm run dev
```

The kitchen assistant panel should now be active.

## 5. Generate training data

Rebuild the enriched cache first, then generate QA pairs:

```bash
npm run rebuild-cache
node training/generate-qa.mjs
```

This reads `data/cache/*.json` and writes `training/lariat-qa.jsonl` —
one JSON object per line in the `{"messages": [...]}` format expected by
both Ollama fine-tuning and mlx-lm.

## 6. Optional: LoRA fine-tuning with mlx-lm

For a model that better matches Lariat's specific recipes, allergen data,
and kitchen language, you can do a lightweight LoRA fine-tune on your Mac:

### Install mlx-lm

```bash
pip install mlx-lm
```

### Run training

```bash
mlx_lm.lora --config training/mlx-lora-config.yaml
```

This takes ~15-30 min on an M4 with 16 GB. Adapters are saved to
`training/adapters/` every 50 iterations.

### Fuse adapters into the base model

```bash
mlx_lm.fuse \
  --model mlx-community/Llama-3.2-3B-Instruct-4bit \
  --adapter-path training/adapters \
  --save-path training/fused-model
```

### Convert to GGUF for Ollama

```bash
pip install llama-cpp-python
python -m mlx_lm.gguf --model training/fused-model --output training/lariat-finetuned.gguf
```

Then create an Ollama model from the GGUF:

```bash
# Create a Modelfile pointing to the GGUF
cat > training/Modelfile.finetuned <<'EOF'
FROM ./training/lariat-finetuned.gguf
PARAMETER temperature 0.2
PARAMETER top_p 0.85
PARAMETER num_predict 512
PARAMETER num_ctx 4096
PARAMETER stop "<|eot_id|>"
EOF

ollama create lariat-finetuned -f training/Modelfile.finetuned
```

Update `.env.local` to use the fine-tuned model:

```env
LARIAT_OLLAMA_MODEL=lariat-finetuned
```

## .env.local template

```env
# --- Lariat Kitchen Assistant (Ollama is required) ---
LARIAT_OLLAMA_MODEL=lari-the-kitchen-assistant
# LARIAT_OLLAMA_URL=http://127.0.0.1:11434
# LARIAT_ASSISTANT_TEMPERATURE=0.2
# LARIAT_ASSISTANT_MAX_TOKENS=512
# LARIAT_ASSISTANT_NUM_CTX=4096
# LARIAT_OLLAMA_TIMEOUT_MS=45000
```
