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
# REPO_ROOT is always absolute. Derive WORKTREES_PARENT as a sibling so
# linked worktrees land at ../Lariat-worktrees/, never nested under the
# main checkout. (`git rev-parse --git-common-dir` returns ".git" from
# the main checkout — a relative path — which previously caused
# WORKTREES_PARENT to resolve to "./Lariat-worktrees" inside the repo.)
WORKTREES_PARENT="$(dirname "$REPO_ROOT")/Lariat-worktrees"

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

        # Share node_modules from the main checkout so `npm run typecheck`,
        # `npm test`, and the pre-commit hook find their binaries without a
        # second `npm install`. Linked worktrees don't get one for free.
        if [ ! -e "$wt_path/node_modules" ] && [ -d "$REPO_ROOT/node_modules" ]; then
            ln -s "$REPO_ROOT/node_modules" "$wt_path/node_modules"
        fi

        echo
        echo "✓ worktree ready"
        echo "  path:   $wt_path"
        echo "  branch: $branch (locked via SESSION_BRANCH)"
        echo "  base:   $(git -C "$wt_path" log -1 --format='%h %s')"
        echo "  deps:   node_modules linked from $REPO_ROOT"
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
