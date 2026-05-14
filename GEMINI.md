# Gemini — Lariat

Use [AGENTS.md](AGENTS.md) as the canonical entrypoint.

Re-assert before generating code:

- This is restaurant ops (Lariat), not the image API (COOLIO) — do not confuse.
- HACCP logic is regulated; never weaken validations or silently auto-correct.
- Schema changes require migrations, not in-place edits.
- Toast POS CSVs are cp1252-encoded; Shamrock `.xls` requires `xlrd`.
- For any multi-commit batch, work in a per-tool worktree: `scripts/worktree.sh new gemini <branch>` then `cd ../Lariat-worktrees/gemini-<slug>`. The pre-commit guard refuses commits if HEAD drifts. See AGENTS.md "Multi-session protocol".

## Trio orchestration — handoff protocol (BINDING when invoked by Claude)

Claude Code is the primary editor on this project and will call you (Gemini) for second opinions and long-context analysis via the `gemini-cli` MCP server. When you produce findings for Claude, **always append them to `.agent-sessions/handoff.md`** in addition to returning them — Claude reads that file on session start so your analysis survives the round-trip.

Append format:
```
## YYYY-MM-DD HH:MM gemini <topic>
- finding-1: ...
- finding-2: ...
- recommendation: ...
```

Keep entries terse (5-8 bullets max). Full policy in `.claude/ORCHESTRATION.md`.
