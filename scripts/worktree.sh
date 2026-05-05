#!/usr/bin/env bash
# scripts/worktree.sh — per-session git worktree helper.
#
# Why: multiple AI sessions (Claude, Cursor, Codex, Gemini) often run
# against this repo at once. They share `.git/` but trample each other's
# HEAD if they all use the same checkout. One worktree per session
# isolates the cutting board.
#
# Usage:
#   scripts/worktree.sh new <tool> <branch> [start-point]
#   scripts/worktree.sh list
#   scripts/worktree.sh remove <tool>-<branch-slug>
#   scripts/worktree.sh lock <branch>            # in current worktree
#   scripts/worktree.sh unlock
#
# Tool names: claude | cursor | codex | gemini | sean
#
# Examples:
#   scripts/worktree.sh new claude feat/price-shocks
#   scripts/worktree.sh new cursor fix/login-bug
#   scripts/worktree.sh new gemini chore/cleanup origin/main
#
# Worktrees live at ../Lariat-worktrees/<tool>-<branch-slug>/.
# Each gets a SESSION_BRANCH file in its git-dir; the pre-commit guard
# (scripts/check-session-branch.mjs) refuses commits if HEAD drifts.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

# MAIN_CHECKOUT is the original (unlinked) checkout — `git worktree list
# --porcelain` always lists it first. We need this independent of CWD so
# the script works whether the operator runs it from main or from a
# linked worktree. (Pre-fix: $REPO_ROOT inside a worktree pointed at
# the worktree itself, so dirname produced .../Lariat-worktrees/, which
# made WORKTREES_PARENT resolve to .../Lariat-worktrees/Lariat-worktrees/
# and nested every new worktree under that bogus dir. Same root cause
# also broke the node_modules / .venv symlinks.)
MAIN_CHECKOUT="$(git worktree list --porcelain | awk 'NR==1 && $1=="worktree" {print $2; exit}')"
if [ -z "$MAIN_CHECKOUT" ]; then
    echo "✗ couldn't determine main checkout from git worktree list" >&2
    exit 1
fi

# Derive WORKTREES_PARENT as a sibling of MAIN_CHECKOUT so linked
# worktrees always land at ../Lariat-worktrees/, regardless of CWD.
WORKTREES_PARENT="$(dirname "$MAIN_CHECKOUT")/Lariat-worktrees"

valid_tool() {
    case "$1" in
        claude|cursor|codex|gemini|sean) return 0 ;;
        *) return 1 ;;
    esac
}

slugify_branch() {
    # feat/price-shocks → price-shocks ;  fix/foo-bar → foo-bar
    # Strips the leading prefix-with-slash and replaces remaining slashes.
    # `#` chosen as sed delimiter so `|` in the alternation parses cleanly on BSD sed.
    echo "$1" | sed -E 's#^(feat|fix|chore|wip)/##' | tr '/' '-' | tr -cd 'a-zA-Z0-9-'
}

cmd="${1:-help}"

case "$cmd" in
    new)
        tool="${2:-}"
        branch="${3:-}"
        start_point="${4:-}"
        if [ -z "$tool" ] || [ -z "$branch" ]; then
            echo "usage: $0 new <tool> <branch> [start-point]" >&2
            echo "       tool: claude | cursor | codex | gemini | sean" >&2
            exit 1
        fi
        if ! valid_tool "$tool"; then
            echo "✗ unknown tool '$tool' — must be claude|cursor|codex|gemini|sean" >&2
            exit 1
        fi

        slug="$(slugify_branch "$branch")"
        wt_path="$WORKTREES_PARENT/$tool-$slug"

        if [ -e "$wt_path" ]; then
            echo "✗ $wt_path already exists" >&2
            exit 1
        fi

        mkdir -p "$WORKTREES_PARENT"

        if git rev-parse --verify --quiet "$branch" >/dev/null; then
            git worktree add "$wt_path" "$branch"
        else
            sp="${start_point:-origin/main}"
            git worktree add "$wt_path" -b "$branch" "$sp"
        fi

        # Lock the worktree to its branch so the pre-commit guard catches drift.
        wt_git_dir="$(git -C "$wt_path" rev-parse --git-dir)"
        echo "$branch" > "$wt_git_dir/SESSION_BRANCH"

        # Share node_modules from the MAIN checkout so `npm run typecheck`,
        # `npm test`, and the pre-commit hook find their binaries without a
        # second `npm install`. Linked worktrees don't get one for free.
        if [ ! -e "$wt_path/node_modules" ] && [ -d "$MAIN_CHECKOUT/node_modules" ]; then
            ln -s "$MAIN_CHECKOUT/node_modules" "$wt_path/node_modules"
        fi

        # Same trick for the Python test venv — tests/js/_helpers/python-preflight.mjs
        # hard-fails any test-shows-* / test-temp-log-api / test-clientFetch run
        # if .venv/bin/python3 isn't present in the worktree. Symlinking the
        # MAIN checkout's venv is much faster than re-running install-python-deps.sh
        # in every fresh worktree (~30s saved per worktree).
        if [ ! -e "$wt_path/.venv" ] && [ -d "$MAIN_CHECKOUT/.venv" ]; then
            ln -s "$MAIN_CHECKOUT/.venv" "$wt_path/.venv"
            venv_note="  pyenv: .venv linked from $MAIN_CHECKOUT"
        else
            venv_note="  pyenv: NOT linked (run \`bash scripts/install-python-deps.sh\` in main checkout first)"
        fi

        echo
        echo "✓ worktree ready"
        echo "  path:   $wt_path"
        echo "  branch: $branch (locked via SESSION_BRANCH)"
        echo "  base:   $(git -C "$wt_path" log -1 --format='%h %s')"
        echo "  deps:   node_modules linked from $MAIN_CHECKOUT"
        echo "$venv_note"
        echo
        echo "  cd $wt_path"
        ;;

    list)
        git worktree list
        ;;

    remove)
        target="${2:-}"
        if [ -z "$target" ]; then
            echo "usage: $0 remove <tool>-<branch-slug>" >&2
            exit 1
        fi
        wt_path="$WORKTREES_PARENT/$target"
        if [ ! -d "$wt_path" ]; then
            echo "✗ no worktree at $wt_path" >&2
            exit 1
        fi
        git worktree remove "$wt_path"
        echo "✓ removed $wt_path"
        ;;

    lock)
        branch="${2:-}"
        if [ -z "$branch" ]; then
            echo "usage: $0 lock <branch>" >&2
            exit 1
        fi
        current="$(git symbolic-ref --short HEAD 2>/dev/null || echo '')"
        if [ "$branch" != "$current" ]; then
            echo "✗ HEAD is on '$current', refusing to lock to '$branch'" >&2
            echo "  switch first:  git switch $branch" >&2
            exit 1
        fi
        echo "$branch" > "$(git rev-parse --git-dir)/SESSION_BRANCH"
        echo "✓ locked this worktree to $branch"
        ;;

    unlock)
        f="$(git rev-parse --git-dir)/SESSION_BRANCH"
        if [ -f "$f" ]; then
            rm "$f"
            echo "✓ unlocked"
        else
            echo "no lock to remove"
        fi
        ;;

    help|--help|-h|*)
        sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
        ;;
esac
