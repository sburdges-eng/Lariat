#!/usr/bin/env bash
set -u

MODE="--check"
JSON=0

usage() {
  cat <<'USAGE'
Usage: scripts/check.sh [--check] [--json] [--help]

Runs Lariat governance preflight checks from the repository root.

Environment:
  CHANGE_DECLARATION_FILE  Path to the change declaration markdown file.

Checks:
  scripts/dev/assert-project-root.sh
  scripts/ci/no-absolute-paths.sh
  scripts/ci/no-cache-artifacts.sh
  scripts/schema/check-json-order.py
  scripts/security/audit-runtime-ai.sh
  scripts/change/require-change-declaration.sh
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

failures=0

run_check() {
  label="$1"
  shift
  if [ "$JSON" -eq 1 ]; then
    printf '==> %s\n' "$label" >&2
  else
    printf '==> %s\n' "$label"
  fi
  "$@"
  status=$?
  if [ "$status" -ne 0 ]; then
    failures=$((failures + 1))
    printf 'BUILD_BLOCKED: %s failed with exit code %s\n' "$label" "$status" >&2
  fi
}

json_arg=""
if [ "$JSON" -eq 1 ]; then
  json_arg="--json"
fi

run_check "project root" bash scripts/dev/assert-project-root.sh "$MODE" $json_arg
run_check "absolute path audit" bash scripts/ci/no-absolute-paths.sh "$MODE" $json_arg
run_check "cache artifact audit" bash scripts/ci/no-cache-artifacts.sh "$MODE" $json_arg
run_check "canonical JSON order" python3 scripts/schema/check-json-order.py "$MODE" $json_arg
run_check "runtime AI coupling audit" bash scripts/security/audit-runtime-ai.sh "$MODE" $json_arg
run_check "change declaration" bash scripts/change/require-change-declaration.sh "$MODE" $json_arg

if [ "$failures" -ne 0 ]; then
  printf 'BUILD_BLOCKED: %s governance check(s) failed\n' "$failures" >&2
  if [ "$JSON" -eq 1 ]; then
    printf '{"schemaVersion":"lariat.governance.report.v1","status":"fail","check":"preflight","failures":%s}\n' "$failures"
  fi
  exit 1
fi

if [ "$JSON" -eq 1 ]; then
  printf '{"schemaVersion":"lariat.governance.report.v1","status":"pass","check":"preflight","failures":0}\n'
else
  printf 'Governance preflight passed.\n'
fi
