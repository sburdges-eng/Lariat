#!/usr/bin/env bash
# Idempotent toolchain bootstrap for running Lariat gates on a bare machine.
# Installs what it can non-interactively (via Homebrew) and FAILS LOUDLY with
# a list of every step that needs interactive input, instead of silently
# continuing. Safe to re-run; exits 0 only when the toolchain is complete.
# Homebrew is only required when something is actually missing.
set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAILED=""
INTERACTIVE=""

have() { command -v "$1" >/dev/null 2>&1; }

# brew is often off PATH in non-interactive shells; look in the standard spots.
BREW=""
for b in brew /opt/homebrew/bin/brew /usr/local/bin/brew; do
  if command -v "$b" >/dev/null 2>&1; then BREW="$b"; break; fi
done

install_missing() { # $1 = command to check, $2 = brew formula
  have "$1" && return 0
  if [ -z "$BREW" ]; then
    INTERACTIVE="$INTERACTIVE\n  install Homebrew, then: brew install $2"
    return 1
  fi
  "$BREW" install "$2" || FAILED="$FAILED $2"
}

install_missing gh gh
install_missing rg ripgrep
install_missing jq jq

# Python: the gate runs tests via the repo venv (.venv/bin/python), not a
# PATH python3.13 — check and provision the venv, not the system python.
VENV_PY="$REPO_ROOT/.venv/bin/python"
if [ -x "$VENV_PY" ]; then
  PYV=$("$VENV_PY" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo none)
  case "$PYV" in
    3.13 | 3.1[4-9]) : ;;
    *) echo "WARNING: .venv python is $PYV; expected 3.13+ — recreate with python3.13 -m venv .venv" ;;
  esac
else
  if ! have python3.13 && [ -n "$BREW" ]; then
    "$BREW" install python@3.13 || FAILED="$FAILED python@3.13"
  fi
  if have python3.13; then
    (cd "$REPO_ROOT" \
      && python3.13 -m venv .venv \
      && .venv/bin/pip install -q -r requirements-dev.txt -r requirements-tools.txt) \
      || FAILED="$FAILED venv"
  else
    INTERACTIVE="$INTERACTIVE\n  install Homebrew, then: brew install python@3.13 && python3.13 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt -r requirements-tools.txt"
  fi
fi

# Node: the repo pins 24 (.nvmrc). Do NOT brew-install node — it conflicts
# with nvm and with the better-sqlite3 binding (CLAUDE.md §2). verify.sh
# forces node@24 through npx regardless of the shell's node.
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)
if [ "$NODE_MAJOR" = "none" ]; then
  INTERACTIVE="$INTERACTIVE\n  nvm install 24    # or install nvm first: https://github.com/nvm-sh/nvm"
elif [ "$NODE_MAJOR" != "24" ]; then
  echo "WARNING: shell node is v$NODE_MAJOR; repo pins 24. scripts/verify.sh handles this via npx node@24."
fi

if [ ! -d "$REPO_ROOT/node_modules" ]; then
  if have npm; then
    (cd "$REPO_ROOT" && npm ci) || FAILED="$FAILED npm-ci"
  else
    FAILED="$FAILED npm-ci(no-npm)"
  fi
fi

if have gh && ! gh auth status >/dev/null 2>&1; then
  INTERACTIVE="$INTERACTIVE\n  gh auth login    # interactive-only; agents must hand this back to you"
fi

STATUS=0
if [ -n "$FAILED" ]; then
  echo "FAILED installs:$FAILED" >&2
  STATUS=1
fi
if [ -n "$INTERACTIVE" ]; then
  printf "INTERACTIVE STEPS REQUIRED (run these yourself):%b\n" "$INTERACTIVE" >&2
  STATUS=1
fi
if [ "$STATUS" = 0 ]; then
  echo "bootstrap OK: gh, rg, jq, .venv python 3.13, node_modules present, gh authenticated"
fi
exit "$STATUS"
