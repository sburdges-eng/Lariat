#!/usr/bin/env bash
# training/run-lora.sh — Download model + run LoRA fine-tuning
# Requires: pip install mlx-lm
# Uses HF_HOME to avoid broken symlink to unmounted SSD.
#
# Usage:
#   bash training/run-lora.sh

set -euo pipefail
cd "$(dirname "$0")/.."

export HF_HOME="${HF_HOME:-$PWD/.hf_cache}"
export HF_HUB_DISABLE_XET=1

PY_USER_BASE="$(python3 -m site --user-base 2>/dev/null || true)"
if [ -n "$PY_USER_BASE" ] && [ -d "$PY_USER_BASE/bin" ]; then
  export PATH="$PY_USER_BASE/bin:$PATH"
fi

if ! command -v mlx_lm.lora >/dev/null 2>&1; then
  echo "mlx_lm.lora not found. Install mlx-lm or add it to PATH." >&2
  exit 1
fi

mkdir -p "$HF_HOME"

echo "==> HF_HOME: $HF_HOME"
echo "==> Regenerating QA data..."
node training/generate-qa.mjs

echo "==> Starting LoRA fine-tuning (200 iters, ~15-30 min on M4)..."
mlx_lm.lora --config training/mlx-lora-config.yaml

echo "==> Training complete. Adapters saved to training/adapters/"
echo ""
echo "Next steps:"
echo "  1. Fuse:    mlx_lm.fuse --model mlx-community/gemma-2-2b-it-4bit --adapter-path training/adapters --save-path training/fused-model"
echo "  2. Convert: python -m mlx_lm.gguf --model training/fused-model --output training/lariat-finetuned.gguf"
echo "  3. Import:  ollama create lariat-finetuned -f training/Modelfile.finetuned"
echo "  4. Update:  LARIAT_OLLAMA_MODEL=lariat-finetuned in .env.local"
