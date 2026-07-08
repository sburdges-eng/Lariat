# Antigravity — Lariat

Use the same workspace and rules as Cursor and Gemini on this repo.

## Workspace (binding)

For final native app work, open **`~/Dev/workspaces/lariat-native.code-workspace`**.
For general web/edge Lariat work, open **`~/Dev/workspaces/lariat.code-workspace`**.
Never open `~/`, bare `~/Dev/`, or the home folder.

The native workspace includes the canonical Lariat repo, `LariatNative`, `Lariat-KDS`, and the Lariat data-source folder with watcher/search exclusions. See `~/Dev/DEV_OPS_RUNBOOK.md`.

## Agent entrypoints

1. [AGENTS.md](AGENTS.md) — domain + MACP/worktrees
2. [docs/NATIVE_RELEASES_AND_TAXONOMY.md](docs/NATIVE_RELEASES_AND_TAXONOMY.md) — binding release/milestone/L1 glossary (read before Native 0.2 work)
3. [docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md](docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md) — native-final status, workspaces, and Claude model-tier routing
4. [GEMINI.md](GEMINI.md) — Gemini/Antigravity handoff protocol when Claude or Codex consults you

## Your role in the trio

- **Codex** orchestrates; prompts start in the Codex terminal when using the trio task layout.
- **You (Gemini/Antigravity)** — long-context review, second opinions, brainstorms. Append results to `.agent-sessions/handoff.md`, not only chat.
- **Claude** — implementation and commits.

## Search scope

Never scan from `~/Dev/` without setting the search path to this repo root. Skip `node_modules/`, `build/`, `.venv/`, `data/lariat.db*`.
