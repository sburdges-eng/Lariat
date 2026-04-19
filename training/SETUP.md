# Lariat Kitchen Assistant — Local Training Setup

Mac training guide for the Lariat kitchen assistant model.

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

Recommended (fits comfortably in 16 GB):

```bash
ollama pull gemma2:2b
```

Optional larger model (needs ~6 GB for inference):

```bash
ollama pull llama3.1:8b
```

## 3. Create the custom model

The `Modelfile` bakes in the Lariat system prompt so every chat session
starts with the grounded kitchen-assistant rules:

```bash
ollama create lariat-assistant -f training/Modelfile
```

Verify it loaded:

```bash
ollama list            # should show "lariat-assistant"
ollama run lariat-assistant "What are you?"
```

## 4. Configure the app

Create `.env.local` in the project root (or copy the template below):

```env
LARIAT_ASSISTANT_ENABLED=1
LARIAT_OLLAMA_MODEL=lariat-assistant
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
# --- Lariat Kitchen Assistant ---
LARIAT_ASSISTANT_ENABLED=1
LARIAT_OLLAMA_MODEL=lariat-assistant
# LARIAT_OLLAMA_URL=http://127.0.0.1:11434
# LARIAT_ASSISTANT_TEMPERATURE=0.2
# LARIAT_ASSISTANT_MAX_TOKENS=512
# LARIAT_ASSISTANT_NUM_CTX=4096
# LARIAT_OLLAMA_TIMEOUT_MS=45000
```
