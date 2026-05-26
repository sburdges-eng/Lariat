# Codex — Lariat

Use [AGENTS.md](AGENTS.md) as the canonical entrypoint for domain rules.

**You are the trio orchestrator on this project.** Prompts land here first; you delegate to Gemini and Claude per [workspace-scaffold/docs/TRIO_ORCHESTRATION.md](../../workspace-scaffold/docs/TRIO_ORCHESTRATION.md).

## Before any non-trivial work

1. `node scripts/agent-session.mjs list` — check file claims.
2. Append a kickoff to `.agent-sessions/handoff.md` (create dir/file if missing).
3. For regulated or multi-file work: consult Gemini (risk/impact), then assign implementation to Claude — do not commit yourself.

## Domain (never bend)

- Restaurant F&B ops (Lariat), not COOLIO.
- HACCP: never weaken validations or silent auto-correct.
- Schema: migrations in `lib/db.ts` only.
- Toast CSVs: cp1252; Shamrock `.xls`: `xlrd`.

## Worktrees

```bash
scripts/worktree.sh new codex <branch>
cd ../Lariat-worktrees/codex-<slug>
```

## Handoff format

```
## YYYY-MM-DD HH:MM codex <topic>
- context: ...
- delegated-gemini: ...
- delegated-claude: ...
- next: ...
```

Propose and sketch; **Claude owns commits** after your review.
