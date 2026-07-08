#!/usr/bin/env bash
# Grep audit: deprecated "Phase III" / "P3-1" in docs outside allowlist.
# Usage: scripts/dev/check-native-taxonomy.sh [--warn]
# Exit 1 on violations unless --warn (then exit 0 with stderr report).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

WARN_ONLY=false
if [[ "${1:-}" == "--warn" ]]; then
  WARN_ONLY=true
fi

violations=0
report() {
  echo "$1"
  violations=$((violations + 1))
}

is_allowed_line() {
  local file="$1"
  local content="$2"

  # SSOT defines deprecated terms
  [[ "$file" == *NATIVE_RELEASES_AND_TAXONOMY.md ]] && return 0
  # Redirect stubs
  if [[ -f "$file" ]] && [[ $(wc -l < "$file" | tr -d ' ') -le 3 ]]; then
    return 0
  fi
  # Explicit disambiguation / negation
  echo "$content" | grep -qE 'not.*Phase III|formerly.*Phase III|not the P3-1|not "Phase III"' && return 0
  return 1
}

echo "=== Native taxonomy audit ==="
echo ""

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  file="${line%%:*}"
  rest="${line#*:}"
  content="${rest#*:}" # drop line number

  if is_allowed_line "$file" "$content"; then
    continue
  fi
  report "DEPRECATED TERM: $line"
done < <(rg -n '\bPhase III\b|\bP3-1\b' docs/ \
  --glob '!LariatNative-chat-upload/**' \
  --glob '!worktrees/**' 2>/dev/null || true)

echo ""
echo "=== Ambiguous Wave C in L1 plans (expect L1 Wave C prefix) ==="
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  rest="${line#*:}"
  content="${rest#*:}"
  echo "$content" | grep -q 'L1 Wave C' && continue
  if echo "$content" | grep -qE '(^|[^L1 ])Wave C|## .*Wave C'; then
    report "AMBIGUOUS: $line"
  fi
done < <(rg -n 'Wave C' docs/superpowers/plans/2026-07-07-lariat-native-phase-iii-wave-*.md \
  docs/superpowers/specs/2026-07-07-phase-iii-*.md 2>/dev/null || true)

echo ""
if [[ $violations -eq 0 ]]; then
  echo "OK — no taxonomy violations outside allowlist."
  exit 0
fi

echo "Found $violations issue(s). See docs/NATIVE_RELEASES_AND_TAXONOMY.md for canonical terms."
if $WARN_ONLY; then
  exit 0
fi
exit 1
