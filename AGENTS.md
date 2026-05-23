# AGENTS.md — Lariat

Restaurant F&B operations: recipes, costing, inventory, HACCP, POS. Culinary datasets belong to this project.

## Dev-root boundary

This file is project-local. `~/Dev` is only the workspace container; once a session is inside this repo, use this file plus `CLAUDE.md` and project docs as the active rules.

- Scope searches, build commands, tests, DB work, schema changes, and data-ingest checks to this repository unless a sibling repo is explicitly named.
- Load project-specific code intelligence, schema/database tooling, audit tooling, and CI checks from this repo's docs only.
- If work touches another folder inside `~/Dev`, switch to that folder's own `AGENTS.md` before editing there.
- Do not refresh or rely on a `~/Dev`-wide index as the source of truth for this project.

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

## Multi-Agent Coordination Protocol (MACP)

To prevent collision and trample in this multi-agent environment, follow these rules:

1.  **Isolate via Worktrees**: Always work in a dedicated worktree per task/agent (`scripts/worktree.sh new <agent> <branch>`).
2.  **Claim Your Files**: Before editing, announce the files you intend to touch by updating your session:
    `node scripts/agent-session.mjs update --claimed "path/to/file1,path/to/file2"`
3.  **Check for Collisions**: Run `node scripts/agent-session.mjs list` before starting a task to see if other agents have claimed your files or are working on related branches.
4.  **Ownership**: One branch owner per active PR. Do not trample another agent's branch.
5.  **Pre-Push Sync**: Before pushing or merging, perform a `git fetch` and compare your status against the remote to ensure you aren't overwriting concurrent changes.

The shared session board lives at `.agent-sessions/` (gitignored).

See also: `scripts/worktree.sh` (commands and locking semantics), `scripts/check-session-branch.mjs` (the pre-commit guard), `scripts/agent-session.mjs` (the coordination utility).

## Trio orchestration (Claude + Gemini + Codex)

Claude Code is the **orchestrator** on this project. Gemini and Codex are specialists Claude consults via MCP (`mcp__gemini-cli__ask-gemini`) and the codex plugin (`/codex rescue`). The full policy + decision rules live in [`.claude/ORCHESTRATION.md`](.claude/ORCHESTRATION.md); a `/trio` Claude command runs the full consult-and-synthesize flow.

**Cross-tool handoff file**: `.agent-sessions/handoff.md` (append-only, gitignored). Gemini and Codex, when invoked from this project, MUST append their findings here in addition to returning them — that's how state survives across sessions. Entry format:

```
## YYYY-MM-DD HH:MM <tool> <topic>
- context: ...
- finding/sketch: ...
- next: ...
```

Codex specifically: propose, do not commit. Claude reviews your sketch and owns the final edit + commit.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Lariat** (23523 symbols, 35815 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
