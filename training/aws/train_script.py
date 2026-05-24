"""
train_script.py — SageMaker HuggingFace training script for Lariat kitchen assistant.

Fine-tunes Llama 3.1 8B Instruct with QLoRA on restaurant operations QA data.
Runs inside the SageMaker HuggingFace PyTorch Training DLC.

Inputs (via hyperparameters + S3 channels):
  - model_id:       HuggingFace model ID (e.g. meta-llama/Llama-3.1-8B-Instruct)
  - training channel: S3 path with train.jsonl and val.jsonl
  - LoRA config:    rank, alpha, dropout, target modules
  - Training config: epochs, batch size, learning rate, etc.

Output:
  - Merged model (adapter weights fused into base) saved to /opt/ml/model/
  - Training metrics logged to CloudWatch via SageMaker
"""

import os
import sys
import json
import logging
import argparse
import subprocess
from pathlib import Path

# Install dependencies compatible with DLC's PyTorch 2.1.0
# CRITICAL: pin transformers<4.46 to avoid "PyTorch >= 2.4 required" breakage
subprocess.check_call([
    sys.executable, "-m", "pip", "install", "-q",
    "transformers>=4.36.0,<4.46.0",
    "peft>=0.10.0,<0.14.0",
    "trl>=0.8.0,<0.12.0",
    "bitsandbytes>=0.43.0,<0.45.0",
    "accelerate>=0.27.0,<0.35.0",
    "datasets>=2.18.0",
])

import torch
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTTrainer
try:
    from trl import SFTConfig
except ImportError:
    SFTConfig = None  # older trl uses TrainingArguments directly

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def parse_args():
    parser = argparse.ArgumentParser()

    # Model
    parser.add_argument("--model_id", type=str, default="meta-llama/Llama-3.1-8B-Instruct")

    # LoRA
    parser.add_argument("--lora_r", type=int, default=16)
    parser.add_argument("--lora_alpha", type=int, default=32)
    parser.add_argument("--lora_dropout", type=float, default=0.05)

    # Training
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--per_device_train_batch_size", type=int, default=4)
    parser.add_argument("--per_device_eval_batch_size", type=int, default=4)
    parser.add_argument("--learning_rate", type=float, default=2e-4)
    parser.add_argument("--max_seq_length", type=int, default=2048)
    parser.add_argument("--gradient_accumulation_steps", type=int, default=4)
    parser.add_argument("--warmup_ratio", type=float, default=0.03)
    parser.add_argument("--weight_decay", type=float, default=0.001)
    parser.add_argument("--bf16", type=str, default="true")
    parser.add_argument("--gradient_checkpointing", type=str, default="true")
    parser.add_argument("--merge_adapters", type=str, default="true")
    parser.add_argument("--dataset_text_field", type=str, default="messages")

    # SageMaker paths
    parser.add_argument("--model_dir", type=str, default=os.environ.get("SM_MODEL_DIR", "/opt/ml/model"))
    parser.add_argument("--training_dir", type=str, default=os.environ.get("SM_CHANNEL_TRAINING", "/opt/ml/input/data/training"))
    parser.add_argument("--output_data_dir", type=str, default=os.environ.get("SM_OUTPUT_DATA_DIR", "/opt/ml/output/data"))

    return parser.parse_args()


def format_chat_template(example, tokenizer):
    """Apply the chat template to convert messages list into a single text string."""
    messages = example.get("messages", [])
    if isinstance(messages, str):
        messages = json.loads(messages)
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    return {"text": text}


def main():
    args = parse_args()
    logger.info(f"Arguments: {args}")

    # ── Load tokenizer ────────────────────────────────────────────────
    logger.info(f"Loading tokenizer: {args.model_id}")
    tokenizer = AutoTokenizer.from_pretrained(args.model_id)

    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
        tokenizer.pad_token_id = tokenizer.eos_token_id

    # ── Load dataset ──────────────────────────────────────────────────
    logger.info(f"Loading dataset from {args.training_dir}")

    train_path = os.path.join(args.training_dir, "train.jsonl")
    val_path = os.path.join(args.training_dir, "val.jsonl")

    data_files = {"train": train_path}
    if os.path.exists(val_path):
        data_files["validation"] = val_path

    dataset = load_dataset("json", data_files=data_files)

    logger.info(f"Train samples: {len(dataset['train'])}")
    if "validation" in dataset:
        logger.info(f"Val samples: {len(dataset['validation'])}")

    # Apply chat template
    dataset = dataset.map(
        lambda x: format_chat_template(x, tokenizer),
        remove_columns=dataset["train"].column_names,
    )

    # ── QLoRA config ──────────────────────────────────────────────────
    logger.info("Setting up QLoRA...")

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_use_double_quant=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
    )

    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        bias="none",
        task_type="CAUSAL_LM",
    )

    # ── Load model ────────────────────────────────────────────────────
    logger.info(f"Loading model: {args.model_id}")

    model = AutoModelForCausalLM.from_pretrained(
        args.model_id,
        quantization_config=bnb_config,
        device_map="auto",
        torch_dtype=torch.bfloat16,
        attn_implementation="flash_attention_2",
    )

    model = prepare_model_for_kbit_training(model)
    model = get_peft_model(model, lora_config)

    trainable_params, all_params = model.get_nb_trainable_parameters()
    logger.info(
        f"Trainable params: {trainable_params:,} / {all_params:,} "
        f"({100 * trainable_params / all_params:.2f}%)"
    )

    # ── Training arguments ────────────────────────────────────────────
    use_bf16 = args.bf16.lower() == "true"
    use_gc = args.gradient_checkpointing.lower() == "true"

    ConfigClass = SFTConfig if SFTConfig is not None else TrainingArguments

    config_kwargs = dict(
        output_dir=os.path.join(args.output_data_dir, "checkpoints"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.per_device_train_batch_size,
        per_device_eval_batch_size=args.per_device_eval_batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        learning_rate=args.learning_rate,
        warmup_ratio=args.warmup_ratio,
        weight_decay=args.weight_decay,
        bf16=use_bf16,
        gradient_checkpointing=use_gc,
        gradient_checkpointing_kwargs={"use_reentrant": False} if use_gc else {},
        logging_steps=10,
        save_strategy="epoch",
        report_to="none",
        optim="paged_adamw_8bit",
        lr_scheduler_type="cosine",
        seed=42,
    )

    # SFTConfig-only args
    if SFTConfig is not None:
        config_kwargs["max_seq_length"] = args.max_seq_length
        config_kwargs["packing"] = True
        config_kwargs["dataset_text_field"] = "text"
        config_kwargs["eval_strategy"] = "epoch" if "validation" in dataset else "no"
    else:
        config_kwargs["evaluation_strategy"] = "epoch" if "validation" in dataset else "no"

    training_args = ConfigClass(**config_kwargs)

    # ── Train ─────────────────────────────────────────────────────────
    logger.info("Starting training...")

    # trl<0.12 uses 'tokenizer', >=0.12 uses 'processing_class'
    try:
        trainer = SFTTrainer(
            model=model,
            args=training_args,
            train_dataset=dataset["train"],
            eval_dataset=dataset.get("validation"),
            processing_class=tokenizer,
        )
    except TypeError:
        trainer = SFTTrainer(
            model=model,
            args=training_args,
            train_dataset=dataset["train"],
            eval_dataset=dataset.get("validation"),
            tokenizer=tokenizer,
        )

    train_result = trainer.train()

    # Log metrics
    metrics = train_result.metrics
    logger.info(f"Training metrics: {json.dumps(metrics, indent=2)}")

    # Save metrics
    trainer.log_metrics("train", metrics)
    trainer.save_metrics("train", metrics)

    if "validation" in dataset:
        eval_metrics = trainer.evaluate()
        logger.info(f"Eval metrics: {json.dumps(eval_metrics, indent=2)}")
        trainer.log_metrics("eval", eval_metrics)
        trainer.save_metrics("eval", eval_metrics)

    # ── Save model ────────────────────────────────────────────────────
    logger.info(f"Saving model to {args.model_dir}")

    if args.merge_adapters.lower() == "true":
        logger.info("Merging LoRA adapters into base model...")
        merged_model = model.merge_and_unload()
        merged_model.save_pretrained(args.model_dir, safe_serialization=True)
    else:
        # Save adapter only
        model.save_pretrained(args.model_dir)

    tokenizer.save_pretrained(args.model_dir)

    # Save training config for reproducibility
    config = {
        "base_model": args.model_id,
        "lora_r": args.lora_r,
        "lora_alpha": args.lora_alpha,
        "lora_dropout": args.lora_dropout,
        "epochs": args.epochs,
        "batch_size": args.per_device_train_batch_size,
        "learning_rate": args.learning_rate,
        "max_seq_length": args.max_seq_length,
        "train_samples": len(dataset["train"]),
        "val_samples": len(dataset.get("validation", [])),
        "trainable_params": trainable_params,
        "total_params": all_params,
        "metrics": metrics,
    }
    with open(os.path.join(args.model_dir, "lariat_training_config.json"), "w") as f:
        json.dump(config, f, indent=2)

    logger.info("Training complete ✓")


if __name__ == "__main__":
    main()
