# Workspace merge + web/native completion unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the two Lariat VSCode workspaces into one, and give the project a single evidence-tagged document that answers "what is done across web and native."

**Architecture:** Two independent halves. Task 1 merges the workspace files and ships immediately — it depends on nothing. Tasks 2–5 build the status story: audit evidence into the scratchpad first, then write one thin cross-cutting `docs/PROJECT_STATUS.md` that frames and delegates, then align the six existing status docs so each has exactly one job. The status half is gated on PR #605 merging, because it links files that exist only on that branch.

**Tech Stack:** JSON (`.code-workspace`), Markdown, `git`, `gh` CLI. No application code, no schema, no tests in the repo change.

**Spec:** [`docs/superpowers/specs/2026-08-06-lariat-workspace-and-status-unification-design.md`](../specs/2026-08-06-lariat-workspace-and-status-unification-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **Never push to `main`.** Work happens on `chore/workspace-status-unification-spec`, already branched off `origin/main`. Open a PR; let Sean merge.
- **Evidence rule:** every completion claim carries a PR number, a `file:line`, or a test file path. A commit message alone is never sufficient — this repo's commit messages can be aspirational (`CLAUDE.md` §7).
- **Confidence tags:** `HIGH` = grep-confirmed on `origin/main` or a PR diff read directly. `MED` = a single documentary or PR-title source. `LOW` = memory file only, flagged for Sean rather than asserted.
- **Always grep `origin/main`, never local `main`.** Local `main` is at `086cf04` against origin `7e9627f` — roughly twenty PRs stale.
- **No verification gates.** `npm run verify` and `swift test` are out of scope. A row that cannot be settled without a gate is tagged `MED` and named as needing one.
- **Do not edit any file owned by PR #605:** `docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md`, `docs/NATIVE_RELEASES_AND_TAXONOMY.md`, `docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md`, `docs/superpowers/plans/2026-07-10-phase4-verify-0.2-evidence.md`, `docs/superpowers/specs/2026-07-02-lariat-native-endgame.md`, `.cursor/rules/lariat-native-final.mdc`, and every `docs/superpowers/plans/2026-08-05-*`. Task 4 adds pointer lines only to docs #605 does **not** touch.
- **No code, schema, migration, test, or protected-surface changes.** If a task seems to require one, stop and report instead.
- **Scratchpad path** for all working files: `/private/tmp/claude-501/-Users-seanburdges-Dev-hospitality-Lariat/6a3023cf-76a7-402f-8d56-9c5040a28fcb/scratchpad/`

---

### Task 1: Merge the two workspace files into one

Independent of everything else. Do this first; it delivers value immediately.

**Files:**
- Modify: `/Users/seanburdges/Dev/workspaces/lariat.code-workspace` (full rewrite)
- Delete: `/Users/seanburdges/Dev/workspaces/lariat-native.code-workspace`
- Test: `<scratchpad>/verify-workspace.cjs` (scratchpad only — never committed)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing later tasks depend on. This task is a leaf.

**Important:** both workspace files are tracked in the `~/Dev` container repo (remote `sburdges-eng/Dev`). Per the spec, **leave the result as a working-tree change in `~/Dev` — do not `git add`, commit, or push there.** Sean decides separately whether that repo gets a commit.

- [ ] **Step 1: Write the failing verification script**

Create `<scratchpad>/verify-workspace.cjs`:

```js
const fs = require('fs');
const path = require('path');

const WS = '/Users/seanburdges/Dev/workspaces/lariat.code-workspace';
const OLD = '/Users/seanburdges/Dev/workspaces/lariat-native.code-workspace';

const EXPECTED_FOLDERS = [
  ['Lariat (app)', '../hospitality/Lariat'],
  ['LariatNative SwiftPM', '../hospitality/Lariat/LariatNative'],
  ['Lariat-KDS Companion', '../Lariat-KDS'],
  ['Lariat Data Sources (read/ingest)', '../lariat-data-sources'],
  ['hubs (routing)', '../docs/hubs'],
  ['docs (shared)', '../workspace-scaffold/docs'],
  ['scripts (shared)', '../workspace-scaffold/scripts'],
  ['agents (shared)', '../workspace-scaffold/agents'],
  ['hooks (shared)', '../workspace-scaffold/hooks'],
  ['skills (shared)', '../workspace-scaffold/skills'],
];

const EXPECTED_TASKS = [
  'LariatNative: swift test',
  'LariatNative: swift build',
  'LariatNative: package app',
  'Lariat-KDS: swift test',
  'Lariat web edge: typecheck',
  'Lariat web edge: build',
];

const EXPECTED_LAUNCH = [
  'Debug LariatApp (LariatNative SwiftPM)',
  'Release LariatApp (LariatNative SwiftPM)',
];

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

let ws;
try {
  ws = JSON.parse(fs.readFileSync(WS, 'utf8'));
} catch (e) {
  console.error(`FAIL: ${WS} is not parseable JSON — ${e.message}`);
  process.exit(1);
}

check(Array.isArray(ws.folders) && ws.folders.length === 10,
  `folders: expected 10, got ${ws.folders ? ws.folders.length : 'none'}`);

for (const [name, p] of EXPECTED_FOLDERS) {
  const hit = (ws.folders || []).find((f) => f.path === p);
  check(hit, `folders: missing path ${p}`);
  if (hit) check(hit.name === name, `folders: ${p} named "${hit.name}", expected "${name}"`);
  const abs = path.resolve(path.dirname(WS), p);
  check(fs.existsSync(abs), `folders: ${p} does not resolve to an existing dir (${abs})`);
}

const taskLabels = ((ws.tasks || {}).tasks || []).map((t) => t.label);
for (const label of EXPECTED_TASKS) {
  check(taskLabels.includes(label), `tasks: missing "${label}"`);
}
check(taskLabels.length === 6, `tasks: expected 6, got ${taskLabels.length}`);

const launchNames = ((ws.launch || {}).configurations || []).map((c) => c.name);
for (const name of EXPECTED_LAUNCH) {
  check(launchNames.includes(name), `launch: missing "${name}"`);
}
check(launchNames.length === 2, `launch: expected 2, got ${launchNames.length}`);

const s = ws.settings || {};
check(s['typescript.tsdk'] === 'node_modules/typescript/lib', 'settings: typescript.tsdk missing (from web file)');
check(Array.isArray(s['python.analysis.extraPaths']), 'settings: python.analysis.extraPaths missing (from web file)');
check(s['swift.path'] === '/usr/bin/swift', 'settings: swift.path missing');
check(s['search.followSymlinks'] === false, 'settings: search.followSymlinks must be false');

const watch = Object.keys(s['files.watcherExclude'] || {});
const search = Object.keys(s['search.exclude'] || {});
check(watch.includes('**/data/lariat.db*'), 'watcherExclude: missing **/data/lariat.db* (PII/db guard from native file)');
check(search.includes('**/data/lariat.db*'), 'search.exclude: missing **/data/lariat.db*');
for (const ext of ['pdf', 'docx', 'xlsx', 'xlsm', 'xls', 'jpeg', 'png']) {
  const glob = `**/lariat-data-sources/**/*.${ext}`;
  check(watch.includes(glob), `watcherExclude: missing ${glob}`);
  check(search.includes(glob), `search.exclude: missing ${glob}`);
}

check(!fs.existsSync(OLD), `${OLD} still exists — it must be deleted`);

if (fails.length) {
  console.error(`FAIL (${fails.length}):`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('PASS: merged workspace has 10 folders, 6 tasks, 2 launch configs, merged settings; native file removed.');
```

- [ ] **Step 2: Run it to confirm it fails against the current state**

```bash
node <scratchpad>/verify-workspace.cjs
```

Expected: `FAIL` — the current `lariat.code-workspace` has 7 folders, no `tasks`, no `launch`, no `data/lariat.db*` exclude, and `lariat-native.code-workspace` still exists.

- [ ] **Step 3: Write the merged workspace file**

Overwrite `/Users/seanburdges/Dev/workspaces/lariat.code-workspace` with exactly:

```json
{
  "folders": [
    { "path": "../hospitality/Lariat", "name": "Lariat (app)" },
    { "path": "../hospitality/Lariat/LariatNative", "name": "LariatNative SwiftPM" },
    { "path": "../Lariat-KDS", "name": "Lariat-KDS Companion" },
    { "path": "../lariat-data-sources", "name": "Lariat Data Sources (read/ingest)" },
    { "path": "../docs/hubs", "name": "hubs (routing)" },
    { "path": "../workspace-scaffold/docs", "name": "docs (shared)" },
    { "path": "../workspace-scaffold/scripts", "name": "scripts (shared)" },
    { "path": "../workspace-scaffold/agents", "name": "agents (shared)" },
    { "path": "../workspace-scaffold/hooks", "name": "hooks (shared)" },
    { "path": "../workspace-scaffold/skills", "name": "skills (shared)" }
  ],
  "extensions": {
    "recommendations": [
      "swiftlang.swift-vscode",
      "dbaeumer.vscode-eslint",
      "esbenp.prettier-vscode",
      "ms-python.python",
      "ms-python.vscode-pylance",
      "charliermarsh.ruff",
      "editorconfig.editorconfig"
    ]
  },
  "settings": {
    "workbench.task.allowAutomaticTasks": "on",
    "search.followSymlinks": false,
    "typescript.tsdk": "node_modules/typescript/lib",
    "eslint.workingDirectories": [{ "mode": "auto" }],
    "swift.path": "/usr/bin/swift",
    "python.analysis.extraPaths": ["scripts"],
    "json.schemaDownload.enable": true,
    "files.watcherExclude": {
      "**/node_modules/**": true,
      "**/.git/objects/**": true,
      "**/.git/subtree-cache/**": true,
      "**/build/**": true,
      "**/.build/**": true,
      "**/.swiftpm/**": true,
      "**/dist/**": true,
      "**/site-packages/**": true,
      "**/.venv/**": true,
      "**/venv/**": true,
      "**/__pycache__/**": true,
      "**/.pytest_cache/**": true,
      "**/.mypy_cache/**": true,
      "**/.ruff_cache/**": true,
      "**/.next/**": true,
      "**/.turbo/**": true,
      "**/LariatNative/.build/**": true,
      "**/LariatNative/build/**": true,
      "**/cad-kernel/build/**": true,
      "**/cad-kernel/build2/**": true,
      "**/worktrees/**": true,
      "**/data/lariat.db*": true,
      "**/lariat-data-sources/**/*.pdf": true,
      "**/lariat-data-sources/**/*.docx": true,
      "**/lariat-data-sources/**/*.xlsx": true,
      "**/lariat-data-sources/**/*.xlsm": true,
      "**/lariat-data-sources/**/*.xls": true,
      "**/lariat-data-sources/**/*.jpeg": true,
      "**/lariat-data-sources/**/*.png": true
    },
    "search.exclude": {
      "**/node_modules": true,
      "**/build": true,
      "**/.build": true,
      "**/.swiftpm": true,
      "**/dist": true,
      "**/.venv": true,
      "**/venv": true,
      "**/__pycache__": true,
      "**/.pytest_cache": true,
      "**/.mypy_cache": true,
      "**/.ruff_cache": true,
      "**/*.lock": true,
      "**/package-lock.json": true,
      "**/Package.resolved": true,
      "**/.next": true,
      "**/.turbo": true,
      "**/LariatNative/.build": true,
      "**/cad-kernel/build": true,
      "**/cad-kernel/build2": true,
      "**/worktrees": true,
      "**/data/lariat.db*": true,
      "**/lariat-data-sources/**/*.pdf": true,
      "**/lariat-data-sources/**/*.docx": true,
      "**/lariat-data-sources/**/*.xlsx": true,
      "**/lariat-data-sources/**/*.xlsm": true,
      "**/lariat-data-sources/**/*.xls": true,
      "**/lariat-data-sources/**/*.jpeg": true,
      "**/lariat-data-sources/**/*.png": true
    }
  },
  "tasks": {
    "version": "2.0.0",
    "tasks": [
      {
        "label": "LariatNative: swift test",
        "type": "shell",
        "command": "swift",
        "args": ["test"],
        "options": { "cwd": "${workspaceFolder:LariatNative SwiftPM}" },
        "problemMatcher": [],
        "group": { "kind": "test", "isDefault": true }
      },
      {
        "label": "LariatNative: swift build",
        "type": "shell",
        "command": "swift",
        "args": ["build"],
        "options": { "cwd": "${workspaceFolder:LariatNative SwiftPM}" },
        "problemMatcher": [],
        "group": "build"
      },
      {
        "label": "LariatNative: package app",
        "type": "shell",
        "command": "Scripts/package-app.sh",
        "args": ["--pkg"],
        "options": { "cwd": "${workspaceFolder:LariatNative SwiftPM}" },
        "problemMatcher": [],
        "group": "build"
      },
      {
        "label": "Lariat-KDS: swift test",
        "type": "shell",
        "command": "swift",
        "args": ["test"],
        "options": { "cwd": "${workspaceFolder:Lariat-KDS Companion}" },
        "problemMatcher": [],
        "group": "test"
      },
      {
        "label": "Lariat web edge: typecheck",
        "type": "shell",
        "command": "npm",
        "args": ["run", "typecheck"],
        "options": { "cwd": "${workspaceFolder:Lariat (app)}" },
        "problemMatcher": [],
        "group": "test"
      },
      {
        "label": "Lariat web edge: build",
        "type": "shell",
        "command": "npm",
        "args": ["run", "build"],
        "options": { "cwd": "${workspaceFolder:Lariat (app)}" },
        "problemMatcher": [],
        "group": "build"
      }
    ]
  },
  "launch": {
    "configurations": [
      {
        "type": "swift",
        "request": "launch",
        "args": [],
        "cwd": "${workspaceFolder:LariatNative SwiftPM}",
        "name": "Debug LariatApp (LariatNative SwiftPM)",
        "target": "LariatApp",
        "configuration": "debug",
        "preLaunchTask": "swift: Build Debug LariatApp (LariatNative SwiftPM)"
      },
      {
        "type": "swift",
        "request": "launch",
        "args": [],
        "cwd": "${workspaceFolder:LariatNative SwiftPM}",
        "name": "Release LariatApp (LariatNative SwiftPM)",
        "target": "LariatApp",
        "configuration": "release",
        "preLaunchTask": "swift: Build Release LariatApp (LariatNative SwiftPM)"
      }
    ]
  }
}
```

Three deliberate changes from a naive concatenation, each of which a reviewer should check:

1. The two web-edge tasks had `cwd: ${workspaceFolder:Lariat Canonical Repo}` in the native file. That folder name does not exist in the merged file — the Lariat folder is named `Lariat (app)`. Both are retargeted to `${workspaceFolder:Lariat (app)}`. **Getting this wrong makes both web tasks silently fail to launch.**
2. `**/worktrees/**/.build/**` from the native file is dropped as redundant: `**/worktrees/**` already covers it.
3. `**/LariatNative/build/**` is kept from the native file even though `**/build/**` covers it, matching how the source file spelled it.

- [ ] **Step 4: Delete the native workspace file**

```bash
rm /Users/seanburdges/Dev/workspaces/lariat-native.code-workspace
```

- [ ] **Step 5: Run the verification script to confirm it passes**

```bash
node <scratchpad>/verify-workspace.cjs
```

Expected: `PASS: merged workspace has 10 folders, 6 tasks, 2 launch configs, merged settings; native file removed.`

- [ ] **Step 6: Confirm the `~/Dev` change is left uncommitted, and report it**

```bash
git -C /Users/seanburdges/Dev status --short -- workspaces/
```

Expected: exactly two lines — a modification to `workspaces/lariat.code-workspace` and a deletion of `workspaces/lariat-native.code-workspace`.

Do **not** `git add` or commit in `~/Dev`. Report the two lines to Sean and note that committing the container repo is his call.

---

### Task 2: Audit completion evidence into the scratchpad

No repo files change in this task. Its deliverable is a findings table Sean reviews *before* any of it becomes a document.

**Files:**
- Create: `<scratchpad>/status-audit.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `<scratchpad>/status-audit.md`, containing a table with the exact columns `Lane | Half | State | Evidence | Confidence`, where `Half` ∈ {`web`, `native`, `shared`}, `State` ∈ {`shipped`, `in-flight`, `blocked-owner`, `blocked-code`}, and `Confidence` ∈ {`HIGH`, `MED`, `LOW`}. Tasks 3 and 5 read this file and nothing else.

- [ ] **Step 1: Refresh refs and capture the PR ledger**

```bash
cd /Users/seanburdges/Dev/hospitality/Lariat
git fetch origin
gh pr list --state merged --limit 120 --json number,title,mergedAt \
  --jq '.[] | select(.mergedAt > "2026-07-15") | "\(.number)\t\(.mergedAt[0:10])\t\(.title)"' \
  > <scratchpad>/prs-merged.tsv
gh pr list --state open --limit 40 --json number,title,createdAt \
  --jq '.[] | "\(.number)\t\(.createdAt[0:10])\t\(.title)"' \
  > <scratchpad>/prs-open.tsv
git rev-parse origin/main > <scratchpad>/as-of-sha.txt
```

- [ ] **Step 2: Group the PRs into lanes**

Read both TSVs. Every PR must land in exactly one lane. Start from these known clusters — the spec names them as programs currently documented nowhere — and add any lane the TSVs reveal that is not listed:

| Lane | Half | Known PRs |
|---|---|---|
| BOH ops packet (`/boh`, offline line book) | web | #573, #574, #576, #578, #593 |
| Commercial v1 phase 0 | shared | #584 |
| Costing recovery + master catalog | web | #594–#599, #604 (open) |
| Ingredient map / yields coverage | web | #589, #591, #592, #596, #598 |
| Hermetic-DB CI | shared | #600, #601, #603 |
| CI gate expansion | shared | #546–#550, #588 |
| Temp-PIN scope closure | web | #586, #587 |
| Cloud-bridge `/v2` canonical envelope | shared | #553–#562 |
| BEO cascade corrections | shared | #563, #564, #565, #579–#583 |
| BEO event model + estimate | web | #566, #567, #569, #570 |
| Native unconfigured-install / first PIN | native | #606 merged; #607, #609 open |
| Native packaging + data dir | native | #571 |
| Native CI on stacked PRs | native | #610 open |
| Native 1.0 gap fronts | native | #605 open |

- [ ] **Step 3: Spot-verify only the rows that need it**

Do **not** verify every row. Grep only where a row is *complete-but-gated*, or where two sources disagree. Every grep targets `origin/main`.

```bash
# hermetic-DB CI: is the assertion actually wired, or only described?
git grep -n "shared database\|sharedDb\|LARIAT_DATA_DIR" origin/main -- scripts .github package.json | head -20

# temp-PIN closure: is the middleware matcher genuinely covering the freed scopes?
git grep -n "SENSITIVE_PREFIXES\|pinRequiredForPic" origin/main -- middleware.js lib | head -20

# costing coverage: the real signal per CLAUDE.md §7 is map_status, never a re-derivation
git grep -n "map_status" origin/main -- lib app scripts | head -20

# Commercial v1 phase 0: what did #584 actually add, and is there a doc for it?
gh pr view 584 --json files --jq '.files[].path'

# BOH ops packet: does /boh exist on origin/main?
git ls-tree -r --name-only origin/main -- app/boh | head -20
```

Record the resulting `file:line` in the Evidence column. If a grep returns nothing, that row is `MED` at best and its State must be softened — never upgrade a row on absence of contradiction.

- [ ] **Step 4: Write the findings table**

Create `<scratchpad>/status-audit.md`. Header records the as-of SHA from Step 1. One row per lane. Worked example of the required shape:

```markdown
# Status audit — 2026-08-06

As-of `origin/main`: 7e9627f

| Lane | Half | State | Evidence | Confidence |
|---|---|---|---|---|
| Hermetic-DB CI | shared | shipped | #600, #601, #603; `scripts/<file>:<line>` asserts no suite touches the shared DB | HIGH |
| Commercial v1 phase 0 | shared | in-flight | #584; no status doc entry anywhere | MED |
| Native 0.2 GUI smoke | native | blocked-owner | #605 Front 0; needs Mac GUI run, cannot run headless | HIGH |
```

Below the table, two lists: **owner-decision blockers** (needs Sean — GUI smoke, service-day shutoff, notarization identity, per-piece `per_count` calls) and **code-work blockers** (an agent can do it).

- [ ] **Step 5: Report to Sean and stop for review**

Post the table plus a one-line count of `HIGH` / `MED` / `LOW` rows. Explicitly call out every `LOW` row, since those rest on memory alone. **Do not proceed to Task 3 without Sean's go.**

- [ ] **Step 6: Commit**

Nothing to commit — the audit lives in the scratchpad by design. Confirm the repo tree is clean:

```bash
git status --short
```

Expected: only the pre-existing untracked `.codex/`.

---

### Task 3: Write `docs/PROJECT_STATUS.md`

**Blocked on PR #605 merging.** Check first:

```bash
gh pr view 605 --json state --jq '.state'
```

If not `MERGED`, stop and report. Do not write the file with dangling links.

**Files:**
- Create: `docs/PROJECT_STATUS.md`

**Interfaces:**
- Consumes: `<scratchpad>/status-audit.md` (the `Lane | Half | State | Evidence | Confidence` table and the two blocker lists) and `<scratchpad>/as-of-sha.txt`.
- Produces: `docs/PROJECT_STATUS.md`. Task 4 links to it by that exact path.

- [ ] **Step 1: Confirm #605 is merged and refresh refs**

```bash
gh pr view 605 --json state --jq '.state'   # must print MERGED
git fetch origin
git rev-parse origin/main
```

If the SHA differs from `<scratchpad>/as-of-sha.txt`, re-run Task 2 Step 1 and fold any new PRs into the table before continuing.

- [ ] **Step 2: Write the document**

Create `docs/PROJECT_STATUS.md` with exactly this structure, filling the table from the audit:

```markdown
---
title: "Lariat project status — web and native"
date: 2026-08-06
status: current
canonical_id: lariat-project-status
---

# Lariat project status

**As of:** 2026-08-06 · `origin/main` <SHA from as-of-sha.txt>

> This repo's commit messages can be aspirational. For any "is X done?" question,
> the code wins over this document — grep the symbol, table, or test on
> `origin/main`. Every row below names the evidence it rests on and how far that
> evidence goes.

## Where the project is

| Lane | Half | State | Evidence | Confidence |
|---|---|---|---|---|
| ... one row per lane from the audit ... |

`Half` is `web`, `native`, or `shared`. `State` is `shipped`, `in-flight`,
`blocked-owner`, or `blocked-code`. `Confidence` is `HIGH` (grep-confirmed on
`origin/main` or PR diff read), `MED` (single source), or `LOW` (memory only —
treat as a lead, not a fact).

## Blocked on an owner decision

- ... from the audit's owner-decision list, each with what unblocks it ...

## Blocked on code work

- ... from the audit's code-work list ...

## Do not re-open

Native work already finished is enumerated in the gap-execution index's
"Already done — do not re-open" table:
[`docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md`](superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md).
That table is the authority; it is deliberately not copied here.

## Which document owns what

| Question | Document |
|---|---|
| What do the release and milestone names mean? | [`NATIVE_RELEASES_AND_TAXONOMY.md`](NATIVE_RELEASES_AND_TAXONOMY.md) — binding glossary |
| What is the next native front, and who gates it? | [`2026-08-05-native-1-0-gap-execution-index.md`](superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md) |
| Where does native code live, and what is canonical? | [`LARIAT_NATIVE_FINAL_AGENT_GUIDE.md`](LARIAT_NATIVE_FINAL_AGENT_GUIDE.md) |
| Has this web section passed freeze review? | [`ROLLING_REVIEW_LEDGER.md`](ROLLING_REVIEW_LEDGER.md) |
| What did we decide, and when? | [`PROJECT_ROADMAP.md`](PROJECT_ROADMAP.md) — historical log |
| Which surfaces are contract-protected? | [`PROTECTED_CONTRACTS.md`](PROTECTED_CONTRACTS.md) |
| What is done across web *and* native? | this document |

## Keeping this honest

Refresh the as-of SHA whenever a row changes. A row whose evidence is older than
the as-of SHA by more than a few weeks should be re-grepped before it is quoted.
```

Constraints on the prose: no SaaS jargon, no underscores in headings, USD to two decimals if any figure appears. `docs/UI_COPY_RULES.md` governs user-facing strings and does not bind this internal document, but plain language is still the house style.

- [ ] **Step 3: Verify every link resolves**

```bash
cd /Users/seanburdges/Dev/hospitality/Lariat
grep -o '](\([^)]*\.md\)[^)]*)' docs/PROJECT_STATUS.md | sed 's/](//; s/)$//; s/#.*//' | sort -u | while read -r p; do
  [ -f "docs/$p" ] && echo "OK   $p" || echo "MISS $p"
done
```

Expected: every line `OK`. Any `MISS` must be fixed before committing.

- [ ] **Step 4: Verify no row cites only a commit message**

```bash
grep -n '^|' docs/PROJECT_STATUS.md | grep -vE '#[0-9]+|\.mjs|\.ts|\.js|\.swift|:[0-9]+' | head
```

Expected: only the header row, the separator row, and rows from the ownership table. Any status row appearing here lacks real evidence — fix it or drop its confidence to `LOW` and flag it.

- [ ] **Step 5: Commit**

```bash
git add docs/PROJECT_STATUS.md
git commit -m "docs(status): one sheet for where web and native actually are

Six documents tracked completion, all stale, none of them putting the two
halves in one frame. Whole programs -- Commercial v1 phase 0, the BOH ops
packet, the costing recovery chain -- had no status entry anywhere.

This is deliberately thin: a frame plus links. Native detail stays in the
gap-execution index; this does not restate it. Every row carries a PR,
file:line, or test and a confidence tag, so a stale claim reads as stale
instead of as fact.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Give each existing status doc one stated job

**Files:**
- Modify: `docs/PROJECT_ROADMAP.md` (insert after the H1)
- Modify: `docs/ROLLING_REVIEW_LEDGER.md` (insert after the H1)

**Interfaces:**
- Consumes: `docs/PROJECT_STATUS.md` from Task 3.
- Produces: nothing later tasks depend on.

`NATIVE_RELEASES_AND_TAXONOMY.md`, `LARIAT_NATIVE_FINAL_AGENT_GUIDE.md`, the L1 status plan, and the endgame spec are **owned by PR #605** — do not touch them here. Their pointer lines are already handled by the ownership table in `PROJECT_STATUS.md`. `V2_CUTOVER_PLAN.md` and `INTEGRATION_AUDIT.md` are handled in Task 5, where the audit tells us whether they are stale or superseded.

- [ ] **Step 1: Add the pointer to `PROJECT_ROADMAP.md`**

Insert immediately after the H1 line:

```markdown
> **This is a historical log, not current state.** Entries are append-only and
> dated; each records what was decided when. For where the project is *now*,
> read [`PROJECT_STATUS.md`](PROJECT_STATUS.md).
```

- [ ] **Step 2: Add the pointer to `ROLLING_REVIEW_LEDGER.md`**

Insert immediately after the H1 line:

```markdown
> **Scope: web freeze reviews only.** One entry per section per commit. For
> project-wide state across web and native, read
> [`PROJECT_STATUS.md`](PROJECT_STATUS.md).
```

- [ ] **Step 3: Verify both pointers landed and nothing owned by #605 was touched**

```bash
grep -l "PROJECT_STATUS.md" docs/PROJECT_ROADMAP.md docs/ROLLING_REVIEW_LEDGER.md
git status --short docs/
```

Expected: both filenames listed by `grep`; `git status` shows exactly those two modifications and no others.

- [ ] **Step 4: Commit**

```bash
git add docs/PROJECT_ROADMAP.md docs/ROLLING_REVIEW_LEDGER.md
git commit -m "docs: say what each status doc is for, and where current state lives

The roadmap reads like current state but is an append-only log; the review
ledger reads like project status but only covers web freeze reviews. Both now
say so at the top and point at the status sheet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Resolve the two 2026-07-05 web docs and refresh the review ledger

**Files:**
- Modify: `docs/V2_CUTOVER_PLAN.md` and/or `docs/INTEGRATION_AUDIT.md` (disposition decided from evidence, not assumed)
- Modify: `docs/ROLLING_REVIEW_LEDGER.md` (new entries, if the audit found any)

**Interfaces:**
- Consumes: `<scratchpad>/status-audit.md`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Decide the disposition of the two stale docs**

```bash
gh pr list --state merged --limit 120 --search "v2 cutover" --json number,title
git grep -n "V2_CUTOVER_PLAN\|INTEGRATION_AUDIT" origin/main -- docs '*.md' | head -20
```

Apply this rule, and record which branch you took and why:

- If the audit shows the work each doc describes has **shipped** → add a `> **Superseded.**` line after the H1 pointing at `PROJECT_STATUS.md`, and leave the body as the historical record.
- If the work is **still open** → add a `> **Last verified 2026-07-05; refreshed <date>.**` line and correct only the statements the audit contradicts. Do not rewrite the document.
- If the audit is **silent** on it → leave the file untouched and record it as an open question for Sean. Do not guess.

- [ ] **Step 2: Add any missing freeze-review entries to the ledger**

For every web section the audit shows was reviewed after 2026-07-15, append an entry in the existing format — the file's own header documents it: **Reviewed at commit**, **Review date**, **Freeze result** (`FROZEN` or `BLOCKED pending remediation`), **Scope completed**, **Explicitly excluded**, **Findings** by severity.

If the audit found no such reviews, this step is a **no-op** — record that explicitly in the task report rather than inventing entries.

- [ ] **Step 3: Verify**

```bash
git diff --stat docs/
```

Expected: only the files this task's Step 1 and Step 2 decided to touch. If the diff shows a file you did not decide on, revert it.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: settle the two stale web plans and bring the freeze ledger current

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Open the PR

**Files:** none — this task only publishes.

**Interfaces:**
- Consumes: the commits from Tasks 3–5.
- Produces: a PR number to report to Sean.

- [ ] **Step 1: Confirm the branch and check for collisions**

```bash
git branch --show-current    # expect chore/workspace-status-unification-spec
git fetch origin
git log --oneline origin/main..HEAD
gh pr list --state open --json number,title --jq '.[] | "\(.number)\t\(.title)"'
```

If another open PR now touches `docs/PROJECT_STATUS.md` or the same status docs, stop and report rather than opening a duplicate.

- [ ] **Step 2: Rebase onto current `origin/main`**

```bash
git rebase origin/main
```

If it conflicts in a file owned by #605, you edited something you should not have — revert that hunk.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin chore/workspace-status-unification-spec
gh pr create --base main --title "docs: unify the workspace and the web/native completion story" --body "$(cat <<'EOF'
## What

Two Lariat workspaces became one, and the split completion story became one sheet.

**Workspace** (`~/Dev/workspaces/`, not in this repo — left as a working-tree change for Sean to commit): `lariat.code-workspace` now holds the union of both files — 10 folders, all 6 swift/KDS/web tasks, both LariatApp launch configs, and the stricter exclude set. `lariat-native.code-workspace` is deleted. The two web-edge tasks were retargeted from the folder name `Lariat Canonical Repo`, which no longer exists, to `Lariat (app)`.

**Status**: new `docs/PROJECT_STATUS.md` — one frame across web and native, every row carrying a PR, `file:line`, or test plus a confidence tag. It complements PR #605 rather than repeating it: native detail stays in the gap-execution index and is linked, not restated.

Programs that previously had no status entry anywhere and now do: Commercial v1 phase 0 (#584), the BOH ops packet (#573/#574/#576/#578/#593), the costing recovery chain (#594–#604), hermetic-DB CI (#600/#601/#603), temp-PIN closure (#586/#587).

Each older status doc now states its one job at the top and points at the sheet for current state.

## Verification

Docs and editor config only. No code, schema, migration, test, or protected surface touched. Merged workspace verified for JSON validity, 10 resolving folder paths, 6 tasks, 2 launch configs. Every link in `PROJECT_STATUS.md` verified to resolve.

Evidence was reconciled against `origin/main`, not local `main`, and no row rests on a commit message alone.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Report the PR number to Sean**

---

## Self-Review

**Spec coverage.** Part 1 (workspace merge) → Task 1. Part 2 (status architecture) → Tasks 3 and 4. Part 3 (evidence rules) → Global Constraints plus Task 2. Sequencing → Task 1 first, Task 3 gated on #605, Task 6 last. The spec's open item — `V2_CUTOVER_PLAN.md` / `INTEGRATION_AUDIT.md` disposition — is Task 5 Step 1, with a decision rule rather than a guess. Success criteria 1–6 map to Task 1 Step 5, Task 3 Step 2, Task 3 Step 4, Task 2 Step 2, Task 4 plus the Task 3 ownership table, and the Global Constraints prohibition.

**Placeholder scan.** No `TBD`/`TODO`. Three steps are deliberately conditional rather than prescriptive — Task 5 Step 1 (disposition), Task 5 Step 2 (ledger entries), Task 2 Step 2 (lanes beyond the known clusters). Each carries an explicit decision rule and an explicit "record that you found nothing" branch, because the correct action genuinely depends on evidence not yet gathered. That is a research finding, not a missing instruction.

**Type consistency.** The column set `Lane | Half | State | Evidence | Confidence` and the enum values for `Half`, `State`, and `Confidence` are declared once in Task 2's Interfaces block and used unchanged in Task 2 Step 4, Task 3 Step 2, and the Global Constraints. Folder names in Task 1's JSON match `verify-workspace.cjs`'s `EXPECTED_FOLDERS` exactly, including `Lariat (app)`, which the retargeted task `cwd` values also use. The path `docs/PROJECT_STATUS.md` is identical in Tasks 3, 4, and 6.
