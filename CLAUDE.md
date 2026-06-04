# CLAUDE.md — Lariat

Claude Code guidance for the Lariat restaurant F&B operations platform. See `AGENTS.md` for the
shared multi-tool ruleset (worktrees, MACP, trio orchestration) and `docs/` for architecture.

## Git Workflow

- Never push directly to `main`. Always create a `feat/` branch (or `fix/`/`chore/`/`wip/` per
  `AGENTS.md`) and open a PR for review.
- Verify the working directory is the canonical Lariat repo (`~/Dev/hospitality/Lariat`) before
  making any edits — not an iCloud-synced copy or a stale checkout.

## Verification / Pre-commit

- Run all verification gates — schema check, typecheck, lint, and the relevant tests — before
  committing or merging any PR. Do not commit if any gate fails.

## Tooling Conventions

- Always use the Read tool to read files before editing. Never read source via Bash (`cat`/`head`/
  `sed`) when you intend to edit it — Edit operations fail on Bash-read files.

## Environment Limitations

- Do not run interactive/TTY-dependent commands (`codex resume`, `hermes model`, browser OAuth
  flows) in the sandbox. They cannot complete in the non-interactive tool environment — flag them
  for the user to run manually instead.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Lariat** (23490 symbols, 35897 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Lariat/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Lariat/clusters` | All functional areas |
| `gitnexus://repo/Lariat/processes` | All execution flows |
| `gitnexus://repo/Lariat/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
