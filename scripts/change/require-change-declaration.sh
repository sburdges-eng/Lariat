#!/usr/bin/env bash
set -u

MODE="--check"
JSON=0
DECLARATION_FILE=""

usage() {
  cat <<'USAGE'
Usage: scripts/change/require-change-declaration.sh [--check] [--json] [file]

Requires a change declaration containing:
  Affected subsystem:
  Freeze-readiness impact:
  Determinism impact:
  Security impact:
  Runtime coupling introduced: YES|NO

If no file argument is provided, CHANGE_DECLARATION_FILE is used. If that is
unset, CHANGE_DECLARATION.md is used when present.
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
      if [ -n "$DECLARATION_FILE" ]; then
        printf 'Unexpected argument: %s\n' "$1" >&2
        usage >&2
        exit 2
      fi
      DECLARATION_FILE="$1"
      ;;
  esac
  shift
done

if [ -z "$DECLARATION_FILE" ] && [ -n "${CHANGE_DECLARATION_FILE:-}" ]; then
  DECLARATION_FILE="$CHANGE_DECLARATION_FILE"
fi

if [ -z "$DECLARATION_FILE" ] && [ -f "CHANGE_DECLARATION.md" ]; then
  DECLARATION_FILE="CHANGE_DECLARATION.md"
fi

if [ -z "$DECLARATION_FILE" ]; then
  if [ "$JSON" -eq 1 ]; then
    printf '{"schemaVersion":"lariat.governance.report.v1","status":"fail","check":"change-declaration","missing":"declaration-file"}\n'
  fi
  printf 'BUILD_BLOCKED: no change declaration file provided\n' >&2
  exit 1
fi

if [ ! -f "$DECLARATION_FILE" ]; then
  if [ "$JSON" -eq 1 ]; then
    printf '{"schemaVersion":"lariat.governance.report.v1","status":"fail","check":"change-declaration","missing":"declaration-file"}\n'
  fi
  printf 'BUILD_BLOCKED: change declaration file not found: %s\n' "$DECLARATION_FILE" >&2
  exit 1
fi

missing=""

require_field() {
  label="$1"
  if ! grep -Eq "^${label}:[[:space:]]*[^[:space:]].*" "$DECLARATION_FILE"; then
    missing="${missing}${label}"$'\n'
  fi
}

require_field "Affected subsystem"
require_field "Freeze-readiness impact"
require_field "Determinism impact"
require_field "Security impact"

if ! grep -Eq "^Runtime coupling introduced:[[:space:]]*(YES|NO)[[:space:]]*$" "$DECLARATION_FILE"; then
  missing="${missing}Runtime coupling introduced"$'\n'
fi

if [ -n "$missing" ]; then
  if [ "$JSON" -eq 1 ]; then
    count="$(printf '%s' "$missing" | awk 'NF { count += 1 } END { print count + 0 }')"
    printf '{"schemaVersion":"lariat.governance.report.v1","status":"fail","check":"change-declaration","missing":%s}\n' "$count"
  else
    printf 'BUILD_BLOCKED: change declaration is missing required fields\n'
    printf '%s' "$missing"
  fi
  exit 1
fi

if [ "$JSON" -eq 1 ]; then
  printf '{"schemaVersion":"lariat.governance.report.v1","status":"pass","check":"change-declaration","missing":0}\n'
else
  printf 'Change declaration OK: %s\n' "$DECLARATION_FILE"
fi
