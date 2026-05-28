#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# train-local.sh — Local LoRA fine-tuning for Lariat kitchen assistant
#
# Optimized for M4 MacBook Pro 16GB.
# Base model: Qwen 2.5 7B Instruct (4-bit via MLX)
#
# Usage:
#   cd training
#   ./train-local.sh           # Full pipeline: install → generate → train → fuse → deploy
#   ./train-local.sh generate  # Just regenerate QA data
#   ./train-local.sh train     # Just run LoRA training
#   ./train-local.sh fuse      # Fuse adapters into base
#   ./train-local.sh convert   # Convert to GGUF for Ollama
#   ./train-local.sh deploy    # Create Ollama model
#   ./train-local.sh test      # Run eval harness
#   ./train-local.sh bench     # Benchmark latency
# ──────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Config ────────────────────────────────────────────────────────────

BASE_MODEL="mlx-community/Qwen2.5-7B-Instruct-4bit"
OLLAMA_BASE="qwen2.5:7b-instruct-q4_K_M"
OLLAMA_MODEL_NAME="lari-qwen"
ADAPTER_DIR="$SCRIPT_DIR/adapters-qwen"
FUSED_DIR="$SCRIPT_DIR/fused-qwen"
GGUF_PATH="$SCRIPT_DIR/lari-qwen.gguf"
CONFIG="$SCRIPT_DIR/mlx-lora-config-qwen.yaml"
TMP_BASE="${TMPDIR:-${ROOT_DIR}/.tmp}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[LARIAT]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Preflight ─────────────────────────────────────────────────────────

preflight() {
  log "Preflight checks..."

  # Check hardware
  local MEM=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
  local MEM_GB=$((MEM / 1073741824))
  log "  RAM: ${MEM_GB} GB"

  if [ "$MEM_GB" -lt 16 ]; then
    err "Need at least 16 GB RAM. Found ${MEM_GB} GB."
    exit 1
  fi

  # Check Python
  if ! command -v python3 &>/dev/null; then
    err "python3 not found"
    exit 1
  fi

  # Check/install mlx-lm
  if ! python3 -c "import mlx_lm" 2>/dev/null; then
    log "  Installing mlx-lm..."
    pip3 install -q mlx-lm
  fi
  local MLX_VER=$(python3 -c "import mlx_lm; print(mlx_lm.__version__)" 2>/dev/null || echo "?")
  log "  mlx-lm: $MLX_VER"

  # Check Ollama
  if ! command -v ollama &>/dev/null; then
    err "Ollama not installed. Get it at https://ollama.ai"
    exit 1
  fi

  # Make sure Ollama is running
  if ! curl -s http://127.0.0.1:11434/api/tags &>/dev/null; then
    warn "Ollama not running. Starting..."
    ollama serve &>/dev/null &
    sleep 3
  fi

  # Check base model
  if ! ollama list 2>/dev/null | grep -q "$OLLAMA_BASE"; then
    log "  Pulling base model: $OLLAMA_BASE"
    ollama pull "$OLLAMA_BASE"
  fi

  log "Preflight OK ✓"
}

# ── Step 1: Generate training data ────────────────────────────────────

cmd_generate() {
  log "Step 1: Generating training data..."
  cd "$ROOT_DIR"
  node training/generate-qa.mjs
  log "Training data generated ✓"
}

# ── Step 2: LoRA fine-tuning ──────────────────────────────────────────

cmd_train() {
  log "Step 2: LoRA fine-tuning..."
  log "  Model: $BASE_MODEL"
  log "  Config: $CONFIG"
  log "  Output: $ADAPTER_DIR"

  cd "$ROOT_DIR"

  # Set HuggingFace cache to avoid re-downloads
  export HF_HOME="${HF_HOME:-$HOME/.cache/huggingface}"

  python3 -m mlx_lm.lora --config "$CONFIG"

  log "LoRA training complete ✓"
  log "  Adapters saved to: $ADAPTER_DIR"

  # Show training loss from last save
  if [ -f "$ADAPTER_DIR/adapter_config.json" ]; then
    log "  Adapter config saved"
  fi
}

# ── Step 3: Fuse adapters ─────────────────────────────────────────────

cmd_fuse() {
  log "Step 3: Fusing LoRA adapters into base model..."

  if [ ! -d "$ADAPTER_DIR" ]; then
    err "No adapters found at $ADAPTER_DIR. Run training first."
    exit 1
  fi

  python3 -m mlx_lm.fuse \
    --model "$BASE_MODEL" \
    --adapter-path "$ADAPTER_DIR" \
    --save-path "$FUSED_DIR"

  log "Fused model saved to: $FUSED_DIR ✓"
}

# ── Step 4: Convert to GGUF ───────────────────────────────────────────

cmd_convert() {
  log "Step 4: Converting to GGUF..."

  if [ ! -d "$FUSED_DIR" ]; then
    err "No fused model at $FUSED_DIR. Run fuse first."
    exit 1
  fi

  # mlx_lm can convert directly to GGUF
  python3 -m mlx_lm.convert \
    --model "$FUSED_DIR" \
    --quantize q4_K_M \
    --gguf \
    --gguf-path "$GGUF_PATH"

  local SIZE=$(du -h "$GGUF_PATH" | cut -f1)
  log "GGUF saved: $GGUF_PATH ($SIZE) ✓"
}

# ── Step 5: Deploy to Ollama ──────────────────────────────────────────

cmd_deploy() {
  log "Step 5: Deploying to Ollama..."

  # Create Modelfile pointing to the GGUF or use the base + Modelfile.qwen
  if [ -f "$GGUF_PATH" ]; then
    log "  Using fine-tuned GGUF: $GGUF_PATH"
    # Create a Modelfile pointing to the GGUF
    cat > "$SCRIPT_DIR/Modelfile.qwen.local" << EOF
FROM $GGUF_PATH

PARAMETER temperature 0.1
PARAMETER top_p 0.9
PARAMETER top_k 40
PARAMETER num_predict 512
PARAMETER num_ctx 4096
PARAMETER repeat_penalty 1.1
PARAMETER stop "<|im_end|>"
EOF
    ollama create "$OLLAMA_MODEL_NAME" -f "$SCRIPT_DIR/Modelfile.qwen.local"
  else
    log "  No GGUF found — deploying base Qwen with Modelfile.qwen"
    ollama create "$OLLAMA_MODEL_NAME" -f "$SCRIPT_DIR/Modelfile.qwen"
  fi

  log "Ollama model created: $OLLAMA_MODEL_NAME ✓"

  # Verify
  ollama list | grep "$OLLAMA_MODEL_NAME"

  # Quick smoke test
  log "Running smoke test..."
  local RESPONSE
  RESPONSE=$(ollama run "$OLLAMA_MODEL_NAME" "What are the ingredients in brisket rub?" 2>&1 | head -5)
  log "  Response: $RESPONSE"
  log "Deploy complete ✓"
}

# ── Step 6: Benchmark ─────────────────────────────────────────────────

cmd_bench() {
  log "Benchmarking $OLLAMA_MODEL_NAME..."

  # TTFT test
  local START END TTFT
  mkdir -p "$TMP_BASE"
  for i in 1 2 3; do
    START=$(python3 -c "import time; print(time.time())")
    local BENCH_OUT="${TMP_BASE%/}/lariat-bench-$i.json"
    curl -s http://127.0.0.1:11434/api/chat -d "{
      \"model\": \"$OLLAMA_MODEL_NAME\",
      \"stream\": false,
      \"messages\": [{\"role\": \"user\", \"content\": \"What are the ingredients in brisket rub?\"}],
      \"options\": {\"num_predict\": 50, \"num_ctx\": 4096, \"temperature\": 0.1}
    }" > "$BENCH_OUT" 2>/dev/null
    END=$(python3 -c "import time; print(time.time())")
    TTFT=$(python3 -c "print(f'{$END - $START:.2f}s')")
    log "  Run $i: $TTFT"
  done

  # Memory usage
  local MEM_USED
  MEM_USED=$(ps aux | grep -i ollama | grep -v grep | awk '{sum+=$6} END {print int(sum/1024) " MB"}')
  log "  Ollama memory: $MEM_USED"

  log "Benchmark complete ✓"
}

# ── Step 7: Eval ──────────────────────────────────────────────────────

cmd_test() {
  log "Running eval harness..."
  cd "$ROOT_DIR"

  if [ -f "training/eval/run-eval.mjs" ]; then
    LARIAT_OLLAMA_MODEL="$OLLAMA_MODEL_NAME" node training/eval/run-eval.mjs
  else
    warn "Eval harness not found at training/eval/run-eval.mjs"
  fi
}

# ── Main dispatch ─────────────────────────────────────────────────────

case "${1:-all}" in
  generate) cmd_generate ;;
  train)    preflight; cmd_train ;;
  fuse)     cmd_fuse ;;
  convert)  cmd_convert ;;
  deploy)   preflight; cmd_deploy ;;
  bench)    cmd_bench ;;
  test)     cmd_test ;;
  all)
    preflight
    cmd_generate
    cmd_train
    cmd_fuse
    cmd_convert
    cmd_deploy
    cmd_bench
    log ""
    log "=== ALL DONE ==="
    log "Model '$OLLAMA_MODEL_NAME' is ready."
    log "Set LARIAT_OLLAMA_MODEL=$OLLAMA_MODEL_NAME in .env.local"
    log "Or just start the Cockpit — it defaults to $OLLAMA_MODEL_NAME now."
    ;;
  *)
    echo "Usage: $0 {generate|train|fuse|convert|deploy|bench|test|all}"
    exit 1
    ;;
esac
