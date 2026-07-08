#!/usr/bin/env bash
# Dev-only: print Native 0.2 L1 oracle + gate summary for STATUS doc refresh.
# Usage: scripts/dev/native_0_2_status.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "# Native 0.2 L1 status refresh — $(date -u +%Y-%m-%dT%H:%MZ)"
echo ""
echo "## Oracle runs"
echo ""

echo "### Python"
if python3 -m unittest tests.python.test_bom_expand tests.python.test_beo_pull tests.python.test_beo_cascade_cli -v 2>&1 | tail -5 | sed 's/^/    /'; then
  :
else
  echo "    (python oracle failed)"
fi
echo ""

echo "### JavaScript recipe calculator"
if node --experimental-strip-types --test tests/js/test-recipe-calculator.mjs 2>&1 | tail -3 | sed 's/^/    /'; then
  :
fi
echo ""

echo "### Swift (full — may take ~20s)"
if (cd LariatNative && swift test 2>&1 | tail -4) | sed 's/^/    /'; then
  :
fi
echo ""

FIXTURE_DIR="$ROOT/LariatNative/Tests/Fixtures/BomExpand"
BEO_DIR="$ROOT/LariatNative/Tests/Fixtures/BeoCascade"
if [[ -d "$FIXTURE_DIR" ]]; then
  COUNT=$(find "$FIXTURE_DIR" -name '*.json' | wc -l | tr -d ' ')
  echo "## Fixtures: $COUNT BomExpand + $(find "$BEO_DIR" -name '*.json' 2>/dev/null | wc -l | tr -d ' ') BeoCascade JSON"
else
  echo "## Fixtures: BomExpand/ missing"
fi
echo ""

echo "## Branch: $(git branch --show-current 2>/dev/null || echo unknown)"
echo "## HEAD: $(git log -1 --oneline 2>/dev/null || echo unknown)"
echo ""
echo "Taxonomy: docs/NATIVE_RELEASES_AND_TAXONOMY.md"
echo "Paste into: docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md"
