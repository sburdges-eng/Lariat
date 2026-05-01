#!/usr/bin/env bash
set -u

MODE="--check"
JSON=0

usage() {
  cat <<'USAGE'
Usage: scripts/dev/assert-project-root.sh [--check] [--json] [--help]

Verifies the current directory is within a concrete project checkout, not the
shared Dev workspace root.
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
  printf 'CONTAINMENT_VIOLATION: not inside a git project checkout\n' >&2
  exit 2
fi

repo_name="$(basename "$repo_root")"
if [ "$repo_name" = "Dev" ]; then
  printf 'CONTAINMENT_VIOLATION: refusing shared workspace root; open a project checkout\n' >&2
  exit 3
fi

if [ ! -f "$repo_root/AGENTS.md" ] && [ ! -f "$repo_root/CLAUDE.md" ]; then
  printf 'CONTAINMENT_VIOLATION: project checkout lacks AGENTS.md or CLAUDE.md\n' >&2
  exit 3
fi

if [ "$JSON" -eq 1 ]; then
  printf '{"schemaVersion":"lariat.governance.report.v1","status":"pass","check":"project-root","repo":"%s"}\n' "$repo_name"
else
  printf 'Project checkout OK: %s\n' "$repo_name"
fi

exit 0
