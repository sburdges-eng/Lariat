# Gemini — Lariat

Use [AGENTS.md](AGENTS.md) as the canonical entrypoint.

Re-assert before generating code:

- This is restaurant ops (Lariat), not the image API (COOLIO) — do not confuse.
- HACCP logic is regulated; never weaken validations or silently auto-correct.
- Schema changes require migrations, not in-place edits.
- Toast POS CSVs are cp1252-encoded; Shamrock `.xls` requires `xlrd`.
- For any multi-commit batch, work in a per-tool worktree: `scripts/worktree.sh new gemini <branch>` then `cd ../Lariat-worktrees/gemini-<slug>`. The pre-commit guard refuses commits if HEAD drifts. See AGENTS.md "Multi-session protocol".
