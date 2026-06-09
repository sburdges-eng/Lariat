#!/usr/bin/env bash
# scripts/tmux-lariat-analysis.sh
# Recreate the read-only Lariat analysis tmux dashboard.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/tmux-lariat-analysis.sh [session-name] [--attach] [--replace]

Examples:
  scripts/tmux-lariat-analysis.sh
  scripts/tmux-lariat-analysis.sh lariat-analysis --attach
  scripts/tmux-lariat-analysis.sh review-board --replace

Behavior:
  - Creates a tmux session rooted at the current repo
  - Refuses to overwrite an existing session unless --replace is passed
  - With --attach, attaches after creation (or after replacing)
EOF
}

SESSION_NAME="lariat-analysis"
ATTACH=0
REPLACE=0

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    --attach)
      ATTACH=1
      ;;
    --replace)
      REPLACE=1
      ;;
    --*)
      echo "Unknown flag: $arg" >&2
      usage >&2
      exit 1
      ;;
    *)
      SESSION_NAME="$arg"
      ;;
  esac
done

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required but not installed." >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  if [ "$REPLACE" -eq 1 ]; then
    tmux kill-session -t "$SESSION_NAME"
  else
    echo "Session '$SESSION_NAME' already exists. Pass --replace to recreate it." >&2
    if [ "$ATTACH" -eq 1 ]; then
      exec tmux attach -t "$SESSION_NAME"
    fi
    exit 1
  fi
fi

send_cmd() {
  local target="$1"
  local command="$2"
  tmux send-keys -t "$target" C-c
  tmux send-keys -t "$target" "$command" C-m
}

make_watch_loop() {
  local body="$1"
  local sleep_s="$2"
  cat <<EOF
while true; do
  clear
  $body
  sleep $sleep_s
done
EOF
}

OVERVIEW_LEFT=$(cat <<'EOF'
printf 'Lariat overview
===============
'; printf 'cwd: %s

' "$PWD"; git status --short --branch; printf '
Recent root dirs/files:
'; python3 - <<'PY'
import os
items = [n for n in sorted(os.listdir('.')) if not n.startswith('.')]
for n in items[:24]:
    print(n + ('/' if os.path.isdir(n) else ''))
PY
EOF
)

OVERVIEW_RIGHT=$(cat <<'EOF'
printf 'Repo quick counts
=================
'; python3 - <<'PY'
import os
counts = {'app_pages': 0, 'api_routes': 0, 'lib_files': 0, 'tests': 0, 'scripts': 0}
for dp, dn, fn in os.walk('app'):
    dn[:] = [d for d in dn if d not in {'node_modules', '.next', 'dist', 'build'}]
    for f in fn:
        if f in ('page.jsx', 'page.tsx', 'page.js', 'page.ts'):
            counts['app_pages'] += 1
        if f.startswith('route.'):
            counts['api_routes'] += 1
for dp, dn, fn in os.walk('lib'):
    for f in fn:
        if f.endswith(('.js', '.jsx', '.ts', '.tsx', '.mjs', '.py')):
            counts['lib_files'] += 1
for dp, dn, fn in os.walk('tests'):
    for f in fn:
        if f.endswith(('.mjs', '.js', '.jsx', '.ts', '.tsx', '.py')):
            counts['tests'] += 1
for dp, dn, fn in os.walk('scripts'):
    dn[:] = [d for d in dn if d not in {'node_modules', '.next', 'dist', 'build'}]
    for f in fn:
        if f.endswith(('.mjs', '.js', '.py', '.ts', '.sh')):
            counts['scripts'] += 1
for k, v in counts.items():
    print(f'{k:12} {v}')
print('\nStack from package.json: Next 16 / React 19 / Electron wrapper / SQLite')
PY
EOF
)

DOCS_TOP=$(cat <<'EOF'
printf 'Key docs
========
'; printf '%s
' AGENTS.md CLAUDE.md README.md docs/ARCHITECTURE.md docs/OPERATIONS.md docs/SMOKE_TESTS.md docs/FOOD_BEV_AI_LAB.md; printf '
Open with: read_file or your pager of choice
'
EOF
)

DOCS_BOTTOM=$(cat <<'EOF'
printf 'Potential doc drift spotted
==========================
'; printf '%s
' '- README still says Next.js 14, package.json is Next 16.x' '- README framing is smaller than today'
EOF
)

TESTS=$(cat <<'EOF'
printf 'High-signal verification commands
================================
'; printf '%s
' 'npm run typecheck' 'npm run test:rules' 'npm run test:event-ops' 'npm run test:shows' 'npm run test:unit' 'npm run build' 'npm run desktop:build' 'npm run test:sync-status && npm run test:sync-apply' 'npm run eval:assistant-prompt'
EOF
)

ROUTES_LEFT=$(cat <<'EOF'
printf 'App route directories
=====================
'; python3 - <<'PY'
import os
root = 'app'
for name in sorted(os.listdir(root)):
    if name.startswith('.') or name == 'api':
        continue
    p = os.path.join(root, name)
    if os.path.isdir(p):
        print(name + '/')
PY
EOF
)

ROUTES_RIGHT=$(cat <<'EOF'
printf 'API route sample (first 60)
===========================
'; python3 - <<'PY'
import os
items = []
for dp, dn, fn in os.walk('app/api'):
    dn[:] = [d for d in dn if d not in {'node_modules', '.next', 'dist', 'build'}]
    for f in fn:
        if f.startswith('route.'):
            items.append(os.path.relpath(os.path.join(dp, f), 'app/api'))
for rel in sorted(items)[:60]:
    print(rel)
print(f'\nTotal route files: {len(items)}')
PY
EOF
)

SHELL=$(cat <<'EOF'
printf 'Interactive shell ready in %s

' "$PWD"; printf '%s
' 'Suggested next commands:' '  npm run branches:list' '  npm run test:event-ops' '  npm run test:shows' '  npm run typecheck' '  git status --short --branch'
EOF
)

WATCH_GIT=$(make_watch_loop "printf 'GIT STATUS
==========
'; date; printf '
'; git status --short --branch" 8)

WATCH_HOTSPOTS=$(make_watch_loop "printf 'TOP-LEVEL HOTSPOTS
=================
'; date; printf '
'; python3 - <<'PY'
import os
items = []
for name in sorted(os.listdir('.')):
    if name.startswith('.'):
        continue
    try:
        count = len(os.listdir(name)) if os.path.isdir(name) else 1
    except OSError:
        continue
    items.append((name, count))
for name, count in items[:30]:
    print(f'{name:24} entries={count}')
PY" 20)

WATCH_TESTS=$(make_watch_loop "printf 'TEST SURFACE SNAPSHOT
=====================
'; date; printf '
'; python3 - <<'PY'
import os
items = []
for dp, dn, fn in os.walk('tests/js'):
    dn[:] = [d for d in dn if d not in {'node_modules', '.next', 'dist', 'build'}]
    for f in fn:
        if f.endswith('.mjs'):
            items.append(os.path.join(dp, f))
items = sorted(items)
for rel in items[:40]:
    print(rel)
print(f'\nDisplayed: {min(40, len(items))} / Total js rule/api tests: {len(items)}')
PY" 25)

WATCH_RECENT=$(make_watch_loop "printf 'RECENT FILE CHANGES
===================
'; date; printf '
'; python3 - <<'PY'
import os, time
SKIP_DIRS = {'.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.turbo', '.agent-sessions'}
SKIP_FILES = {'.DS_Store'}
rows = []
for dp, dn, fn in os.walk('.'):
    dn[:] = [d for d in dn if d not in SKIP_DIRS]
    for f in fn:
        if f in SKIP_FILES:
            continue
        p = os.path.join(dp, f)
        try:
            rows.append((os.path.getmtime(p), p))
        except OSError:
            pass
for ts, path in sorted(rows, reverse=True)[:20]:
    print(time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(ts)) + '  ' + path)
PY" 15)

OPS_LEFT=$(cat <<'EOF'
printf 'Suggested analysis commands
===========================
'; printf '%s
' 'npm run branches:list' 'npm run typecheck' 'npm run test:event-ops' 'npm run test:shows' 'npm run test:rules' 'npm run build' 'npm run desktop:build' 'npm run sync:status:json' 'npm run eval:assistant-prompt'
EOF
)

OPS_RIGHT=$(cat <<'EOF'
printf 'Subsystem probes
================
'; printf '%s
' 'app/api                     route surface' 'lib/                        business logic + persistence' 'scripts/                    ingest/export/platform jobs' 'tests/js                    high-signal contracts' 'desktop/                    electron wrapper' 'training/                   eval/data generation' 'Lariat-KDS/                 sibling project' 'cad-kernel/                 fenced future lane'
EOF
)

HANDOFF_TOP="if [ -f .agent-sessions/handoff.md ]; then echo 'Tailing .agent-sessions/handoff.md'; tail -n 40 -f .agent-sessions/handoff.md; else echo '.agent-sessions/handoff.md not present'; fi"

HANDOFF_BOTTOM=$(make_watch_loop "if [ -f ORCHESTRATOR_STATUS.md ]; then printf 'ORCHESTRATOR_STATUS.md
======================
'; date; printf '
'; tail -n 80 ORCHESTRATOR_STATUS.md; else echo 'ORCHESTRATOR_STATUS.md not present'; fi" 20)

# Create session + windows.
tmux new-session -d -s "$SESSION_NAME" -c "$REPO_ROOT" -n overview
tmux split-window -h -t "$SESSION_NAME":overview -c "$REPO_ROOT"
tmux new-window -t "$SESSION_NAME" -n docs -c "$REPO_ROOT"
tmux split-window -v -t "$SESSION_NAME":docs -c "$REPO_ROOT"
tmux new-window -t "$SESSION_NAME" -n tests -c "$REPO_ROOT"
tmux new-window -t "$SESSION_NAME" -n routes -c "$REPO_ROOT"
tmux split-window -h -t "$SESSION_NAME":routes -c "$REPO_ROOT"
tmux new-window -t "$SESSION_NAME" -n shell -c "$REPO_ROOT"
tmux new-window -t "$SESSION_NAME" -n watch -c "$REPO_ROOT"
tmux split-window -h -t "$SESSION_NAME":watch -c "$REPO_ROOT"
tmux split-window -v -t "$SESSION_NAME":watch.0 -c "$REPO_ROOT"
tmux split-window -v -t "$SESSION_NAME":watch.1 -c "$REPO_ROOT"
tmux new-window -t "$SESSION_NAME" -n ops -c "$REPO_ROOT"
tmux split-window -h -t "$SESSION_NAME":ops -c "$REPO_ROOT"
tmux new-window -t "$SESSION_NAME" -n handoff -c "$REPO_ROOT"
tmux split-window -v -t "$SESSION_NAME":handoff -c "$REPO_ROOT"

# Populate panes.
send_cmd "$SESSION_NAME":overview.0 "$OVERVIEW_LEFT"
send_cmd "$SESSION_NAME":overview.1 "$OVERVIEW_RIGHT"
send_cmd "$SESSION_NAME":docs.0 "$DOCS_TOP"
send_cmd "$SESSION_NAME":docs.1 "$DOCS_BOTTOM"
send_cmd "$SESSION_NAME":tests.0 "$TESTS"
send_cmd "$SESSION_NAME":routes.0 "$ROUTES_LEFT"
send_cmd "$SESSION_NAME":routes.1 "$ROUTES_RIGHT"
send_cmd "$SESSION_NAME":shell.0 "$SHELL"
send_cmd "$SESSION_NAME":watch.0 "$WATCH_GIT"
send_cmd "$SESSION_NAME":watch.1 "$WATCH_HOTSPOTS"
send_cmd "$SESSION_NAME":watch.2 "$WATCH_TESTS"
send_cmd "$SESSION_NAME":watch.3 "$WATCH_RECENT"
send_cmd "$SESSION_NAME":ops.0 "$OPS_LEFT"
send_cmd "$SESSION_NAME":ops.1 "$OPS_RIGHT"
send_cmd "$SESSION_NAME":handoff.0 "$HANDOFF_TOP"
send_cmd "$SESSION_NAME":handoff.1 "$HANDOFF_BOTTOM"

tmux select-window -t "$SESSION_NAME":watch

if [ "$ATTACH" -eq 1 ]; then
  exec tmux attach -t "$SESSION_NAME"
fi

echo "Created tmux session '$SESSION_NAME' at $REPO_ROOT"
echo "Attach with: tmux attach -t $SESSION_NAME"