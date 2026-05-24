# AWS SageMaker Training — Lariat Kitchen Assistant

Fine-tune Llama 3.1 8B Instruct on restaurant operations data using QLoRA
on SageMaker, within a $150 AWS free-credits budget.

## Quick Start

```bash
# 1. Fix your AWS credentials
aws configure
# Enter your Access Key ID, Secret, region (us-east-1)

# 2. Run everything
cd training/aws
./deploy.sh all
# This: preps data → uploads to S3 → launches training job

# 3. Monitor (training takes ~2-3 hours)
./deploy.sh status

# 4. When training completes, deploy the endpoint
./deploy.sh deploy

# 5. Test it
./deploy.sh test

# 6. IMPORTANT — tear down to stop billing
./deploy.sh teardown
```

## Budget Breakdown ($150)

| Item | Cost |
|------|------|
| Training: 1x ml.g5.xlarge, ~3 hrs | ~$4 |
| Training: 5 hyperparameter runs | ~$20 |
| Inference endpoint: 8 hrs testing | ~$11 |
| S3 storage | ~$0.05 |
| **Conservative total** | **~$8** |
| **Aggressive total (10 runs + 24hr)** | **~$80** |

## What Gets Trained

- **Base model**: Llama 3.1 8B Instruct (via HuggingFace)
- **Method**: QLoRA (4-bit quantization, rank 16, alpha 32)
- **Data**: 356 QA pairs covering:
  - Recipe ingredients, procedures, yields, stations (73 recipes)
  - Allergen queries with Big 9 FDA protocol (54 pairs)
  - All 12 action types (86, inventory, line check, maintenance, etc.)
  - HACCP food safety rules
  - Edge cases and refusal examples
  - Menu-to-recipe resolution
- **System prompt**: Full grounded kitchen assistant prompt baked into training data

## Architecture

```
training/aws/
├── deploy.sh                    # One-command deployment script
├── prepare-training-data.mjs    # Converts QA pairs to SageMaker format
├── train_script.py              # HuggingFace QLoRA training script
├── data/
│   ├── train.jsonl              # 284 training pairs (80%)
│   ├── val.jsonl                # 72 validation pairs (20%)
│   └── system-prompt.txt        # System prompt reference
└── README.md                    # This file

lib/sagemaker.ts                 # SageMaker inference client (drop-in for ollama.ts)
```

## Integration with Lariat

When the SageMaker endpoint is running, set this env var:

```bash
# In .env.local
LARIAT_SAGEMAKER_ENDPOINT=lariat-kitchen-assistant
```

The kitchen assistant API route checks for this env var and routes to
SageMaker instead of local Ollama. The lib/sagemaker.ts client provides
the same interface as lib/ollama.ts.

## Commands

| Command | Description |
|---------|-------------|
| `./deploy.sh prep` | Regenerate and format training data |
| `./deploy.sh upload` | Upload data to S3 |
| `./deploy.sh train` | Launch SageMaker training job |
| `./deploy.sh deploy` | Deploy trained model to endpoint |
| `./deploy.sh test` | Send test queries to endpoint |
| `./deploy.sh status` | Check job/endpoint status |
| `./deploy.sh cost` | Show cost estimates |
| `./deploy.sh teardown` | Delete endpoint (stop billing!) |
| `./deploy.sh all` | Full pipeline: prep → upload → train |

## Prerequisites

- AWS CLI configured with valid credentials
- IAM permissions: SageMaker, S3, IAM (for role creation)
- HuggingFace token (for Llama 3.1 gated model access):
  ```bash
  export HF_TOKEN=hf_your_token_here
  ```
  Accept the Llama 3.1 license at https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct

## Hyperparameter Tuning

Edit the config section at the top of deploy.sh:

```bash
EPOCHS=3                    # More epochs for small datasets
BATCH_SIZE=4                # Keep small for 24GB GPU
LEARNING_RATE="2e-4"        # Standard QLoRA LR
LORA_R=16                   # LoRA rank (8-64)
LORA_ALPHA=32               # Usually 2x rank
MAX_SEQ_LENGTH=2048         # Our prompts are ~1.5K tokens
```

## Troubleshooting

**"security token invalid"**: Run `aws configure` with fresh credentials.

**"ResourceLimitExceeded"**: Your account may need a service quota increase
for ml.g5.xlarge. Request via AWS console → Service Quotas → SageMaker.

**Training fails with OOM**: Reduce BATCH_SIZE to 2 or MAX_SEQ_LENGTH to 1024.

**HuggingFace model access denied**: Accept the Llama 3.1 license and set HF_TOKEN.
