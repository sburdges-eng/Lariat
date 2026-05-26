# Gemini — Lariat

Use [AGENTS.md](AGENTS.md) as the canonical entrypoint.

Re-assert before generating code:

- This is restaurant ops (Lariat), not the image API (COOLIO) — do not confuse.
- HACCP logic is regulated; never weaken validations or silently auto-correct.
- Schema changes require migrations, not in-place edits.
- Toast POS CSVs are cp1252-encoded; Shamrock `.xls` requires `xlrd`.
- For any multi-commit batch, work in a per-tool worktree: `scripts/worktree.sh new gemini <branch>` then `cd ../Lariat-worktrees/gemini-<slug>`. The pre-commit guard refuses commits if HEAD drifts. See AGENTS.md "Multi-session protocol".

## Trio orchestration — handoff protocol (BINDING)

**Codex orchestrates** this project; you are the long-context specialist. Policy: [workspace-scaffold/docs/TRIO_ORCHESTRATION.md](../../workspace-scaffold/docs/TRIO_ORCHESTRATION.md). Antigravity: also read [ANTIGRAVITY.md](ANTIGRAVITY.md).

When Codex, Claude, or the user consults you, **always append findings to `.agent-sessions/handoff.md`** in addition to returning them — other tools read that file on session start.

Append format:
```
## YYYY-MM-DD HH:MM gemini <topic>
- finding-1: ...
- finding-2: ...
- recommendation: ...
```

Keep entries terse (5-8 bullets max). Full policy in `workspace-scaffold/docs/TRIO_ORCHESTRATION.md`.
