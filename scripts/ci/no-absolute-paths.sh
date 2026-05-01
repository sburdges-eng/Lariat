#!/usr/bin/env bash
set -u

MODE="--check"
JSON=0

usage() {
  cat <<'USAGE'
Usage: scripts/ci/no-absolute-paths.sh [--check] [--json] [--help]

Fails when tracked or unignored files contain committed absolute filesystem
paths. Route paths such as /api/inventory are permitted. Interpreter shebangs
are ignored.
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

skip_path() {
  case "$1" in
    .git/*|node_modules/*|build/*|target/*|.venv/*|external/JUCE/*|CMakeFiles/*|dist/*|.next/*)
      return 0
      ;;
  esac
  return 1
}

pattern="(^|[[:space:]\"'=(:])/(Users|Volumes|System|Library|private|usr|var|etc|opt|Applications|tmp)/[^[:space:]\"')};,]+"
violations=0
report=""

while IFS= read -r -d '' file; do
  if skip_path "$file"; then
    continue
  fi

  matches="$(grep -I -H -nE "$pattern" "$file" 2>/dev/null | grep -vE '^[^:]+:1:#!' || true)"
  if [ -n "$matches" ]; then
    violations=$((violations + 1))
    report="${report}${matches}"$'\n'
  fi
done < <(git -c core.fsmonitor=false ls-files -z --cached --others --exclude-standard)

if [ "$violations" -ne 0 ]; then
  if [ "$JSON" -eq 1 ]; then
    printf '{"schemaVersion":"lariat.governance.report.v1","status":"fail","check":"no-absolute-paths","violations":%s}\n' "$violations"
  else
    printf 'BUILD_BLOCKED: absolute filesystem paths found\n'
    printf '%s' "$report"
  fi
  exit 1
fi

if [ "$JSON" -eq 1 ]; then
  printf '{"schemaVersion":"lariat.governance.report.v1","status":"pass","check":"no-absolute-paths","violations":0}\n'
else
  printf 'No committed absolute filesystem paths found.\n'
fi
