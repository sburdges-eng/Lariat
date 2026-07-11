#!/usr/bin/env bash
# One-time GCP setup for the KA v2 sweep. Idempotent.
# AUTHORIZED SPEND: $200 (owner-approved 2026-07-09, "use it all" target).
set -euo pipefail
PROJECT=devvy-490312
BILLING=01A733-66BAB6-4297C6
BUCKET=lariat-train-us-central1
REGION=us-central1

echo "== linking billing =="
gcloud billing projects link "$PROJECT" --billing-account="$BILLING"

echo "== enabling APIs =="
gcloud services enable aiplatform.googleapis.com storage.googleapis.com \
  billingbudgets.googleapis.com --project "$PROJECT" --quiet

echo "== bucket =="
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" \
    --location="$REGION" --uniform-bucket-level-access

echo "== budget (\$200, alerts 50/75/90/100%) =="
if ! gcloud billing budgets list --billing-account="$BILLING" \
    --format="value(displayName)" 2>/dev/null | grep -q '^lariat-ka-v2$'; then
  gcloud billing budgets create --billing-account="$BILLING" \
    --display-name=lariat-ka-v2 \
    --budget-amount=200USD \
    --filter-projects="projects/$PROJECT" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.75 \
    --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
    || echo "WARN: budget creation failed (permissions?) — the launcher's projection guard is the hard stop"
fi
echo "SETUP OK"
