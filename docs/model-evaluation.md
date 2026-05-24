# Local LLM Model Evaluation for Lariat Kitchen Assistant
# Target: Mac M4 16GB RAM | Ollama runtime | <2s TTFT | JSON action output
# Date: May 2026

## Memory Budget

Total RAM: 16 GB
OS + apps overhead: ~4-5 GB
Available for model + KV cache: ~11 GB
KV cache for 4K context (Q8): ~0.3-0.5 GB (depending on model)
Effective model weight budget: ~10 GB

Rule of thumb for GGUF memory:
- Q4_K_M: ~0.55 GB per billion params
- Q5_K_M: ~0.68 GB per billion params
- Q8_0:   ~1.07 GB per billion params

---

## CANDIDATE EVALUATION

### 1. Qwen 2.5 7B Instruct -- RECOMMENDED #1
- Params: 7.6B
- Memory: Q4_K_M ~4.4GB | Q5_K_M ~5.3GB | Q8 ~8.1GB
- Context window: 128K native (we only need 4K)
- Ollama: YES (qwen2.5:7b)
- MLX: YES (mlx-community/Qwen2.5-7B-Instruct-4bit)
- JSON reliability: EXCELLENT
- Instruction following: EXCELLENT -- best-in-class for 7B
- Safety/factuality: Very good grounding behavior
- TTFT on M4: ~0.8-1.2s at Q4_K_M
- VERDICT: Best overall. 6+ GB headroom at Q4_K_M.

### 2. Qwen 2.5 3B Instruct -- RECOMMENDED #2 (speed)
- Params: 3.1B
- Memory: Q4_K_M ~1.8GB | Q5_K_M ~2.2GB | Q8 ~3.4GB
- Context window: 32K native
- Ollama: YES (qwen2.5:3b)
- MLX: YES
- JSON reliability: GOOD
- Instruction following: GOOD
- TTFT on M4: ~0.3-0.5s at Q4_K_M
- VERDICT: Speed king. Q8 fits easily at 3.4GB.

### 3. Phi-4 Mini 3.8B
- Params: 3.8B
- Memory: Q4_K_M ~2.2GB | Q5_K_M ~2.7GB | Q8 ~4.1GB
- Context window: 128K native
- Ollama: YES (phi4-mini)
- MLX: YES
- JSON reliability: GOOD (adds commentary sometimes)
- Instruction following: GOOD but verbose
- TTFT on M4: ~0.4-0.6s
- VERDICT: Strong reasoning, verbosity concern for kitchen UX.

### 4. Gemma 3 4B Instruct
- Params: 4.3B
- Memory: Q4_K_M ~2.5GB | Q5_K_M ~3.1GB | Q8 ~4.6GB
- Ollama: YES (gemma3:4b)
- MLX: YES
- JSON reliability: GOOD
- Safety: Conservative/safe defaults
- VERDICT: Solid but Qwen 2.5 3B beats on JSON.

### 5. Gemma 3 9B Instruct
- Params: 9.2B
- Memory: Q4_K_M ~5.5GB
- TTFT: ~1.2-1.8s (borderline 2s target)
- VERDICT: Fits but tight. Qwen 7B better value.

### 6. Llama 3.2 3B -- backup option
- JSON reliability: FAIR
- VERDICT: Qwen 2.5 3B strictly better for structured output.

### 7. Llama 3.1 8B
- VERDICT: Viable but Qwen 2.5 7B better at same size.

### 8. Mistral 7B v0.3
- VERDICT: Superseded by Qwen 2.5 7B. Skip.

### 9. DeepSeek-R1 Distill
- VERDICT: Wrong model class (reasoning/CoT). Skip.

### 10. SmolLM2 1.7B / Llama 3.2 1B
- VERDICT: Too small for safety-critical structured output. Skip.

---

## FINAL RANKINGS

| Rank | Model           | Quant  | RAM   | TTFT  | JSON | Safety |
|------|-----------------|--------|-------|-------|------|--------|
| 1    | Qwen 2.5 7B     | Q4_K_M | 4.4GB | ~1.0s | A    | A      |
| 2    | Qwen 2.5 3B     | Q8_0   | 3.4GB | ~0.4s | B+   | B+     |
| 3    | Phi-4 Mini 3.8B | Q5_K_M | 2.7GB | ~0.5s | B+   | B      |
| 4    | Gemma 3 4B      | Q5_K_M | 3.1GB | ~0.5s | B    | A-     |
| 5    | Llama 3.2 3B    | Q8_0   | 3.5GB | ~0.4s | B-   | B      |

---

## RECOMMENDED CONFIGURATION

PRIMARY: Qwen 2.5 7B Instruct @ Q4_K_M via Ollama
  ollama pull qwen2.5:7b-instruct-q4_K_M
  ~4.8 GB total (model + KV cache), ~6 GB headroom, ~1.0s TTFT

FALLBACK: Qwen 2.5 3B Instruct @ Q8_0 via Ollama
  ollama pull qwen2.5:3b-instruct-q8_0
  ~3.7 GB total, ~0.4s TTFT

UPGRADE: Qwen 2.5 7B @ Q5_K_M if Q4 quality insufficient (~5.3 GB)

## IMPLEMENTATION NOTES
1. Use Ollama JSON mode (format: json) for guaranteed valid JSON
2. temperature: 0.1 for structured output reliability
3. num_ctx: 4096 (saves memory, matches use case)
4. Few-shot examples in system prompt for each action type
5. Both Qwen models use Apache 2.0 -- no commercial restrictions
6. Consider dual-model: 3B for simple lookups, 7B for complex reasoning
