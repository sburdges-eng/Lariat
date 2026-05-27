#!/usr/bin/env bash
# scripts/branches.sh — list, sort, and prune feature branches.
#
# Branch naming (binding — see AGENTS.md "Multi-session protocol"):
#   feat/<short-name>   — new feature
#   fix/<short-name>    — bug fix
#   chore/<short-name>  — tooling, deps, gitignore, docs
#   wip/<short-name>    — scratch / about to be deleted
#
# Usage:
#   scripts/branches.sh list [prefix]    # newest-first; default: all four prefixes
#   scripts/branches.sh stale [days]     # branches inactive N+ days (default 30)
#   scripts/branches.sh merged           # branches already merged into main
#   scripts/branches.sh prune-merged     # delete merged-into-main branches (asks)

set -euo pipefail

cmd="${1:-list}"

case "$cmd" in
    list)
        prefix="${2:-}"
        if [ -n "$prefix" ]; then
            git for-each-ref --sort=-committerdate \
                --format='%(committerdate:short)  %(refname:short)' \
                "refs/heads/${prefix}*"
        else
            git for-each-ref --sort=-committerdate \
                --format='%(committerdate:short)  %(refname:short)' \
                refs/heads/feat refs/heads/fix refs/heads/chore refs/heads/wip
        fi
        ;;

    stale)
        days="${2:-30}"
        # macOS BSD date vs GNU date — try both.
        if cutoff=$(date -v-"${days}"d +%s 2>/dev/null); then :
        else cutoff=$(date -d "${days} days ago" +%s); fi
        git for-each-ref --format='%(committerdate:unix) %(refname:short)' refs/heads/ \
            | awk -v c="$cutoff" '$1 < c {print strftime("%Y-%m-%d", $1), $2}' \
            | sort
        ;;

    merged)
        git branch --merged main --format='%(refname:short)' | grep -v '^main$' || true
        ;;

    prune-merged)
        merged="$(git branch --merged main --format='%(refname:short)' | grep -v '^main$' || true)"
        if [ -z "$merged" ]; then
            echo "no merged branches to prune"
            exit 0
        fi
        echo "the following branches are merged into main:"
        echo "$merged" | sed 's/^/  /'
        printf "delete? [y/N] "
        read -r answer
        if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
            echo "$merged" | xargs -n1 git branch -d
        else
            echo "aborted"
        fi
        ;;

    help|--help|-h|*)
        sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
        ;;
esac
