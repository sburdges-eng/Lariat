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
