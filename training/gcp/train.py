#!/usr/bin/env python3
"""Lariat KA v2 — QLoRA SFT on Vertex AI, ending with an on-VM GGUF q4_K_M.

Runs inside a Vertex prebuilt PyTorch GPU container; deps come from
requirements.txt (installed by the job's entry command — see launch-sweep).

Pipeline per job:
  GCS data/{train,val}.jsonl -> TRL SFTTrainer (bnb nf4 QLoRA) -> eval loss
  -> merge adapters into bf16 base -> llama.cpp convert_hf_to_gguf (f16)
  -> llama-quantize q4_k_m -> upload GGUF + adapters + metrics.json to
  gs://<bucket>/runs/<run_id>/.

Chat template policy: for Qwen bases we OVERRIDE the tokenizer template with
plain chatml — the identical template ships in the Ollama Modelfile
(Modelfile.qwen-v2.tmpl), so train and serve formats match byte-for-byte.
The generation prompt seeds an EMPTY <think></think> block (Qwen's documented
mechanism for disabling its native hybrid thinking mode on non-"-Instruct-2507"
bases): without it the model intermittently burns num_predict on invisible
reasoning and truncates the real answer (`think:false` in the Ollama request
does NOT suppress this — that flag only affects models Ollama recognizes as
having a "thinking" capability, which a manually llama.cpp-converted GGUF
does not carry). Seeding the SAME empty block in training assistant turns
(not just at serve time) lets the model learn to go straight to content
instead of paying a train/serve template mismatch tax. Llama 3.1 keeps its
native template (mirrored by Modelfile.llama31-v2.tmpl) and has no hybrid-
thinking default, so it needs no such seeding.
"""
import argparse
import json
import os
import subprocess
import time

# must be set before torch import — reduces fragmentation OOMs at 8k seq
os.environ.setdefault('PYTORCH_CUDA_ALLOC_CONF', 'expandable_segments:True')

CHATML = (
    "{% for message in messages %}{{ '<|im_start|>' + message['role'] + '\n' "
    "+ message['content'] + '<|im_end|>' + '\n' }}{% endfor %}"
    "{% if add_generation_prompt %}{{ '<|im_start|>assistant\n<think>\n\n</think>\n\n' }}{% endif %}"
)


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
    from peft import LoraConfig, PeftModel
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
    print(f"rows: train={len(ds['train'])} val={len(ds['val'])}", flush=True)

    tok = AutoTokenizer.from_pretrained(a.base, trust_remote_code=True)
    if a.chat_template == 'chatml':
        tok.chat_template = CHATML  # plain chatml — matches Modelfile.qwen-v2.tmpl
    bnb = BitsAndBytesConfig(
        load_in_4bit=True, bnb_4bit_quant_type='nf4',
        bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.bfloat16)
    model = AutoModelForCausalLM.from_pretrained(
        a.base, quantization_config=bnb, torch_dtype=torch.bfloat16,
        attn_implementation='sdpa', device_map='auto', trust_remote_code=True)

    peft_cfg = LoraConfig(
        r=a.lora_r, lora_alpha=2 * a.lora_r, lora_dropout=0.05, bias='none',
        task_type='CAUSAL_LM',
        target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'])
    cfg = SFTConfig(
        output_dir='/tmp/out', num_train_epochs=a.epochs, learning_rate=a.lr,
        per_device_train_batch_size=1, gradient_accumulation_steps=8,
        # eval OOMs are the failure mode here: fp32 logits at 8k seq x 151k
        # vocab are ~5GB PER SAMPLE, so eval must run batch=1, bf16, and move
        # logits off-GPU frequently (smoke-0 died exactly here at batch=8).
        per_device_eval_batch_size=1, bf16_full_eval=True, eval_accumulation_steps=1,
        gradient_checkpointing=True, max_length=a.max_seq, packing=False,
        bf16=True, logging_steps=20, eval_strategy='epoch', save_strategy='no',
        lr_scheduler_type='cosine', warmup_ratio=0.03, optim='paged_adamw_8bit',
        report_to=[])
    trainer = SFTTrainer(
        model=model, args=cfg, train_dataset=ds['train'],
        eval_dataset=ds['val'], processing_class=tok, peft_config=peft_cfg)
    trainer.train()
    val = trainer.evaluate()
    trainer.save_model('/tmp/out/adapters')
    print(f"val: {val}", flush=True)

    # merge LoRA into a bf16 base on CPU for GGUF conversion
    del model, trainer
    torch.cuda.empty_cache()
    base = AutoModelForCausalLM.from_pretrained(
        a.base, torch_dtype=torch.bfloat16, device_map='cpu', trust_remote_code=True)
    merged = PeftModel.from_pretrained(base, '/tmp/out/adapters').merge_and_unload()
    merged.save_pretrained('/tmp/merged', safe_serialization=True)
    tok.save_pretrained('/tmp/merged')
    del base, merged

    # GGUF: convert (pure python) + quantize. The prebuilt container has no
    # cmake — pip provides cmake+ninja binaries. If the toolchain still fails,
    # upload the f16 instead; the Mac quantizes locally (brew llama-quantize).
    sh('git clone --depth 1 https://github.com/ggml-org/llama.cpp /tmp/llama.cpp')
    sh('pip install -q -r /tmp/llama.cpp/requirements/requirements-convert_hf_to_gguf.txt')
    sh('python /tmp/llama.cpp/convert_hf_to_gguf.py /tmp/merged --outtype f16 --outfile /tmp/model-f16.gguf')
    gguf_path, gguf_name = '/tmp/model-f16.gguf', 'model-f16.gguf'
    try:
        sh('pip install -q cmake ninja')
        sh('cmake -S /tmp/llama.cpp -B /tmp/llama.cpp/build -G Ninja -DGGML_CUDA=OFF '
           '-DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=OFF')
        sh('cmake --build /tmp/llama.cpp/build --target llama-quantize -j')
        sh('/tmp/llama.cpp/build/bin/llama-quantize /tmp/model-f16.gguf /tmp/model-q4_k_m.gguf q4_k_m')
        gguf_path, gguf_name = '/tmp/model-q4_k_m.gguf', 'model-q4_k_m.gguf'
    except subprocess.CalledProcessError as e:
        print(f'quantize failed ({e}); uploading f16 fallback', flush=True)

    prefix = f'runs/{a.run_id}'
    bkt.blob(f'{prefix}/{gguf_name}').upload_from_filename(gguf_path, timeout=3600)
    for root, _dirs, files in os.walk('/tmp/out/adapters'):
        for f in files:
            p = os.path.join(root, f)
            rel = os.path.relpath(p, '/tmp/out/adapters')
            bkt.blob(f'{prefix}/adapters/{rel}').upload_from_filename(p, timeout=600)
    metrics = {
        'run_id': a.run_id, 'base_model': a.base,
        'val_loss': val.get('eval_loss'),
        'train_runtime_s': round(time.time() - t0),
        'gguf': gguf_name,
        'config': {'lora_r': a.lora_r, 'lr': a.lr, 'epochs': a.epochs,
                   'max_seq': a.max_seq, 'chat_template': a.chat_template},
    }
    bkt.blob(f'{prefix}/metrics.json').upload_from_string(json.dumps(metrics, indent=2))
    print('DONE', json.dumps(metrics), flush=True)


if __name__ == '__main__':
    main()
