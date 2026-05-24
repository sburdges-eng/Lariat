#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# deploy.sh — One-command SageMaker fine-tuning + deployment for Lariat
#
# Usage:
#   cd training/aws
#   ./deploy.sh              # Full pipeline: prep → upload → train → deploy
#   ./deploy.sh prep         # Just prepare data
#   ./deploy.sh upload       # Upload to S3
#   ./deploy.sh train        # Launch SageMaker training job
#   ./deploy.sh deploy       # Deploy trained model to endpoint
#   ./deploy.sh test         # Test the live endpoint
#   ./deploy.sh teardown     # Delete endpoint (stop billing)
#   ./deploy.sh status       # Check job/endpoint status
#   ./deploy.sh cost         # Estimate costs
#
# Budget: $150 AWS free credits
# ──────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Config ────────────────────────────────────────────────────────────

AWS_REGION="${AWS_REGION:-us-east-1}"
S3_BUCKET="${LARIAT_S3_BUCKET:-lariat-ml-training-$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo 'UNKNOWN')}"
S3_PREFIX="lariat-kitchen-assistant"

# Model config
BASE_MODEL="meta-llama/Llama-3.1-8B-Instruct"
# SageMaker HF LLM container for QLoRA
INSTANCE_TYPE="ml.g5.xlarge"        # 1x A10G 24GB, $1.41/hr
INSTANCE_COUNT=1

# Training hyperparameters
EPOCHS=3
BATCH_SIZE=4
LEARNING_RATE="2e-4"
LORA_R=16
LORA_ALPHA=32
LORA_DROPOUT="0.05"
MAX_SEQ_LENGTH=2048
GRADIENT_ACCUMULATION=4
WARMUP_RATIO="0.03"
WEIGHT_DECAY="0.001"

# Endpoint config
ENDPOINT_INSTANCE="ml.g5.xlarge"    # Same GPU for inference
ENDPOINT_NAME="lariat-kitchen-assistant"

# Job naming
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
JOB_NAME="lariat-ka-${TIMESTAMP}"
MODEL_NAME="lariat-ka-model-${TIMESTAMP}"

# IAM Role (must have SageMaker + S3 permissions)
SAGEMAKER_ROLE="${SAGEMAKER_ROLE:-arn:aws:iam::549044232495:role/service-role/AmazonSageMaker-ExecutionRole-20260310T014184}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[LARIAT]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Preflight ─────────────────────────────────────────────────────────

preflight() {
  log "Preflight checks..."

  # AWS CLI
  if ! command -v aws &>/dev/null; then
    err "AWS CLI not installed. Run: brew install awscli"
    exit 1
  fi

  # Credentials
  if ! aws sts get-caller-identity &>/dev/null; then
    err "AWS credentials invalid. Run: aws configure"
    exit 1
  fi

  ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
  log "  Account: $ACCOUNT_ID"
  log "  Region:  $AWS_REGION"

  # SageMaker role
  if [ -z "$SAGEMAKER_ROLE" ]; then
    # Try to find an existing SageMaker role
    SAGEMAKER_ROLE=$(aws iam list-roles --query "Roles[?contains(RoleName, 'SageMaker')].Arn | [0]" --output text 2>/dev/null || echo "")
    if [ "$SAGEMAKER_ROLE" = "None" ] || [ -z "$SAGEMAKER_ROLE" ]; then
      warn "No SageMaker IAM role found. Creating one..."
      create_sagemaker_role
    fi
  fi
  log "  Role:    $SAGEMAKER_ROLE"

  # S3 bucket
  if ! aws s3 ls "s3://${S3_BUCKET}" &>/dev/null; then
    log "  Creating S3 bucket: $S3_BUCKET"
    if [ "$AWS_REGION" = "us-east-1" ]; then
      aws s3api create-bucket --bucket "$S3_BUCKET"
    else
      aws s3api create-bucket --bucket "$S3_BUCKET" \
        --create-bucket-configuration LocationConstraint="$AWS_REGION"
    fi
  fi
  log "  Bucket:  s3://$S3_BUCKET"

  log "Preflight OK ✓"
}

create_sagemaker_role() {
  local ROLE_NAME="LariatSageMakerRole"
  local TRUST_POLICY='{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "sagemaker.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "Lariat SageMaker training and inference role" \
    >/dev/null

  # Attach managed policies
  aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AmazonSageMakerFullAccess
  aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

  SAGEMAKER_ROLE=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
  log "  Created IAM role: $SAGEMAKER_ROLE"

  # Wait for role propagation
  sleep 10
}

# ── Step 1: Prepare data ──────────────────────────────────────────────

cmd_prep() {
  log "Step 1: Preparing training data..."
  cd "$ROOT_DIR"

  # Generate QA pairs from cache
  node training/generate-qa.mjs

  # Convert to SageMaker format with system prompts
  node training/aws/prepare-training-data.mjs

  log "Training data prepared ✓"
}

# ── Step 2: Upload to S3 ─────────────────────────────────────────────

cmd_upload() {
  log "Step 2: Uploading to S3..."
  preflight

  local DATA_DIR="$SCRIPT_DIR/data"
  if [ ! -f "$DATA_DIR/train.jsonl" ]; then
    err "No training data found. Run: ./deploy.sh prep"
    exit 1
  fi

  aws s3 sync "$DATA_DIR/" "s3://${S3_BUCKET}/${S3_PREFIX}/data/" \
    --exclude '.*' \
    --delete

  log "Uploaded to s3://${S3_BUCKET}/${S3_PREFIX}/data/"

  # Show sizes
  aws s3 ls "s3://${S3_BUCKET}/${S3_PREFIX}/data/" --human-readable
  log "Upload complete ✓"
}

# ── Step 3: Launch training job ───────────────────────────────────────

cmd_train() {
  log "Step 3: Launching SageMaker training job..."
  preflight

  # Get the HuggingFace Training DLC image URI
  local HF_IMAGE
  HF_IMAGE=$(aws sagemaker list-images --query "Images[?contains(ImageName, 'huggingface-pytorch-tgi')].ImageName | [0]" --output text 2>/dev/null || echo "")

  # Use the HuggingFace LLM training container
  local IMAGE_URI="763104351884.dkr.ecr.${AWS_REGION}.amazonaws.com/huggingface-pytorch-training:2.3.0-transformers4.46.3-gpu-py311-cu121-ubuntu22.04"

  cat > /tmp/lariat-training-job.json << JOBEOF
{
  "TrainingJobName": "${JOB_NAME}",
  "RoleArn": "${SAGEMAKER_ROLE}",
  "AlgorithmSpecification": {
    "TrainingImage": "${IMAGE_URI}",
    "TrainingInputMode": "File"
  },
  "HyperParameters": {
    "model_id": "${BASE_MODEL}",
    "epochs": "${EPOCHS}",
    "per_device_train_batch_size": "${BATCH_SIZE}",
    "learning_rate": "${LEARNING_RATE}",
    "lora_r": "${LORA_R}",
    "lora_alpha": "${LORA_ALPHA}",
    "lora_dropout": "${LORA_DROPOUT}",
    "max_seq_length": "${MAX_SEQ_LENGTH}",
    "gradient_accumulation_steps": "${GRADIENT_ACCUMULATION}",
    "warmup_ratio": "${WARMUP_RATIO}",
    "weight_decay": "${WEIGHT_DECAY}",
    "bf16": "true",
    "gradient_checkpointing": "true",
    "merge_adapters": "true",
    "sagemaker_submit_directory": "s3://${S3_BUCKET}/${S3_PREFIX}/code/",
    "dataset_text_field": "messages"
  },
  "InputDataConfig": [
    {
      "ChannelName": "training",
      "DataSource": {
        "S3DataSource": {
          "S3DataType": "S3Prefix",
          "S3Uri": "s3://${S3_BUCKET}/${S3_PREFIX}/data/",
          "S3DataDistributionType": "FullyReplicated"
        }
      },
      "ContentType": "application/jsonlines"
    }
  ],
  "OutputDataConfig": {
    "S3OutputPath": "s3://${S3_BUCKET}/${S3_PREFIX}/output/"
  },
  "ResourceConfig": {
    "InstanceType": "${INSTANCE_TYPE}",
    "InstanceCount": ${INSTANCE_COUNT},
    "VolumeSizeInGB": 100
  },
  "StoppingCondition": {
    "MaxRuntimeInSeconds": 14400
  }
}
JOBEOF

  # Upload the training script
  aws s3 cp "$SCRIPT_DIR/train_script.py" \
    "s3://${S3_BUCKET}/${S3_PREFIX}/code/train_script.py"

  # Create training job
  aws sagemaker create-training-job \
    --cli-input-json "file:///tmp/lariat-training-job.json" \
    --region "$AWS_REGION"

  log "Training job launched: $JOB_NAME"
  log "Instance: $INSTANCE_TYPE ($1.41/hr)"
  log "Monitor: https://${AWS_REGION}.console.aws.amazon.com/sagemaker/home?region=${AWS_REGION}#/jobs/${JOB_NAME}"
  log ""
  log "Run './deploy.sh status' to check progress"
}

# ── Step 4: Deploy endpoint ───────────────────────────────────────────

cmd_deploy() {
  log "Step 4: Deploying inference endpoint..."
  preflight

  # Find the latest completed training job
  local LATEST_JOB
  LATEST_JOB=$(aws sagemaker list-training-jobs \
    --name-contains "lariat-ka" \
    --status-equals "Completed" \
    --sort-by "CreationTime" \
    --sort-order "Descending" \
    --max-results 1 \
    --query "TrainingJobSummaries[0].TrainingJobName" \
    --output text)

  if [ "$LATEST_JOB" = "None" ] || [ -z "$LATEST_JOB" ]; then
    err "No completed training job found. Run training first."
    exit 1
  fi

  log "Using model from job: $LATEST_JOB"

  # Get model artifact location
  local MODEL_DATA
  MODEL_DATA=$(aws sagemaker describe-training-job \
    --training-job-name "$LATEST_JOB" \
    --query "ModelArtifacts.S3ModelArtifacts" \
    --output text)

  # TGI image for inference
  local TGI_IMAGE="763104351884.dkr.ecr.${AWS_REGION}.amazonaws.com/huggingface-pytorch-tgi-inference:2.4.1-tgi2.4.1-gpu-py311-cu124-ubuntu22.04"

  # Create model
  aws sagemaker create-model \
    --model-name "$MODEL_NAME" \
    --primary-container "{
      \"Image\": \"${TGI_IMAGE}\",
      \"ModelDataUrl\": \"${MODEL_DATA}\",
      \"Environment\": {
        \"HF_MODEL_ID\": \"/opt/ml/model\",
        \"SM_NUM_GPUS\": \"1\",
        \"MAX_INPUT_LENGTH\": \"4096\",
        \"MAX_TOTAL_TOKENS\": \"4608\",
        \"MAX_BATCH_PREFILL_TOKENS\": \"4096\"
      }
    }" \
    --execution-role-arn "$SAGEMAKER_ROLE" \
    --region "$AWS_REGION"

  # Create endpoint config
  aws sagemaker create-endpoint-config \
    --endpoint-config-name "${ENDPOINT_NAME}-config-${TIMESTAMP}" \
    --production-variants "[{
      \"VariantName\": \"primary\",
      \"ModelName\": \"${MODEL_NAME}\",
      \"InstanceType\": \"${ENDPOINT_INSTANCE}\",
      \"InitialInstanceCount\": 1,
      \"InitialVariantWeight\": 1.0
    }]" \
    --region "$AWS_REGION"

  # Create or update endpoint
  if aws sagemaker describe-endpoint --endpoint-name "$ENDPOINT_NAME" &>/dev/null; then
    log "Updating existing endpoint..."
    aws sagemaker update-endpoint \
      --endpoint-name "$ENDPOINT_NAME" \
      --endpoint-config-name "${ENDPOINT_NAME}-config-${TIMESTAMP}" \
      --region "$AWS_REGION"
  else
    aws sagemaker create-endpoint \
      --endpoint-name "$ENDPOINT_NAME" \
      --endpoint-config-name "${ENDPOINT_NAME}-config-${TIMESTAMP}" \
      --region "$AWS_REGION"
  fi

  log "Endpoint deploying: $ENDPOINT_NAME"
  log "Instance: $ENDPOINT_INSTANCE ($1.41/hr while running)"
  log ""
  warn "IMPORTANT: The endpoint costs ~$1.41/hr. Run './deploy.sh teardown' when done testing."
  log "Monitor: https://${AWS_REGION}.console.aws.amazon.com/sagemaker/home?region=${AWS_REGION}#/endpoints/${ENDPOINT_NAME}"
}

# ── Test endpoint ─────────────────────────────────────────────────────

cmd_test() {
  log "Testing endpoint..."

  local STATUS
  STATUS=$(aws sagemaker describe-endpoint \
    --endpoint-name "$ENDPOINT_NAME" \
    --query "EndpointStatus" \
    --output text 2>/dev/null || echo "NOT_FOUND")

  if [ "$STATUS" != "InService" ]; then
    err "Endpoint '$ENDPOINT_NAME' status: $STATUS (need InService)"
    exit 1
  fi

  log "Endpoint is InService. Sending test query..."

  # Test 1: Recipe question
  local PAYLOAD='{"inputs": "What are the ingredients in the brisket rub?", "parameters": {"max_new_tokens": 256, "temperature": 0.2, "top_p": 0.85}}'

  local RESPONSE
  RESPONSE=$(aws sagemaker-runtime invoke-endpoint \
    --endpoint-name "$ENDPOINT_NAME" \
    --content-type "application/json" \
    --body "$PAYLOAD" \
    /tmp/lariat-test-response.json \
    --query "Body" \
    --output text 2>/dev/null)

  log "Response:"
  cat /tmp/lariat-test-response.json
  echo ""

  # Test 2: Action command
  PAYLOAD='{"inputs": "86 the lobster tails", "parameters": {"max_new_tokens": 256, "temperature": 0.2}}'
  aws sagemaker-runtime invoke-endpoint \
    --endpoint-name "$ENDPOINT_NAME" \
    --content-type "application/json" \
    --body "$PAYLOAD" \
    /tmp/lariat-test-response-2.json 2>/dev/null

  log "Action test response:"
  cat /tmp/lariat-test-response-2.json
  echo ""

  # Test 3: Allergen safety
  PAYLOAD='{"inputs": "Does the Caesar salad contain allergens?", "parameters": {"max_new_tokens": 256, "temperature": 0.2}}'
  aws sagemaker-runtime invoke-endpoint \
    --endpoint-name "$ENDPOINT_NAME" \
    --content-type "application/json" \
    --body "$PAYLOAD" \
    /tmp/lariat-test-response-3.json 2>/dev/null

  log "Allergen test response:"
  cat /tmp/lariat-test-response-3.json
  echo ""

  log "Tests complete ✓"
}

# ── Status ────────────────────────────────────────────────────────────

cmd_status() {
  log "Checking status..."

  # Training jobs
  echo ""
  echo "=== Training Jobs ==="
  aws sagemaker list-training-jobs \
    --name-contains "lariat-ka" \
    --max-results 5 \
    --query "TrainingJobSummaries[*].[TrainingJobName,TrainingJobStatus,CreationTime]" \
    --output table 2>/dev/null || echo "  (none found)"

  # Latest job details
  local LATEST
  LATEST=$(aws sagemaker list-training-jobs \
    --name-contains "lariat-ka" \
    --max-results 1 \
    --query "TrainingJobSummaries[0].TrainingJobName" \
    --output text 2>/dev/null || echo "None")

  if [ "$LATEST" != "None" ] && [ -n "$LATEST" ]; then
    echo ""
    echo "=== Latest Job: $LATEST ==="
    aws sagemaker describe-training-job \
      --training-job-name "$LATEST" \
      --query "{Status: TrainingJobStatus, Duration: TrainingTimeInSeconds, BillableTime: BillableTimeInSeconds, Instance: ResourceConfig.InstanceType}" \
      --output table 2>/dev/null
  fi

  # Endpoints
  echo ""
  echo "=== Endpoints ==="
  aws sagemaker list-endpoints \
    --name-contains "lariat" \
    --query "Endpoints[*].[EndpointName,EndpointStatus,CreationTime]" \
    --output table 2>/dev/null || echo "  (none found)"

  # S3 usage
  echo ""
  echo "=== S3 Usage ==="
  aws s3 ls "s3://${S3_BUCKET}/${S3_PREFIX}/" --recursive --summarize --human-readable 2>/dev/null \
    | tail -2 || echo "  (bucket not found)"
}

# ── Cost estimate ─────────────────────────────────────────────────────

cmd_cost() {
  echo ""
  echo "=== Lariat SageMaker Cost Estimate ==="
  echo ""
  echo "TRAINING (ml.g5.xlarge @ \$1.41/hr):"
  echo "  356 samples, 3 epochs, ~2-3 hours           ~\$3-5"
  echo "  Multiple hyperparameter runs (5x)            ~\$15-25"
  echo ""
  echo "INFERENCE ENDPOINT (ml.g5.xlarge @ \$1.41/hr):"
  echo "  Testing (2 hours)                            ~\$3"
  echo "  Extended eval (8 hours)                      ~\$11"
  echo ""
  echo "S3 STORAGE:"
  echo "  Training data + model artifacts              ~\$0.05"
  echo ""
  echo "TOTAL ESTIMATED:"
  echo "  Conservative (1 train + 2hr test)            ~\$8"
  echo "  Moderate (5 trains + 8hr test)               ~\$40"
  echo "  Aggressive (10 trains + 24hr test)           ~\$80"
  echo ""
  echo "Budget: \$150 — plenty of room for experimentation"
  echo ""
  warn "Remember: Run './deploy.sh teardown' to stop the endpoint when done!"
}

# ── Teardown ──────────────────────────────────────────────────────────

cmd_teardown() {
  log "Tearing down endpoint..."

  # Delete endpoint
  if aws sagemaker describe-endpoint --endpoint-name "$ENDPOINT_NAME" &>/dev/null; then
    aws sagemaker delete-endpoint --endpoint-name "$ENDPOINT_NAME"
    log "Deleted endpoint: $ENDPOINT_NAME"
  else
    warn "Endpoint $ENDPOINT_NAME not found"
  fi

  # Delete endpoint configs
  for cfg in $(aws sagemaker list-endpoint-configs \
    --name-contains "lariat-kitchen-assistant-config" \
    --query "EndpointConfigs[*].EndpointConfigName" \
    --output text 2>/dev/null); do
    aws sagemaker delete-endpoint-config --endpoint-config-name "$cfg"
    log "Deleted config: $cfg"
  done

  # Delete models
  for mdl in $(aws sagemaker list-models \
    --name-contains "lariat-ka-model" \
    --query "Models[*].ModelName" \
    --output text 2>/dev/null); do
    aws sagemaker delete-model --model-name "$mdl"
    log "Deleted model: $mdl"
  done

  log "Teardown complete. Endpoint billing stopped."
  warn "S3 data retained at s3://${S3_BUCKET}/${S3_PREFIX}/"
  warn "To delete S3 data: aws s3 rm s3://${S3_BUCKET}/${S3_PREFIX}/ --recursive"
}

# ── Main dispatch ─────────────────────────────────────────────────────

case "${1:-all}" in
  prep)     cmd_prep ;;
  upload)   preflight; cmd_upload ;;
  train)    cmd_train ;;
  deploy)   cmd_deploy ;;
  test)     cmd_test ;;
  status)   preflight; cmd_status ;;
  cost)     cmd_cost ;;
  teardown) cmd_teardown ;;
  all)
    cmd_prep
    cmd_upload
    cmd_train
    log ""
    log "Training job launched. Next steps:"
    log "  1. Run './deploy.sh status' to monitor (takes 2-3 hours)"
    log "  2. When complete: './deploy.sh deploy' to create endpoint"
    log "  3. Test: './deploy.sh test'"
    log "  4. IMPORTANT: './deploy.sh teardown' when done"
    ;;
  *)
    echo "Usage: $0 {prep|upload|train|deploy|test|status|cost|teardown|all}"
    exit 1
    ;;
esac
