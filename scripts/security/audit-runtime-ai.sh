#!/usr/bin/env bash
set -u

MODE="--check"
JSON=0

usage() {
  cat <<'USAGE'
Usage: scripts/security/audit-runtime-ai.sh [--check] [--json] [--help]

Scans runtime source paths for cloud AI/API coupling. Local Ollama references
are permitted; cloud vendor endpoints, SDKs, and API-key environment names are
blocked in runtime code.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --check)
      MODE="--check"
      ;;
    --json)
      JSON=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$repo_root" ]; then
  printf 'BUILD_BLOCKED: not inside a git project checkout\n' >&2
  exit 2
fi

cd "$repo_root" || exit 2

is_runtime_path() {
  case "$1" in
    app/*|lib/*|components/*|src/*|middleware.js|next.config.*|package.json)
      return 0
      ;;
  esac
  return 1
}

pattern='api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.cohere\.ai|api\.mistral\.ai|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|COHERE_API_KEY|MISTRAL_API_KEY|@anthropic-ai/sdk|@google/generative-ai|cohere-ai|mistralai|(^|[^[:alnum:]_])openai([^[:alnum:]_]|$)'

violations=0
report=""

while IFS= read -r -d '' file; do
  if ! is_runtime_path "$file"; then
    continue
  fi

  matches="$(grep -I -H -nE "$pattern" "$file" 2>/dev/null || true)"
  if [ -n "$matches" ]; then
    violations=$((violations + 1))
    report="${report}${matches}"$'\n'
  fi
done < <(git -c core.fsmonitor=false ls-files -z --cached --others --exclude-standard)

if [ "$violations" -ne 0 ]; then
  if [ "$JSON" -eq 1 ]; then
    printf '{"schemaVersion":"lariat.governance.report.v1","status":"fail","check":"runtime-ai","violations":%s}\n' "$violations"
  else
    printf 'BUILD_BLOCKED: cloud AI runtime coupling found\n'
    printf '%s' "$report"
  fi
  exit 1
fi

if [ "$JSON" -eq 1 ]; then
  printf '{"schemaVersion":"lariat.governance.report.v1","status":"pass","check":"runtime-ai","violations":0}\n'
else
  printf 'Runtime AI coupling audit OK.\n'
fi
