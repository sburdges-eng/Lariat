# AGENTS.md — Lariat

Restaurant F&B operations: recipes, costing, inventory, HACCP, POS. Culinary datasets belong to this project.

1. Goal: simplify BOH (back-of-house) operations. If a change makes kitchen/manager workflows more complex, it is wrong.
2. UI rules: no underscores, no dev-style column names, USD to 2 decimals, "Spring"/"Fall" (never "Shoulder"). STRICT: See `docs/UI_COPY_RULES.md` for mandatory line-cook language constraints (e.g. no SaaS jargon, short labels).
3. This project is food/restaurant ops — do **not** confuse with COOLIO (image API) despite overlapping "cool" naming.
4. HACCP / food-safety logic is regulated — do not weaken validations or silently auto-correct records; surface errors.
5. See `CLAUDE.md` (if present) and `docs/` for architecture. Schema changes require a migration, never in-place edits.
6. Test with real-looking recipe/inventory data, not synthetic `foo`/`bar` fixtures — the domain rules only surface with realistic data.

## Vendor data encoding gotchas

- Toast POS exports (MenuItems.csv, MenuOption.csv, sales summary CSVs) are encoded in **cp1252**, not UTF-8. Always pass `encoding='cp1252'` (or `errors='replace'`) when reading. Curly apostrophes ("Tito's") and currency placeholder bytes (0xbf 0xbf → "$???") will otherwise blow up. Source: `scripts/ingest_toast_menu_catalog.py`.
- Shamrock .xls files (price list, inventory sheet, order sheet, invoices) are old CDFV2 format — read with `xlrd`, not `openpyxl`. xlrd emits a benign "file size not 512 + multiple of sector size" warning that can be ignored.

## Multi-session protocol (worktrees) — BINDING

Multiple AI sessions (Claude Code, Cursor, Codex, Gemini) often run against this repo simultaneously. They share one `.git/` but **trample each other's HEAD** if they all use the same checkout. Real failure mode observed: session A is mid-commit-batch, session B runs `git checkout`, session A's next commit lands on the wrong branch silently.

The fix is **one worktree per session**. Whenever you start a multi-commit batch, run:

```bash
scripts/worktree.sh new <tool> <branch>     # tool ∈ {claude, cursor, codex, gemini, sean}
cd ../Lariat-worktrees/<tool>-<branch-slug>
```

This creates an isolated checkout under `../Lariat-worktrees/`, locks the worktree to its branch via a `SESSION_BRANCH` file, and the pre-commit guard (`scripts/check-session-branch.mjs`) refuses commits if HEAD drifts. Other sessions cannot move your HEAD.

### Branch naming (binding)

- `feat/<short-name>` — new feature
- `fix/<short-name>` — bug fix
- `chore/<short-name>` — tooling, deps, gitignore, docs
- `wip/<short-name>` — scratch / about to be deleted

No other prefixes. `cursor/`, `feature/` (with `ure`), `bundle-h-*` etc. are legacy and being retired.

### Listing / pruning

```bash
npm run branches:list                  # newest-first across feat/fix/chore/wip
npm run branches:list -- feat          # just one prefix
npm run branches:stale                 # branches inactive 30+ days
npm run branches:merged                # already in main — safe to delete
npm run branches:prune-merged          # delete merged ones (asks)
```

### When NOT to use a worktree

One-off single commits in the main checkout are fine. The protocol kicks in for **multi-commit batches** and for **long-running sessions** where another tool may interleave. If you're unsure, default to a worktree — they're cheap to create and remove.

See also: `scripts/worktree.sh` (commands and locking semantics), `scripts/check-session-branch.mjs` (the pre-commit guard).
