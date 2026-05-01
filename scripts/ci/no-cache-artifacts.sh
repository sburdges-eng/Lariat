#!/usr/bin/env bash
set -u

MODE="--check"
JSON=0

usage() {
  cat <<'USAGE'
Usage: scripts/ci/no-cache-artifacts.sh [--check] [--json] [--help]

Fails when tracked or unignored files include cache/build artifacts that should
never enter source control.
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

is_artifact() {
  case "$1" in
    *__pycache__*|*.pyc|*.pyo|.pytest_cache/*|.mypy_cache/*|.ruff_cache/*|.DS_Store|*.tsbuildinfo|.next/*|dist/*|build/*|target/*)
      return 0
      ;;
  esac
  return 1
}

violations=0
report=""

while IFS= read -r -d '' file; do
  if is_artifact "$file"; then
    violations=$((violations + 1))
    report="${report}${file}"$'\n'
  fi
done < <(git -c core.fsmonitor=false ls-files -z --cached --others --exclude-standard)

if [ "$violations" -ne 0 ]; then
  if [ "$JSON" -eq 1 ]; then
    printf '{"schemaVersion":"lariat.governance.report.v1","status":"fail","check":"no-cache-artifacts","violations":%s}\n' "$violations"
  else
    printf 'BUILD_BLOCKED: cache/build artifacts found\n'
    printf '%s' "$report"
  fi
  exit 1
fi

if [ "$JSON" -eq 1 ]; then
  printf '{"schemaVersion":"lariat.governance.report.v1","status":"pass","check":"no-cache-artifacts","violations":0}\n'
else
  printf 'No cache/build artifacts found.\n'
fi
