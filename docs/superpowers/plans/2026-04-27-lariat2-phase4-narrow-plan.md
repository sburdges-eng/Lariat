# Lariat2 Phase 4-narrow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Booking, Playbook, and Past-Shows-Archive surfaces from `design/Lariat2/pages-event.jsx` into the live Next.js app, backed by Lauren's xlsx as source of truth.

**Architecture:** Python pure-parser → Node ingest wrapper (better-sqlite3 transaction) → SQLite tables (`shows`, `shows_archive`, `tiktok_ideas`) → TS repo → Next.js server-component pages, all PIN-gated. UI is read-only; xlsx is SoT.

**Tech Stack:** Python 3 + openpyxl (parser), Node.js + better-sqlite3 (ingest + repo), Next.js 14 App Router + React 18 (UI), pytest + node:test + Jest (tests), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-04-27-lariat2-phase4-narrow-design.md`

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `scripts/ingest_shows_xlsx.py` | Pure Python parser; reads xlsx, prints JSON; no DB writes |
| `scripts/ingest-shows.mjs` | Node wrapper; spawns Python, owns DB transaction |
| `lib/showStatus.ts` | Pure rule module: `(value, column) → {color,label}`; `pipelineStage(row)` |
| `lib/showsRepo.ts` | Read-only TS query layer over `shows`/`shows_archive`/`tiktok_ideas` |
| `app/api/shows/route.js` | GET-only JSON API: `op=upcoming\|playbook\|archive` |
| `app/booking/page.jsx` | Server component; calendar + pipeline |
| `app/booking/BookingCalendar.jsx` | Client component; row table |
| `app/booking/BookingPipeline.jsx` | Client component; six-stage funnel |
| `app/playbook/page.jsx` | Server component; resolves `?show=<id>` |
| `app/playbook/PlaybookHeader.jsx` | Client component; KPI strip + tab nav |
| `app/playbook/StatusPill.jsx` | Client component; renders `<showStatus.statusColor>` output |
| `app/playbook/tabs/AdsTab.jsx` | Client component |
| `app/playbook/tabs/TicketsTab.jsx` | Client component |
| `app/playbook/tabs/NewsTab.jsx` | Client component |
| `app/playbook/tabs/DayOfTab.jsx` | Client component |
| `app/shows/archive/page.jsx` | Server component |
| `app/shows/archive/ArchiveSearch.jsx` | Client component; search + era filter |
| `tests/python/test_ingest_shows_xlsx.py` | pytest |
| `tests/python/fixtures/build_shows_fixture.py` | Committed; builds `shows_minimal.xlsx` (gitignored) |
| `tests/js/test-show-status.mjs` | node:test |
| `tests/js/test-shows-ingest.mjs` | node:test |
| `tests/js/test-shows-repo.mjs` | node:test |
| `tests/js/test-shows-api.mjs` | node:test |
| `app/__tests__/BookingCalendar.test.jsx` | Jest |
| `app/__tests__/PlaybookTabs.test.jsx` | Jest |
| `app/__tests__/ArchiveSearch.test.jsx` | Jest |
| `tests/e2e/shows.spec.ts` | Playwright |

### Modified

| Path | Change |
|---|---|
| `lib/db.ts` | Append three `CREATE TABLE IF NOT EXISTS` blocks inside `initSchema()` |
| `middleware.js` | Add four prefixes + four matchers |
| `app/_components/navRegistry.js` | Add three nav items in a new `Entertainment` group |
| `package.json` | Add `ingest:shows` + 5 `test:shows-*` scripts; append `ingest:shows` to `ingest:all` |
| `.gitignore` | Ignore `tests/python/fixtures/shows_minimal.xlsx` |

### Deviation from spec

The spec described `ingest_runs` columns `dropped_json`/`row_counts` that don't exist in the live schema (`lib/db.ts:1381`). Per the hard rule "never edit existing DDL in place," this plan instead:

- Uses existing columns: `kind='shows'`, `status='partial'` when dropped count > 0, `rows_in` = total scanned, `rows_out` = total inserted.
- Emits one `data/audit/management-actions.jsonl` line per run with the structured `{run_id, counts_per_sheet, dropped: [...]}` payload via `lib/auditLog.mjs::logAuditAction()`.

This preserves the spec's intent (dropped rows are auditable) without DDL drift.

---

## Task 0: Worktree setup

**Files:**
- New worktree under `.claude-worktrees/`

- [ ] **Step 1: Create the worktree**

```bash
cd "$HOME/Dev/Lariat"
git worktree add -b feature/lariat2-phase4-narrow .claude-worktrees/phase4-narrow main
cd .claude-worktrees/phase4-narrow
```

- [ ] **Step 2: Verify worktree is clean**

Run: `git status`
Expected: `On branch feature/lariat2-phase4-narrow` · `nothing to commit, working tree clean`

- [ ] **Step 3: Install deps if needed (only if `node_modules` missing)**

Run: `[ -d node_modules ] || npm ci`
Expected: either no output (already installed) or successful `npm ci` completion.

(All remaining work happens inside `.claude-worktrees/phase4-narrow`.)

---

## Task 1: Schema — three new tables in `initSchema()`

**Files:**
- Modify: `lib/db.ts` (append inside `initSchema()`, just before its closing `}`)

- [ ] **Step 1: Locate the insertion point**

Run: `grep -n "^export function initSchema" lib/db.ts`
Expected: prints one line near `lib/db.ts:917`.

- [ ] **Step 2: Append the three tables**

Find the closing `}` of `initSchema()` (use `grep -n "^}" lib/db.ts` and pick the one that closes `initSchema`; in current code it is shortly after the last `CREATE INDEX` block within `initSchema`). Insert this block immediately before that closing brace:

```ts
  // ── Phase 4-narrow: shows / archive / tiktok ─────────────────────
  // Source-of-truth: drive-event-ops-dl/Lariat_Shows_MKT_Plan(...).xlsx
  // Lauren edits xlsx; `npm run ingest:shows` is the only mutation path.
  // Re-ingest is idempotent (DELETE+INSERT keyed on location_id).
  db.exec(`
    CREATE TABLE IF NOT EXISTS shows (
      id              INTEGER PRIMARY KEY,
      location_id     TEXT NOT NULL DEFAULT 'default',
      band_name       TEXT NOT NULL,
      show_date       TEXT NOT NULL,
      price           REAL,
      door_tix        TEXT,
      status_json     TEXT NOT NULL DEFAULT '{}',
      source_row      INTEGER NOT NULL,
      ingested_at     TEXT NOT NULL,
      ingest_run_id   INTEGER NOT NULL REFERENCES ingest_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_shows_date ON shows(location_id, show_date);
    CREATE INDEX IF NOT EXISTS idx_shows_band ON shows(location_id, band_name);

    CREATE TABLE IF NOT EXISTS shows_archive (
      id            INTEGER PRIMARY KEY,
      location_id   TEXT NOT NULL DEFAULT 'default',
      band_name     TEXT NOT NULL,
      show_date     TEXT NOT NULL,
      era_year      INTEGER,
      source_row    INTEGER NOT NULL,
      ingested_at   TEXT NOT NULL,
      ingest_run_id INTEGER NOT NULL REFERENCES ingest_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_shows_archive_date ON shows_archive(location_id, show_date);
    CREATE INDEX IF NOT EXISTS idx_shows_archive_band ON shows_archive(location_id, band_name);

    CREATE TABLE IF NOT EXISTS tiktok_ideas (
      id            INTEGER PRIMARY KEY,
      location_id   TEXT NOT NULL DEFAULT 'default',
      idea          TEXT NOT NULL,
      video_content TEXT,
      staff_needed  TEXT,
      props         TEXT,
      notes         TEXT,
      source_row    INTEGER NOT NULL,
      ingested_at   TEXT NOT NULL,
      ingest_run_id INTEGER NOT NULL REFERENCES ingest_runs(id)
    );
  `);
```

- [ ] **Step 3: Verify schema compiles + idempotency**

Run: `node --experimental-strip-types -e "import('./lib/db.ts').then(m => { const db = new (require('better-sqlite3'))(':memory:'); m.initSchema(db); m.initSchema(db); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('shows','shows_archive','tiktok_ideas') ORDER BY name\").all()); })"`
Expected: prints three rows: `shows`, `shows_archive`, `tiktok_ideas`. Second `initSchema` call does not throw.

- [ ] **Step 4: Commit**

```bash
git add lib/db.ts
git commit -m "shows: add shows / shows_archive / tiktok_ideas tables"
```

---

## Task 2: `lib/showStatus.ts` — failing test first

**Files:**
- Create: `tests/js/test-show-status.mjs`
- Create: `lib/showStatus.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/js/test-show-status.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusColor, pipelineStage, KNOWN_STAGES } from '../../lib/showStatus.ts';

test('statusColor: literal y → green', () => {
  assert.deepEqual(statusColor('y', 'meta_ads'), { color: 'green', label: 'y' });
});

test('statusColor: literal n → red', () => {
  assert.deepEqual(statusColor('n', 'meta_ads'), { color: 'red', label: 'n' });
});

test('statusColor: dash → neutral', () => {
  assert.deepEqual(statusColor('-', 'meta_ads'), { color: 'neutral', label: '—' });
});

test('statusColor: empty → neutral', () => {
  assert.deepEqual(statusColor('', 'meta_ads'), { color: 'neutral', label: '—' });
});

test('statusColor: pending → amber', () => {
  assert.deepEqual(statusColor('pending', 'co_host_sent'), { color: 'amber', label: 'pending' });
});

test('statusColor: w → amber (waiting)', () => {
  assert.deepEqual(statusColor('w', 'newsletter'), { color: 'amber', label: 'w' });
});

test('statusColor: accepted → green', () => {
  assert.deepEqual(statusColor('accepted', 'co_host_sent'), { color: 'green', label: 'accepted' });
});

test('statusColor: detail string preserved → green-with-detail', () => {
  assert.deepEqual(statusColor('jb, bit, sk', 'listing_jambase_bit_songkick'), {
    color: 'green',
    label: 'jb, bit, sk',
  });
});

test('statusColor: numeric posts → green with count label', () => {
  assert.deepEqual(statusColor('6.0', 'posts'), { color: 'green', label: '6' });
  assert.deepEqual(statusColor('0', 'posts'), { color: 'neutral', label: '—' });
});

test('statusColor: unknown value → green (Approach 1: never red on novelty)', () => {
  assert.deepEqual(statusColor('co-host accepted', 'co_host_sent'), {
    color: 'green',
    label: 'co-host accepted',
  });
});

test('pipelineStage: exhaustive — every fixture row maps to a known stage', () => {
  const fixtures = [
    {}, // all empty → Inquiry
    { announce_date: 'y' }, // announced → Hold
    { announce_date: 'y', meta_ads: 'y' }, // marketing started → Offer Out
    { announce_date: 'y', meta_ads: 'y', fb_event: 'y', assets: 'y' }, // → Confirmed
    { announce_date: 'y', meta_ads: 'y', fb_event: 'y', create_dice_tickets: 'y' }, // → On Sale
    { create_dice_tickets: 'y', dice_email: 'tix, dos' }, // → Settled
  ];
  for (const f of fixtures) {
    const stage = pipelineStage(f);
    assert.ok(KNOWN_STAGES.includes(stage), `${stage} not in KNOWN_STAGES`);
  }
});

test('KNOWN_STAGES is exactly the six expected stages', () => {
  assert.deepEqual(KNOWN_STAGES, [
    'Inquiry',
    'Hold',
    'Offer Out',
    'Confirmed',
    'On Sale',
    'Settled',
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-show-status.mjs`
Expected: FAIL — `Cannot find module '../../lib/showStatus.ts'`.

- [ ] **Step 3: Implement `lib/showStatus.ts`**

Create `lib/showStatus.ts`:

```ts
/**
 * Show-marketing status rule module.
 *
 * Single source of truth for: how a free-text status cell from Lauren's
 * xlsx renders as a color/label, and how a row's full status_json maps to
 * exactly one of the six pipeline stages.
 *
 * Design contract (Approach 1, Q4 in spec): unknown values render green
 * with their literal label (never red), so novel vocabulary doesn't break
 * the UI. Lauren is SoT.
 *
 * No I/O. No imports beyond types. Pure.
 */

export type StatusColor = 'green' | 'amber' | 'red' | 'neutral';

export interface StatusBadge {
  color: StatusColor;
  label: string;
}

export const KNOWN_STAGES = [
  'Inquiry',
  'Hold',
  'Offer Out',
  'Confirmed',
  'On Sale',
  'Settled',
] as const;
export type PipelineStage = (typeof KNOWN_STAGES)[number];

const AMBER_TOKENS = new Set(['pending', 'w', 'waiting', 'tentative']);
const GREEN_TOKENS = new Set(['y', 'yes', 'accepted', 'done', 'sent']);
const RED_TOKENS = new Set(['n', 'no']);
const NEUTRAL_TOKENS = new Set(['', '-', '–', '—', 'na', 'n/a']);

/**
 * Map a single status cell (raw xlsx string) to a color/label badge.
 * `column` is reserved for future column-specific rules (currently unused).
 */
export function statusColor(value: unknown, _column: string): StatusBadge {
  const raw = value == null ? '' : String(value).trim();
  const lower = raw.toLowerCase();

  if (NEUTRAL_TOKENS.has(lower)) return { color: 'neutral', label: '—' };
  if (RED_TOKENS.has(lower)) return { color: 'red', label: lower };
  if (AMBER_TOKENS.has(lower)) return { color: 'amber', label: lower };
  if (GREEN_TOKENS.has(lower)) return { color: 'green', label: lower };

  // Numeric strings ("6.0", "0", "12") → count semantics for posts/door_tix.
  const num = Number(raw);
  if (Number.isFinite(num)) {
    if (num <= 0) return { color: 'neutral', label: '—' };
    return { color: 'green', label: String(Math.round(num)) };
  }

  // Anything else: green-with-detail. Approach 1: never red on novelty.
  return { color: 'green', label: raw };
}

type StatusRow = Record<string, unknown>;

function isGreenish(v: unknown): boolean {
  const c = statusColor(v, '').color;
  return c === 'green';
}

/**
 * Map a row's full status_json to one pipeline stage. Exhaustive: every
 * input shape returns one of KNOWN_STAGES. Novel cell values never demote
 * the row below the stage it would have reached with `green`.
 *
 * Rule (top-down — first match wins):
 *   1. dice_email is greenish AND show is past → Settled
 *   2. create_dice_tickets is greenish → On Sale
 *   3. announce_date greenish AND any two of {meta_ads, fb_event, assets, posts} greenish → Confirmed
 *   4. announce_date greenish AND any one marketing field greenish → Offer Out
 *   5. announce_date greenish (alone) → Hold
 *   6. otherwise → Inquiry
 *
 * The "show is past" check in rule 1 is left to the caller (we don't
 * import a clock here); pass `showIsPast=true` from the repo when
 * `show_date < today()`.
 */
export function pipelineStage(
  row: StatusRow | null | undefined,
  showIsPast = false,
): PipelineStage {
  const r = row ?? {};
  if (showIsPast && isGreenish(r.dice_email)) return 'Settled';
  if (isGreenish(r.create_dice_tickets)) return 'On Sale';
  const announced = isGreenish(r.announce_date);
  if (announced) {
    const marketingHits = ['meta_ads', 'fb_event', 'assets', 'posts'].filter((k) =>
      isGreenish(r[k]),
    ).length;
    if (marketingHits >= 2) return 'Confirmed';
    if (marketingHits >= 1) return 'Offer Out';
    return 'Hold';
  }
  return 'Inquiry';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-show-status.mjs`
Expected: PASS — `# pass 12`, no failures.

- [ ] **Step 5: Commit**

```bash
git add lib/showStatus.ts tests/js/test-show-status.mjs
git commit -m "showStatus: pure rule module + tests"
```

---

## Task 3: Python parser fixture builder

**Files:**
- Create: `tests/python/fixtures/build_shows_fixture.py`
- Create: `tests/python/fixtures/__init__.py` (empty)
- Modify: `.gitignore`

- [ ] **Step 1: Add `__init__.py`**

Create `tests/python/fixtures/__init__.py`:

```python
```

(empty file; lets pytest treat `fixtures` as a package).

- [ ] **Step 2: Write the fixture builder**

Create `tests/python/fixtures/build_shows_fixture.py`:

```python
"""Build a deterministic minimal xlsx fixture for ingest_shows_xlsx tests.

Sheets:
- future: 5 rows (1 duplicate band, 1 with 'w' status, 1 with 'jb, bit, sk')
- past:   8 rows (year banners 2025 + 2024, 1 malformed missing date)
- tiktok plan: 3 structured + 1 idea-only-note row

The xlsx itself is gitignored; this script regenerates it on demand.
Run: python3 tests/python/fixtures/build_shows_fixture.py
"""
from __future__ import annotations

import datetime as _dt
from pathlib import Path

from openpyxl import Workbook

OUT = Path(__file__).parent / "shows_minimal.xlsx"


def build() -> Path:
    wb = Workbook()
    ws_future = wb.active
    ws_future.title = "future"

    # Header row matches the real workbook headers exactly.
    ws_future.append([
        "Band Name", "Date", "Media list", "MKTing adv", "Auto-counts",
        "Announce date", "Meta ads", "FB event", "Co-host sent",
        "create DICE tickets", "Listing on Jambase, BIT, Songkick",
        "DICE email (ticket sale, DOS)", "Newsletter (weekly, monthly)",
        "Assets", "Posts", "WHBV", "Door tix", "Price", None,
    ])

    # 5 data rows — only the trailing 18 cells; col 19 is None.
    ws_future.append([
        "openmic dinnershow", _dt.datetime(2026, 5, 1),
        "-", "-", "-", "-", "-", "y", "-", "y", "-", "-", "-", "y", "-", "n", "-", 0.0, None,
    ])
    ws_future.append([
        "openmic dinnershow", _dt.datetime(2026, 5, 8),  # duplicate band, different date
        "-", "-", "-", "-", "-", "y", "-", "y", "-", "-", "-", "y", "-", "n", "-", 0.0, None,
    ])
    ws_future.append([
        "armchair boogie", _dt.datetime(2026, 5, 15),
        "y", "y", "n", "y", "y", "y", "accepted", "y", "jb, bit, sk",
        "tix, dos", "w", "y", 6.0, "n", "y", 15.0, None,
    ])
    ws_future.append([
        "the bramble hollow", _dt.datetime(2026, 5, 22),
        "-", "y", "-", "y", "y", "y", "pending", "n", "-", "-", "-", "y", 0, "n", "-", 12.0, None,
    ])
    ws_future.append([
        "junior and the aces", _dt.datetime(2026, 6, 1),
        "y", "y", "y", "y", "y", "y", "y", "y", "jb, bit, sk", "tix, dos", "y", "y", 12.0, "y", "y", 18.0, None,
    ])

    # `past` sheet: year-banner row format, sparse columns.
    ws_past = wb.create_sheet("past")
    ws_past.append([2025])  # year banner row
    ws_past.append(["open mic", None, _dt.datetime(2025, 2, 26)])
    ws_past.append(["karaoke", None, _dt.datetime(2025, 2, 27)])
    ws_past.append(["pete n mark", None, _dt.datetime(2025, 2, 28)])
    ws_past.append(["malformed-no-date", None, None])  # dropped row
    ws_past.append([2024])  # year banner row
    ws_past.append(["the hip snacks", None, _dt.datetime(2024, 3, 1)])
    ws_past.append(["the whiskey sweets brunch", None, _dt.datetime(2024, 3, 2)])

    # `tiktok plan` sheet: 3 structured + 1 idea-only-note row.
    ws_tt = wb.create_sheet("tiktok plan")
    ws_tt.append(["idea", "video content", "staff needed", "props etc needed", None])
    ws_tt.append([
        "introducing your new favorite music venue",
        "walking around venue",
        "bartenders, band, crowd",
        "drinks being poured",
        None,
    ])
    ws_tt.append([
        "aesthetic cocktail recipe",
        "closeups behind bar",
        "lauren",
        "the bar",
        None,
    ])
    ws_tt.append([
        "almost forgot that this was the point",
        "clips from shows",
        "na",
        "na",
        "***can make this with existing videos",
    ])
    ws_tt.append([
        "thoughts on a 'lauren at the lariat' tiktok account",
        None, None, None, None,  # idea-only — routes to notes
    ])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    return OUT


if __name__ == "__main__":
    p = build()
    print(p)
```

- [ ] **Step 3: Run the builder once to verify it produces a valid xlsx**

Run: `python3 tests/python/fixtures/build_shows_fixture.py`
Expected: prints `tests/python/fixtures/shows_minimal.xlsx` and the file exists.

- [ ] **Step 4: Add the xlsx to .gitignore**

Append to `.gitignore`:

```
tests/python/fixtures/shows_minimal.xlsx
```

- [ ] **Step 5: Commit**

```bash
git add tests/python/fixtures/__init__.py tests/python/fixtures/build_shows_fixture.py .gitignore
git commit -m "shows: pytest fixture builder"
```

---

## Task 4: Python parser — failing test first

**Files:**
- Create: `tests/python/test_ingest_shows_xlsx.py`
- Create: `scripts/ingest_shows_xlsx.py`

- [ ] **Step 1: Write the failing test**

Create `tests/python/test_ingest_shows_xlsx.py`:

```python
"""Tests for scripts.ingest_shows_xlsx — pure parser, no DB writes.

Covers:
- 14 status keys snake-cased correctly
- past-sheet year banners propagate via era_year
- malformed past rows land in dropped[]
- ~$lock file → exit 3
- missing path → exit 2
- idea-only tiktok rows route to notes
- duplicate (band, date) preserved as separate rows in shows
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
PARSER = ROOT / "scripts" / "ingest_shows_xlsx.py"
FIXTURE = ROOT / "tests" / "python" / "fixtures" / "shows_minimal.xlsx"

sys.path.insert(0, str(ROOT))
from tests.python.fixtures.build_shows_fixture import build as build_fixture  # noqa: E402


@pytest.fixture(scope="module", autouse=True)
def _ensure_fixture():
    if not FIXTURE.exists():
        build_fixture()


def _run_parser(path: Path | str) -> tuple[int, dict]:
    proc = subprocess.run(
        [sys.executable, str(PARSER), str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        payload = json.loads(proc.stdout) if proc.stdout.strip() else {}
    except json.JSONDecodeError:
        payload = {"_raw": proc.stdout, "_stderr": proc.stderr}
    return proc.returncode, payload


def test_status_keys_snake_cased():
    code, p = _run_parser(FIXTURE)
    assert code == 0, p
    assert p["shows"], "expected at least one show row"
    armchair = next(s for s in p["shows"] if s["band_name"] == "armchair boogie")
    keys = set(armchair["status"].keys())
    expected = {
        "media_list", "mkting_adv", "auto_counts", "announce_date", "meta_ads",
        "fb_event", "co_host_sent", "create_dice_tickets",
        "listing_jambase_bit_songkick", "dice_email", "newsletter",
        "assets", "posts", "whbv",
    }
    assert keys == expected, f"unexpected status keys: {keys ^ expected}"
    assert armchair["status"]["listing_jambase_bit_songkick"] == "jb, bit, sk"
    assert armchair["status"]["newsletter"] == "w"
    assert armchair["price"] == 15.0


def test_past_sheet_era_year_propagates():
    code, p = _run_parser(FIXTURE)
    assert code == 0
    rows = {(r["band_name"], r["era_year"]) for r in p["shows_archive"]}
    assert ("the hip snacks", 2024) in rows
    assert ("open mic", 2025) in rows


def test_past_malformed_row_dropped():
    code, p = _run_parser(FIXTURE)
    assert code == 0
    archived_names = {r["band_name"] for r in p["shows_archive"]}
    assert "malformed-no-date" not in archived_names
    dropped_reasons = [d["reason"] for d in p["dropped"] if d["sheet"] == "past"]
    assert any("date" in r.lower() for r in dropped_reasons), p["dropped"]


def test_xlsx_lock_file_exit_3(tmp_path):
    fake_xlsx = tmp_path / "fake.xlsx"
    fake_xlsx.write_bytes(b"fake")
    lock = tmp_path / "~$fake.xlsx"
    lock.write_bytes(b"")
    code, p = _run_parser(fake_xlsx)
    assert code == 3, p
    assert p["error"] == "xlsx_locked"


def test_missing_xlsx_exit_2(tmp_path):
    code, p = _run_parser(tmp_path / "does-not-exist.xlsx")
    assert code == 2, p
    assert p["error"] == "xlsx_not_found"


def test_tiktok_idea_only_routes_to_notes():
    code, p = _run_parser(FIXTURE)
    assert code == 0
    note_rows = [t for t in p["tiktok_ideas"] if "lauren at the lariat" in t["idea"].lower()]
    assert len(note_rows) == 1
    assert note_rows[0]["video_content"] is None
    assert note_rows[0]["notes"] is None  # nothing to capture; idea itself holds the thought


def test_duplicate_band_date_preserved():
    code, p = _run_parser(FIXTURE)
    assert code == 0
    openmics = [s for s in p["shows"] if s["band_name"] == "openmic dinnershow"]
    assert len(openmics) == 2
    assert {s["show_date"] for s in openmics} == {"2026-05-01", "2026-05-08"}


def test_source_row_populated():
    code, p = _run_parser(FIXTURE)
    assert code == 0
    for row in p["shows"]:
        assert isinstance(row["source_row"], int)
        assert row["source_row"] >= 2  # row 1 is header
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/python/test_ingest_shows_xlsx.py -v`
Expected: FAIL — parser script does not exist; subprocess returns non-zero with empty stdout, tests assert `code == 0`.

- [ ] **Step 3: Implement the parser**

Create `scripts/ingest_shows_xlsx.py`:

```python
#!/usr/bin/env python3
"""Pure parser for Lariat Shows MKT Plan xlsx → JSON on stdout.

Exit codes:
  0  ok
  2  xlsx_not_found
  3  xlsx_locked (Excel `~$` lock file present)
  4  unrecoverable parse error

Output shape (stdout):
  {
    "shows":          [{band_name, show_date, price, door_tix, status: {...}, source_row}],
    "shows_archive":  [{band_name, show_date, era_year, source_row}],
    "tiktok_ideas":   [{idea, video_content, staff_needed, props, notes, source_row}],
    "dropped":        [{sheet, source_row, reason}]
  }

No DB writes. No side effects beyond stdout.
"""
from __future__ import annotations

import datetime as _dt
import json
import re
import sys
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

STATUS_KEYS = [
    "media_list", "mkting_adv", "auto_counts", "announce_date", "meta_ads",
    "fb_event", "co_host_sent", "create_dice_tickets",
    "listing_jambase_bit_songkick", "dice_email", "newsletter",
    "assets", "posts", "whbv",
]


def _emit(payload: dict[str, Any], code: int = 0) -> None:
    print(json.dumps(payload, default=str))
    sys.exit(code)


def _iso(d: Any) -> str | None:
    if isinstance(d, _dt.datetime):
        return d.date().isoformat()
    if isinstance(d, _dt.date):
        return d.isoformat()
    return None


def _str_or_none(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _parse_future(ws) -> tuple[list[dict], list[dict]]:
    shows: list[dict] = []
    dropped: list[dict] = []
    for idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        # Pad/truncate to length 18 (col 19 is the trailing None we ignore).
        cells = list(row)[:18] + [None] * max(0, 18 - len(row))
        band, date, *rest = cells
        if not band or not isinstance(band, str) or not band.strip():
            dropped.append({"sheet": "future", "source_row": idx, "reason": "missing band_name"})
            continue
        iso = _iso(date)
        if not iso:
            dropped.append({"sheet": "future", "source_row": idx, "reason": "missing or invalid date"})
            continue
        # Columns 3..16 (14 status cells), 17 = door_tix, 18 = price.
        status_cells = rest[:14]
        door_tix = _str_or_none(rest[14]) if len(rest) > 14 else None
        price = rest[15] if len(rest) > 15 else None
        if isinstance(price, str):
            try:
                price = float(price)
            except ValueError:
                price = None
        status = {
            STATUS_KEYS[i]: ("" if v is None else str(v).strip())
            for i, v in enumerate(status_cells)
        }
        shows.append({
            "band_name": band.strip(),
            "show_date": iso,
            "price": price if isinstance(price, (int, float)) else None,
            "door_tix": door_tix,
            "status": status,
            "source_row": idx,
        })
    return shows, dropped


def _parse_past(ws) -> tuple[list[dict], list[dict]]:
    archive: list[dict] = []
    dropped: list[dict] = []
    current_year: int | None = None
    for idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
        a = row[0] if len(row) > 0 else None
        c = row[2] if len(row) > 2 else None

        # Year banner: int/float-ish in col A and no date in col C
        if isinstance(a, (int, float)) and not isinstance(c, _dt.date):
            current_year = int(a)
            continue
        if isinstance(a, str) and re.fullmatch(r"\d{4}", a.strip()) and not isinstance(c, _dt.date):
            current_year = int(a.strip())
            continue

        # Data row: col A is band string, col C is date.
        if isinstance(a, str) and isinstance(c, (_dt.datetime, _dt.date)):
            archive.append({
                "band_name": a.strip(),
                "show_date": _iso(c),
                "era_year": current_year,
                "source_row": idx,
            })
            continue

        # Skip blanks silently; capture genuinely malformed (band but no date).
        if isinstance(a, str) and a.strip():
            dropped.append({
                "sheet": "past", "source_row": idx,
                "reason": "missing or invalid date for band",
            })
    return archive, dropped


def _parse_tiktok(ws) -> tuple[list[dict], list[dict]]:
    out: list[dict] = []
    dropped: list[dict] = []
    for idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        cells = list(row)[:5] + [None] * max(0, 5 - len(row))
        idea, video, staff, props, notes = cells
        idea_s = _str_or_none(idea)
        if not idea_s:
            continue
        out.append({
            "idea": idea_s,
            "video_content": _str_or_none(video),
            "staff_needed": _str_or_none(staff),
            "props": _str_or_none(props),
            "notes": _str_or_none(notes),
            "source_row": idx,
        })
    return out, dropped


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        _emit({"error": "usage", "msg": "ingest_shows_xlsx.py <path-to-xlsx>"}, code=2)
    path = Path(argv[1])
    if not path.exists():
        _emit({"error": "xlsx_not_found", "path": str(path)}, code=2)
    lock = path.parent / f"~${path.name}"
    if lock.exists():
        _emit({"error": "xlsx_locked", "lock": str(lock)}, code=3)

    try:
        wb = load_workbook(path, data_only=True, read_only=True)
        future_ws = wb["future"] if "future" in wb.sheetnames else None
        past_ws = wb["past"] if "past" in wb.sheetnames else None
        tiktok_ws = wb["tiktok plan"] if "tiktok plan" in wb.sheetnames else None

        shows, d1 = _parse_future(future_ws) if future_ws else ([], [])
        archive, d2 = _parse_past(past_ws) if past_ws else ([], [])
        tiktok, d3 = _parse_tiktok(tiktok_ws) if tiktok_ws else ([], [])
        wb.close()
    except Exception as e:  # parser failure
        _emit({"error": "parse_error", "msg": str(e)}, code=4)

    _emit({
        "shows": shows,
        "shows_archive": archive,
        "tiktok_ideas": tiktok,
        "dropped": d1 + d2 + d3,
    }, code=0)


if __name__ == "__main__":
    main(sys.argv)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/python/test_ingest_shows_xlsx.py -v`
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest_shows_xlsx.py tests/python/test_ingest_shows_xlsx.py
git commit -m "shows: Python parser for xlsx → JSON"
```

---

## Task 5: Node ingest wrapper — failing test first

**Files:**
- Create: `tests/js/test-shows-ingest.mjs`
- Create: `scripts/ingest-shows.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/js/test-shows-ingest.mjs`:

```js
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { initSchema } from '../../lib/db.ts';
import { ingestShowsFromJson } from '../../scripts/ingest-shows.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'tests', 'python', 'fixtures', 'shows_minimal.xlsx');

before(() => {
  // Make sure the fixture exists.
  execSync(`python3 ${path.join(ROOT, 'tests/python/fixtures/build_shows_fixture.py')}`, {
    stdio: 'pipe',
  });
});

function freshDb() {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function runFromFixture(db) {
  const json = execSync(
    `python3 ${path.join(ROOT, 'scripts/ingest_shows_xlsx.py')} ${FIXTURE}`,
    { encoding: 'utf8' },
  );
  return ingestShowsFromJson(db, JSON.parse(json), 'default');
}

test('ingestShowsFromJson: writes all three tables', () => {
  const db = freshDb();
  const summary = runFromFixture(db);
  assert.equal(summary.shows, 5);
  assert.equal(summary.shows_archive, 5);
  assert.equal(summary.tiktok_ideas, 4);
});

test('ingestShowsFromJson: re-run is idempotent (DELETE+INSERT)', () => {
  const db = freshDb();
  runFromFixture(db);
  const before = db.prepare('SELECT COUNT(*) AS n FROM shows').get().n;
  runFromFixture(db);
  const after = db.prepare('SELECT COUNT(*) AS n FROM shows').get().n;
  assert.equal(after, before, 'row count must not grow on re-ingest');
});

test('ingestShowsFromJson: writes one ingest_runs row with status', () => {
  const db = freshDb();
  runFromFixture(db);
  const runs = db.prepare(
    "SELECT * FROM ingest_runs WHERE kind='shows' ORDER BY id DESC",
  ).all();
  assert.equal(runs.length, 1);
  assert.ok(['ok', 'partial'].includes(runs[0].status), runs[0].status);
  assert.ok(runs[0].rows_in > 0);
  assert.ok(runs[0].rows_out > 0);
  assert.ok(runs[0].finished_at);
});

test('ingestShowsFromJson: dropped row → status="partial"', () => {
  const db = freshDb();
  runFromFixture(db);
  const run = db.prepare(
    "SELECT status FROM ingest_runs WHERE kind='shows' ORDER BY id DESC LIMIT 1",
  ).get();
  // Fixture has one malformed past row → exactly one drop.
  assert.equal(run.status, 'partial');
});

test('ingestShowsFromJson: empty payload yields status="ok" and zero counts', () => {
  const db = freshDb();
  const summary = ingestShowsFromJson(
    db,
    { shows: [], shows_archive: [], tiktok_ideas: [], dropped: [] },
    'default',
  );
  assert.equal(summary.shows, 0);
  const run = db.prepare(
    "SELECT status, rows_out FROM ingest_runs WHERE kind='shows' ORDER BY id DESC LIMIT 1",
  ).get();
  assert.equal(run.status, 'ok');
  assert.equal(run.rows_out, 0);
});

test('ingestShowsFromJson: failure aborts transaction (no partial rows)', () => {
  const db = freshDb();
  // Corrupt payload: missing required band_name on a row.
  const bad = {
    shows: [{ band_name: null, show_date: '2026-05-01', price: 0, door_tix: null, status: {}, source_row: 2 }],
    shows_archive: [],
    tiktok_ideas: [],
    dropped: [],
  };
  assert.throws(() => ingestShowsFromJson(db, bad, 'default'));
  const n = db.prepare('SELECT COUNT(*) AS n FROM shows').get().n;
  assert.equal(n, 0);
  const run = db.prepare(
    "SELECT status FROM ingest_runs WHERE kind='shows' ORDER BY id DESC LIMIT 1",
  ).get();
  assert.equal(run?.status, 'failed');
});

test('ingestShowsFromJson: status_json round-trips', () => {
  const db = freshDb();
  runFromFixture(db);
  const armchair = db.prepare(
    "SELECT status_json FROM shows WHERE band_name = 'armchair boogie'",
  ).get();
  const status = JSON.parse(armchair.status_json);
  assert.equal(status.listing_jambase_bit_songkick, 'jb, bit, sk');
  assert.equal(status.newsletter, 'w');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-shows-ingest.mjs`
Expected: FAIL — `Cannot find module '../../scripts/ingest-shows.mjs'`.

- [ ] **Step 3: Implement the wrapper**

Create `scripts/ingest-shows.mjs`:

```js
#!/usr/bin/env node
/**
 * Node wrapper for the Python shows-xlsx parser. Owns the DB transaction,
 * mirroring scripts/ingest-costing.mjs (DELETE+INSERT keyed on location_id).
 *
 * Usage: npm run ingest:shows [-- <xlsx-path>]
 *
 * Exit codes:
 *   0 ok / partial
 *   2 xlsx_not_found (from Python)
 *   3 xlsx_locked   (from Python)
 *   4 parse_error   (from Python)
 *   5 db error
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { initSchema, DB_FILE } from '../lib/db.ts';
import { logAuditAction } from '../lib/auditLog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PARSER = path.join(__dirname, 'ingest_shows_xlsx.py');
const DEFAULT_XLSX = path.join(
  ROOT, 'drive-event-ops-dl', "Lariat_Shows_MKT_Plan(Lauren's_Ingestion_Dice).xlsx",
);

/**
 * Public test entry-point: ingest a parsed payload into the given DB handle.
 * Caller owns the DB lifecycle. Throws on programming errors (corrupt
 * payload, DB error); never throws for "Lauren wrote weird text" cases —
 * those are surfaced via dropped[] + status='partial'.
 */
export function ingestShowsFromJson(db, payload, locationId = 'default') {
  if (!payload || typeof payload !== 'object') {
    throw new Error('ingestShowsFromJson: payload must be an object');
  }
  const { shows = [], shows_archive = [], tiktok_ideas = [], dropped = [] } = payload;

  const rowsIn =
    shows.length + shows_archive.length + tiktok_ideas.length + (dropped?.length ?? 0);

  const runInsert = db.prepare(
    `INSERT INTO ingest_runs (kind, started_at, status, rows_in)
     VALUES ('shows', datetime('now','subsec'), 'running', ?)`,
  );
  const runId = Number(runInsert.run(rowsIn).lastInsertRowid);

  const finalize = (status, rowsOut) => {
    try {
      db.prepare(
        `UPDATE ingest_runs
            SET finished_at = datetime('now','subsec'),
                status      = ?,
                rows_out    = ?
          WHERE id = ?`,
      ).run(status, rowsOut ?? null, runId);
    } catch {
      /* never mask the real error */
    }
  };

  const summary = { shows: 0, shows_archive: 0, tiktok_ideas: 0, dropped: dropped.length };

  try {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM shows         WHERE location_id = ?').run(locationId);
      db.prepare('DELETE FROM shows_archive WHERE location_id = ?').run(locationId);
      db.prepare('DELETE FROM tiktok_ideas  WHERE location_id = ?').run(locationId);

      const insShow = db.prepare(`
        INSERT INTO shows
          (location_id, band_name, show_date, price, door_tix, status_json,
           source_row, ingested_at, ingest_run_id)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, datetime('now','subsec'), ?)
      `);
      for (const r of shows) {
        if (!r.band_name || !r.show_date) {
          throw new Error(
            `ingestShowsFromJson: shows row missing required fields at source_row=${r.source_row}`,
          );
        }
        insShow.run(
          locationId, r.band_name, r.show_date, r.price ?? null, r.door_tix ?? null,
          JSON.stringify(r.status ?? {}), Number(r.source_row ?? 0), runId,
        );
        summary.shows += 1;
      }

      const insArc = db.prepare(`
        INSERT INTO shows_archive
          (location_id, band_name, show_date, era_year, source_row, ingested_at, ingest_run_id)
        VALUES (?, ?, ?, ?, ?, datetime('now','subsec'), ?)
      `);
      for (const r of shows_archive) {
        if (!r.band_name || !r.show_date) {
          throw new Error(
            `ingestShowsFromJson: archive row missing required fields at source_row=${r.source_row}`,
          );
        }
        insArc.run(
          locationId, r.band_name, r.show_date, r.era_year ?? null,
          Number(r.source_row ?? 0), runId,
        );
        summary.shows_archive += 1;
      }

      const insTt = db.prepare(`
        INSERT INTO tiktok_ideas
          (location_id, idea, video_content, staff_needed, props, notes,
           source_row, ingested_at, ingest_run_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','subsec'), ?)
      `);
      for (const r of tiktok_ideas) {
        if (!r.idea) {
          throw new Error(
            `ingestShowsFromJson: tiktok row missing idea at source_row=${r.source_row}`,
          );
        }
        insTt.run(
          locationId, r.idea, r.video_content ?? null, r.staff_needed ?? null,
          r.props ?? null, r.notes ?? null, Number(r.source_row ?? 0), runId,
        );
        summary.tiktok_ideas += 1;
      }
    });
    tx();
  } catch (err) {
    finalize('failed', null);
    throw err;
  }

  const rowsOut = summary.shows + summary.shows_archive + summary.tiktok_ideas;
  const status = (dropped?.length ?? 0) > 0 ? 'partial' : 'ok';
  finalize(status, rowsOut);

  logAuditAction({
    action: 'shows-xlsx-ingest',
    run_id: runId,
    location_id: locationId,
    counts: summary,
    dropped: dropped.slice(0, 200), // cap for log hygiene
  });

  return summary;
}

/* ── CLI entrypoint ─────────────────────────────────────────────────── */
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const xlsx = process.argv[2] || DEFAULT_XLSX;
  let json;
  try {
    json = execFileSync('python3', [PARSER, xlsx], { encoding: 'utf8' });
  } catch (e) {
    const out = (e.stdout || '').toString();
    process.stderr.write(out || e.message);
    process.exit(e.status ?? 4);
  }
  const payload = JSON.parse(json);
  const db = new Database(DB_FILE);
  initSchema(db);
  let summary;
  try {
    summary = ingestShowsFromJson(db, payload, 'default');
  } catch (e) {
    process.stderr.write(`shows ingest failed: ${e.message}\n`);
    process.exit(5);
  } finally {
    db.close();
  }
  const droppedN = (payload.dropped || []).length;
  process.stdout.write(
    `shows: ${summary.shows}  archive: ${summary.shows_archive}  tiktok: ${summary.tiktok_ideas}` +
    (droppedN ? `  dropped: ${droppedN} (see data/audit/management-actions.jsonl)` : '') +
    '\n',
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-shows-ingest.mjs`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-shows.mjs tests/js/test-shows-ingest.mjs
git commit -m "shows: Node ingest wrapper with transactional writes"
```

---

## Task 6: `lib/showsRepo.ts` — failing test first

**Files:**
- Create: `tests/js/test-shows-repo.mjs`
- Create: `lib/showsRepo.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/js/test-shows-repo.mjs`:

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { initSchema } from '../../lib/db.ts';
import { ingestShowsFromJson } from '../../scripts/ingest-shows.mjs';
import {
  upcomingShows, pipelineCounts, archiveSearch, getShowById, nextUpcoming,
} from '../../lib/showsRepo.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'tests', 'python', 'fixtures', 'shows_minimal.xlsx');

let db;

beforeEach(() => {
  execSync(`python3 ${path.join(ROOT, 'tests/python/fixtures/build_shows_fixture.py')}`, {
    stdio: 'pipe',
  });
  db = new Database(':memory:');
  initSchema(db);
  const json = execSync(
    `python3 ${path.join(ROOT, 'scripts/ingest_shows_xlsx.py')} ${FIXTURE}`,
    { encoding: 'utf8' },
  );
  ingestShowsFromJson(db, JSON.parse(json), 'default');
});

test('upcomingShows: respects 35-day window from a fixed today', () => {
  // Fixture rows: 2026-05-01, 05-08, 05-15, 05-22, 06-01.
  const rows = upcomingShows(db, 'default', { today: '2026-04-25', weeks: 5 });
  // 5 weeks = 35 days → through 2026-05-30. Expect 4 rows (drops 06-01).
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => r.show_date),
    ['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22'],
  );
});

test('upcomingShows: scoped by location_id', () => {
  const other = upcomingShows(db, 'other-location', { today: '2026-04-25', weeks: 5 });
  assert.equal(other.length, 0);
});

test('pipelineCounts: sums to total upcoming', () => {
  const counts = pipelineCounts(db, 'default', { today: '2026-04-25', weeks: 52 });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const upcoming = upcomingShows(db, 'default', { today: '2026-04-25', weeks: 52 });
  assert.equal(total, upcoming.length);
});

test('pipelineCounts: every key is a known stage', () => {
  const counts = pipelineCounts(db, 'default', { today: '2026-04-25', weeks: 52 });
  const expected = ['Inquiry', 'Hold', 'Offer Out', 'Confirmed', 'On Sale', 'Settled'];
  assert.deepEqual(Object.keys(counts).sort(), expected.sort());
});

test('archiveSearch: filters by band substring', () => {
  const rows = archiveSearch(db, 'default', { q: 'whiskey' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].band_name, 'the whiskey sweets brunch');
});

test('archiveSearch: filters by era_year', () => {
  const rows = archiveSearch(db, 'default', { era: 2024 });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.era_year === 2024));
});

test('getShowById: returns parsed status and null for missing id', () => {
  const all = upcomingShows(db, 'default', { today: '2026-04-25', weeks: 52 });
  const one = getShowById(db, 'default', all[0].id);
  assert.equal(one.id, all[0].id);
  assert.ok(one.status); // parsed object, not string
  assert.equal(typeof one.status, 'object');
  assert.equal(getShowById(db, 'default', 999999), null);
});

test('nextUpcoming: returns soonest future show or null', () => {
  const n = nextUpcoming(db, 'default', { today: '2026-04-25' });
  assert.equal(n.show_date, '2026-05-01');
  const none = nextUpcoming(db, 'default', { today: '2030-01-01' });
  assert.equal(none, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-shows-repo.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/showsRepo.ts`**

Create `lib/showsRepo.ts`:

```ts
/**
 * Read-only query layer over shows / shows_archive / tiktok_ideas.
 *
 * Stable contract: callers pass `today` (ISO date) explicitly so tests
 * are deterministic. Production callers default to today's date.
 */
import type Database from 'better-sqlite3';
import { pipelineStage, KNOWN_STAGES, type PipelineStage } from './showStatus';

type DB = Database.Database;

export interface ShowRow {
  id: number;
  band_name: string;
  show_date: string;
  price: number | null;
  door_tix: string | null;
  status: Record<string, string>;
  source_row: number;
}

export interface ArchiveRow {
  id: number;
  band_name: string;
  show_date: string;
  era_year: number | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function rowToShow(r: any): ShowRow {
  return {
    id: r.id,
    band_name: r.band_name,
    show_date: r.show_date,
    price: r.price,
    door_tix: r.door_tix,
    status: r.status_json ? JSON.parse(r.status_json) : {},
    source_row: r.source_row,
  };
}

export function upcomingShows(
  db: DB,
  locationId: string,
  opts: { today?: string; weeks?: number } = {},
): ShowRow[] {
  const today = opts.today ?? todayIso();
  const weeks = opts.weeks ?? 5;
  const upper = addDays(today, weeks * 7);
  const rows = db
    .prepare(
      `SELECT * FROM shows
        WHERE location_id = ?
          AND show_date >= ?
          AND show_date <= ?
        ORDER BY show_date ASC, id ASC`,
    )
    .all(locationId, today, upper) as any[];
  return rows.map(rowToShow);
}

export function pipelineCounts(
  db: DB,
  locationId: string,
  opts: { today?: string; weeks?: number } = {},
): Record<PipelineStage, number> {
  const today = opts.today ?? todayIso();
  const counts: Record<string, number> = {};
  for (const s of KNOWN_STAGES) counts[s] = 0;
  const rows = upcomingShows(db, locationId, { today, weeks: opts.weeks ?? 52 });
  for (const r of rows) {
    const past = r.show_date < today;
    counts[pipelineStage(r.status, past)] += 1;
  }
  return counts as Record<PipelineStage, number>;
}

export function archiveSearch(
  db: DB,
  locationId: string,
  opts: { q?: string; era?: number } = {},
): ArchiveRow[] {
  const clauses: string[] = ['location_id = ?'];
  const params: any[] = [locationId];
  if (opts.q && opts.q.trim()) {
    clauses.push('band_name LIKE ?');
    params.push(`%${opts.q.trim()}%`);
  }
  if (opts.era != null) {
    clauses.push('era_year = ?');
    params.push(opts.era);
  }
  const rows = db
    .prepare(
      `SELECT id, band_name, show_date, era_year
         FROM shows_archive
        WHERE ${clauses.join(' AND ')}
        ORDER BY show_date DESC, id DESC`,
    )
    .all(...params) as ArchiveRow[];
  return rows;
}

export function archiveEras(db: DB, locationId: string): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT era_year FROM shows_archive
        WHERE location_id = ? AND era_year IS NOT NULL
        ORDER BY era_year DESC`,
    )
    .all(locationId) as any[];
  return rows.map((r) => r.era_year);
}

export function getShowById(db: DB, locationId: string, id: number): ShowRow | null {
  const row = db
    .prepare('SELECT * FROM shows WHERE location_id = ? AND id = ?')
    .get(locationId, id) as any;
  return row ? rowToShow(row) : null;
}

export function nextUpcoming(
  db: DB,
  locationId: string,
  opts: { today?: string } = {},
): ShowRow | null {
  const today = opts.today ?? todayIso();
  const row = db
    .prepare(
      `SELECT * FROM shows
        WHERE location_id = ? AND show_date >= ?
        ORDER BY show_date ASC, id ASC LIMIT 1`,
    )
    .get(locationId, today) as any;
  return row ? rowToShow(row) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-shows-repo.mjs`
Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/showsRepo.ts tests/js/test-shows-repo.mjs
git commit -m "showsRepo: read-only query layer + tests"
```

---

## Task 7: `app/api/shows/route.js` — failing test first

**Files:**
- Create: `tests/js/test-shows-api.mjs`
- Create: `app/api/shows/route.js`

- [ ] **Step 1: Write the failing test**

Create `tests/js/test-shows-api.mjs`:

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { initSchema, setDbPathForTest } from '../../lib/db.ts';
import { ingestShowsFromJson } from '../../scripts/ingest-shows.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'tests', 'python', 'fixtures', 'shows_minimal.xlsx');

const TMP_DB = path.join(ROOT, 'tests', 'js', `.tmp-shows-${process.pid}.db`);

beforeEach(() => {
  execSync(`python3 ${path.join(ROOT, 'tests/python/fixtures/build_shows_fixture.py')}`, {
    stdio: 'pipe',
  });
  try { require('fs').rmSync(TMP_DB, { force: true }); } catch {}
  setDbPathForTest(TMP_DB);
  const db = new Database(TMP_DB);
  initSchema(db);
  const json = execSync(
    `python3 ${path.join(ROOT, 'scripts/ingest_shows_xlsx.py')} ${FIXTURE}`,
    { encoding: 'utf8' },
  );
  ingestShowsFromJson(db, JSON.parse(json), 'default');
  db.close();
});

async function fetchRoute(query = '') {
  const { GET } = await import('../../app/api/shows/route.js');
  const req = new Request(`http://localhost/api/shows${query ? '?' + query : ''}`);
  return GET(req);
}

test('op=upcoming returns rows with parsed status', async () => {
  const res = await fetchRoute('op=upcoming&today=2026-04-25&weeks=5');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.rows));
  assert.ok(body.rows.length >= 4);
  assert.equal(typeof body.rows[0].status, 'object');
});

test('op=playbook&show=<id> returns one row', async () => {
  const list = await (await fetchRoute('op=upcoming&today=2026-04-25')).json();
  const id = list.rows[0].id;
  const res = await fetchRoute(`op=playbook&show=${id}&today=2026-04-25`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.row.id, id);
});

test('op=playbook&show=<missing> → 404', async () => {
  const res = await fetchRoute('op=playbook&show=999999');
  assert.equal(res.status, 404);
});

test('op=archive&q= filters', async () => {
  const res = await fetchRoute('op=archive&q=whiskey');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rows.length, 1);
});

test('op=archive&era= filters', async () => {
  const res = await fetchRoute('op=archive&era=2024');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.rows.every((r) => r.era_year === 2024));
});

test('invalid op → 400', async () => {
  const res = await fetchRoute('op=nope');
  assert.equal(res.status, 400);
});

test('missing op → 400', async () => {
  const res = await fetchRoute('');
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-shows-api.mjs`
Expected: FAIL — `Cannot find module '../../app/api/shows/route.js'`.

- [ ] **Step 3: Implement the route**

Create `app/api/shows/route.js`:

```js
/**
 * GET /api/shows
 *   ?op=upcoming&today=&weeks=         → list upcoming shows
 *   ?op=playbook&show=<id>&today=      → one show with parsed status
 *   ?op=archive&q=&era=                → archive search
 *
 * PIN gating is performed by middleware.js (route registers in
 * SENSITIVE_PREFIXES). This handler trusts the gate.
 */
import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { DB_FILE, initSchema } from '../../../lib/db';
import {
  upcomingShows, pipelineCounts, archiveSearch, archiveEras, getShowById,
} from '../../../lib/showsRepo';
import { locationFromRequest } from '../../../lib/location';

function open() {
  const db = new Database(DB_FILE);
  initSchema(db);
  return db;
}

export async function GET(req) {
  const url = new URL(req.url);
  const op = url.searchParams.get('op');
  const today = url.searchParams.get('today') || undefined;
  const loc = locationFromRequest(req);

  const db = open();
  try {
    if (op === 'upcoming') {
      const weeks = Number(url.searchParams.get('weeks') ?? 5) || 5;
      const rows = upcomingShows(db, loc, { today, weeks });
      const counts = pipelineCounts(db, loc, { today, weeks: 52 });
      return NextResponse.json({ rows, counts });
    }
    if (op === 'playbook') {
      const id = Number(url.searchParams.get('show'));
      if (!Number.isFinite(id) || id <= 0) {
        return NextResponse.json({ error: 'invalid show id' }, { status: 400 });
      }
      const row = getShowById(db, loc, id);
      if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json({ row });
    }
    if (op === 'archive') {
      const q = url.searchParams.get('q') ?? undefined;
      const eraStr = url.searchParams.get('era');
      const era = eraStr ? Number(eraStr) : undefined;
      const rows = archiveSearch(db, loc, { q, era });
      const eras = archiveEras(db, loc);
      return NextResponse.json({ rows, eras });
    }
    return NextResponse.json(
      { error: 'invalid op (expected upcoming|playbook|archive)' },
      { status: 400 },
    );
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-shows-api.mjs`
Expected: PASS — 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add app/api/shows/route.js tests/js/test-shows-api.mjs
git commit -m "shows api: GET upcoming|playbook|archive"
```

---

## Task 8: PIN gate — register the new prefixes

**Files:**
- Modify: `middleware.js`

- [ ] **Step 1: Add the prefixes**

Edit `middleware.js`. Inside `SENSITIVE_PREFIXES`, add four entries:

```js
const SENSITIVE_PREFIXES = [
  '/analytics',
  '/costing',
  '/purchasing',
  '/menu-engineering',
  '/beo',
  '/management',
  '/booking',
  '/playbook',
  '/shows',
  '/api/costing',
  '/api/analytics',
  '/api/menu-engineering',
  '/api/beo',
  '/api/audit',
  '/api/compute',
  '/api/shows',
];
```

Inside `config.matcher`, add four matchers:

```js
export const config = {
  matcher: [
    '/analytics/:path*',
    '/costing/:path*',
    '/purchasing/:path*',
    '/menu-engineering/:path*',
    '/beo/:path*',
    '/management/:path*',
    '/booking/:path*',
    '/playbook/:path*',
    '/shows/:path*',
    '/login-pin',
    '/api/costing/:path*',
    '/api/analytics/:path*',
    '/api/menu-engineering/:path*',
    '/api/beo/:path*',
    '/api/audit/:path*',
    '/api/compute/:path*',
    '/api/shows/:path*',
  ],
};
```

- [ ] **Step 2: Verify the file parses**

Run: `node -e "import('./middleware.js').then(m => console.log(Object.keys(m).sort()))"`
Expected: `['config','default','middleware']` (or includes `middleware`).

- [ ] **Step 3: Commit**

```bash
git add middleware.js
git commit -m "shows: PIN-gate /booking, /playbook, /shows, /api/shows"
```

---

## Task 9: `<StatusPill>` component + Jest test

**Files:**
- Create: `app/playbook/StatusPill.jsx`
- Create: `app/__tests__/StatusPill.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/StatusPill.test.jsx`:

```jsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import StatusPill from '../playbook/StatusPill';

describe('StatusPill', () => {
  test.each([
    ['y', 'meta_ads', 'pill-green'],
    ['n', 'meta_ads', 'pill-red'],
    ['-', 'meta_ads', 'pill-neutral'],
    ['', 'meta_ads', 'pill-neutral'],
    ['pending', 'co_host_sent', 'pill-amber'],
    ['w', 'newsletter', 'pill-amber'],
    ['jb, bit, sk', 'listing_jambase_bit_songkick', 'pill-green'],
    ['6.0', 'posts', 'pill-green'],
  ])('value %j on column %j gets class %s', (value, column, klass) => {
    const { container } = render(<StatusPill value={value} column={column} />);
    expect(container.firstChild).toHaveClass(klass);
  });

  test('renders the literal label for detail strings', () => {
    render(<StatusPill value="jb, bit, sk" column="listing_jambase_bit_songkick" />);
    expect(screen.getByText('jb, bit, sk')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest app/__tests__/StatusPill.test.jsx`
Expected: FAIL — `Cannot find module '../playbook/StatusPill'`.

- [ ] **Step 3: Implement the component**

Create `app/playbook/StatusPill.jsx`:

```jsx
'use client';
import React from 'react';
import { statusColor } from '../../lib/showStatus';

export default function StatusPill({ value, column }) {
  const { color, label } = statusColor(value, column);
  return (
    <span className={`pill pill-${color}`} title={`${column}: ${value ?? '—'}`}>
      {label}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest app/__tests__/StatusPill.test.jsx`
Expected: PASS — 9 assertions passing.

- [ ] **Step 5: Commit**

```bash
git add app/playbook/StatusPill.jsx app/__tests__/StatusPill.test.jsx
git commit -m "playbook: StatusPill component"
```

---

## Task 10: BookingCalendar component + Jest test

**Files:**
- Create: `app/booking/BookingCalendar.jsx`
- Create: `app/__tests__/BookingCalendar.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/BookingCalendar.test.jsx`:

```jsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BookingCalendar from '../booking/BookingCalendar';

const ROWS = [
  {
    id: 1, band_name: 'armchair boogie', show_date: '2026-05-15',
    price: 15.0, door_tix: 'y', status: { announce_date: 'y', meta_ads: 'y' }, source_row: 4,
  },
  {
    id: 2, band_name: 'the bramble hollow', show_date: '2026-05-22',
    price: 12.0, door_tix: '-', status: {}, source_row: 5,
  },
];

describe('BookingCalendar', () => {
  test('renders one <tr> per row', () => {
    render(<BookingCalendar rows={ROWS} />);
    expect(screen.getAllByRole('row')).toHaveLength(ROWS.length + 1); // +header
  });

  test('shows placeholder for missing cap/sold', () => {
    render(<BookingCalendar rows={ROWS} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  test('shows footer note about ticketing data', () => {
    render(<BookingCalendar rows={ROWS} />);
    expect(screen.getByText(/ticketing data not yet wired/i)).toBeInTheDocument();
  });

  test('renders empty-state banner when no rows', () => {
    render(<BookingCalendar rows={[]} />);
    expect(screen.getByText(/no shows ingested yet/i)).toBeInTheDocument();
  });

  test('row link points to /playbook?show=<id>', () => {
    render(<BookingCalendar rows={ROWS} />);
    const link = screen.getByRole('link', { name: /armchair boogie/i });
    expect(link).toHaveAttribute('href', '/playbook?show=1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest app/__tests__/BookingCalendar.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `app/booking/BookingCalendar.jsx`:

```jsx
'use client';
import React from 'react';
import Link from 'next/link';

const fmtUSD = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
const fmtDate = (iso) => {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

export default function BookingCalendar({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="serif" style={{ fontSize: 22, marginBottom: 6 }}>
          No shows ingested yet
        </div>
        <div className="row-meta">
          Run <code>npm run ingest:shows</code> after Lauren updates the workbook.
        </div>
      </div>
    );
  }
  return (
    <div className="card flush">
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 110 }}>Date</th>
            <th>Artist</th>
            <th className="num">Cap</th>
            <th className="num">Sold</th>
            <th>Sell-thru</th>
            <th className="num">Price</th>
            <th>Door</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="mono">{fmtDate(r.show_date)}</td>
              <td>
                <Link href={`/playbook?show=${r.id}`}>{r.band_name}</Link>
              </td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td>—</td>
              <td className="num">{fmtUSD(r.price)}</td>
              <td>{r.door_tix ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-meta" style={{ padding: '8px 14px' }}>
        Cap / Sold / Sell-thru — ticketing data not yet wired (DICE integration deferred).
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest app/__tests__/BookingCalendar.test.jsx`
Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add app/booking/BookingCalendar.jsx app/__tests__/BookingCalendar.test.jsx
git commit -m "booking: BookingCalendar component"
```

---

## Task 11: BookingPipeline component

**Files:**
- Create: `app/booking/BookingPipeline.jsx`

(No dedicated Jest test — this component is purely presentational over `pipelineCounts()` output, which is already pinned by the repo test. We do an inline render assertion at the end of Task 12.)

- [ ] **Step 1: Implement the component**

Create `app/booking/BookingPipeline.jsx`:

```jsx
'use client';
import React from 'react';

const STAGES = ['Inquiry', 'Hold', 'Offer Out', 'Confirmed', 'On Sale', 'Settled'];

export default function BookingPipeline({ counts }) {
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(${STAGES.length},1fr)`, gap: 8 }}
    >
      {STAGES.map((s, i) => (
        <div
          key={s}
          className="card"
          style={{ padding: '12px 14px', position: 'relative', background: i >= 4 ? 'var(--cream)' : 'var(--paper)' }}
        >
          <div className="row-meta" style={{ fontSize: 10, letterSpacing: '.16em' }}>
            STAGE {i + 1}
          </div>
          <div className="serif" style={{ fontSize: 34, lineHeight: 1 }}>
            {counts?.[s] ?? 0}
          </div>
          <div style={{ fontWeight: 600, marginTop: 4 }}>{s}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/booking/BookingPipeline.jsx
git commit -m "booking: BookingPipeline component"
```

---

## Task 12: `/booking` server page

**Files:**
- Create: `app/booking/page.jsx`

- [ ] **Step 1: Implement the page**

Create `app/booking/page.jsx`:

```jsx
import Database from 'better-sqlite3';
import { DB_FILE, initSchema } from '../../lib/db';
import { upcomingShows, pipelineCounts } from '../../lib/showsRepo';
import BookingCalendar from './BookingCalendar';
import BookingPipeline from './BookingPipeline';

export const dynamic = 'force-dynamic';

export default function BookingPage() {
  // Server-side; new connection per request keeps it cheap and stateless.
  const db = new Database(DB_FILE);
  initSchema(db);
  const today = new Date().toISOString().slice(0, 10);
  const rows = upcomingShows(db, 'default', { today, weeks: 5 });
  const counts = pipelineCounts(db, 'default', { today, weeks: 52 });
  db.close();

  return (
    <div className="page">
      <header style={{ marginBottom: 18 }}>
        <div className="row-meta" style={{ letterSpacing: '.18em' }}>BOOKING</div>
        <h1 className="serif" style={{ fontSize: 38, lineHeight: 1.1 }}>
          The <em>calendar</em>
        </h1>
        <div className="row-meta">Five weeks ahead — click an artist to open the playbook.</div>
      </header>
      <section style={{ marginBottom: 24 }}>
        <div className="sec-head">
          <div className="sec-title">Booking pipeline</div>
          <div className="sec-sub">live count by stage</div>
        </div>
        <BookingPipeline counts={counts} />
      </section>
      <section>
        <div className="sec-head">
          <div className="sec-title">Five weeks ahead</div>
          <div className="sec-sub">{rows.length} confirmed shows</div>
        </div>
        <BookingCalendar rows={rows} />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Smoke-render check**

Run: `npm run build 2>&1 | tail -40`
Expected: build succeeds; `/booking` appears in the output's route list. (If TS errors surface, fix them in `lib/showsRepo.ts` or `lib/showStatus.ts` before continuing.)

- [ ] **Step 3: Commit**

```bash
git add app/booking/page.jsx
git commit -m "booking: server page composing calendar + pipeline"
```

---

## Task 13: Playbook tab components + Jest test

**Files:**
- Create: `app/playbook/tabs/AdsTab.jsx`
- Create: `app/playbook/tabs/TicketsTab.jsx`
- Create: `app/playbook/tabs/NewsTab.jsx`
- Create: `app/playbook/tabs/DayOfTab.jsx`
- Create: `app/__tests__/PlaybookTabs.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/PlaybookTabs.test.jsx`:

```jsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import AdsTab from '../playbook/tabs/AdsTab';
import TicketsTab from '../playbook/tabs/TicketsTab';
import NewsTab from '../playbook/tabs/NewsTab';
import DayOfTab from '../playbook/tabs/DayOfTab';

const SHOW = {
  id: 3,
  band_name: 'armchair boogie',
  show_date: '2026-05-15',
  price: 15.0,
  door_tix: 'y',
  status: {
    media_list: 'y', mkting_adv: 'y', auto_counts: 'n', announce_date: 'y',
    meta_ads: 'y', fb_event: 'y', co_host_sent: 'accepted',
    create_dice_tickets: 'y', listing_jambase_bit_songkick: 'jb, bit, sk',
    dice_email: 'tix, dos', newsletter: 'w', assets: 'y',
    posts: '6', whbv: 'n',
  },
};

describe('Playbook tabs', () => {
  test('AdsTab renders one pill per ad checklist key', () => {
    render(<AdsTab show={SHOW} />);
    // 5 ad-related fields: media_list, mkting_adv, meta_ads, fb_event, listing_jambase_bit_songkick
    expect(screen.getAllByText(/^(y|n|—|jb, bit, sk)$/).length).toBeGreaterThanOrEqual(5);
  });

  test('TicketsTab shows price + door + create_dice_tickets pill', () => {
    render(<TicketsTab show={SHOW} />);
    expect(screen.getByText(/\$15\.00/)).toBeInTheDocument();
    expect(screen.getByText(/door/i)).toBeInTheDocument();
  });

  test('NewsTab renders the newsletter pill (amber for "w")', () => {
    const { container } = render(<NewsTab show={SHOW} />);
    expect(container.querySelector('.pill-amber')).toBeTruthy();
  });

  test('DayOfTab renders dice_email + assets + posts', () => {
    render(<DayOfTab show={SHOW} />);
    expect(screen.getByText(/day of/i)).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument(); // posts count
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest app/__tests__/PlaybookTabs.test.jsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `AdsTab.jsx`**

Create `app/playbook/tabs/AdsTab.jsx`:

```jsx
'use client';
import React from 'react';
import StatusPill from '../StatusPill';

const FIELDS = [
  { key: 'media_list', label: 'Media list' },
  { key: 'mkting_adv', label: 'Marketing advance' },
  { key: 'meta_ads', label: 'Meta ads' },
  { key: 'fb_event', label: 'FB event' },
  { key: 'listing_jambase_bit_songkick', label: 'Jambase / BIT / Songkick' },
];

export default function AdsTab({ show }) {
  const s = show?.status ?? {};
  return (
    <div className="card" style={{ padding: 14 }}>
      <table className="tbl">
        <tbody>
          {FIELDS.map((f) => (
            <tr key={f.key}>
              <td>{f.label}</td>
              <td><StatusPill value={s[f.key]} column={f.key} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Implement `TicketsTab.jsx`**

Create `app/playbook/tabs/TicketsTab.jsx`:

```jsx
'use client';
import React from 'react';
import StatusPill from '../StatusPill';

export default function TicketsTab({ show }) {
  const s = show?.status ?? {};
  const price = show?.price == null ? '—' : `$${Number(show.price).toFixed(2)}`;
  return (
    <div className="card" style={{ padding: 14 }}>
      <table className="tbl">
        <tbody>
          <tr>
            <td>Advance ticket price</td>
            <td className="mono">{price}</td>
          </tr>
          <tr>
            <td>Door price (door tix)</td>
            <td><StatusPill value={show?.door_tix} column="door_tix" /></td>
          </tr>
          <tr>
            <td>DICE tickets created</td>
            <td><StatusPill value={s.create_dice_tickets} column="create_dice_tickets" /></td>
          </tr>
          <tr>
            <td>Co-host sent</td>
            <td><StatusPill value={s.co_host_sent} column="co_host_sent" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Implement `NewsTab.jsx`**

Create `app/playbook/tabs/NewsTab.jsx`:

```jsx
'use client';
import React from 'react';
import StatusPill from '../StatusPill';

export default function NewsTab({ show }) {
  const s = show?.status ?? {};
  return (
    <div className="card" style={{ padding: 14 }}>
      <table className="tbl">
        <tbody>
          <tr>
            <td>Newsletter included</td>
            <td><StatusPill value={s.newsletter} column="newsletter" /></td>
          </tr>
          <tr>
            <td>Announce date</td>
            <td><StatusPill value={s.announce_date} column="announce_date" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Implement `DayOfTab.jsx`**

Create `app/playbook/tabs/DayOfTab.jsx`:

```jsx
'use client';
import React from 'react';
import StatusPill from '../StatusPill';

const FIELDS = [
  { key: 'dice_email', label: 'DICE email (tix, DOS)' },
  { key: 'assets', label: 'Assets ready' },
  { key: 'posts', label: 'Posts' },
  { key: 'whbv', label: 'WHBV' },
];

export default function DayOfTab({ show }) {
  const s = show?.status ?? {};
  return (
    <div className="card" style={{ padding: 14 }}>
      <header className="row-meta" style={{ marginBottom: 8, letterSpacing: '.18em' }}>
        DAY OF
      </header>
      <table className="tbl">
        <tbody>
          {FIELDS.map((f) => (
            <tr key={f.key}>
              <td>{f.label}</td>
              <td><StatusPill value={s[f.key]} column={f.key} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest app/__tests__/PlaybookTabs.test.jsx`
Expected: PASS — 4 tests passing.

- [ ] **Step 8: Commit**

```bash
git add app/playbook/tabs app/__tests__/PlaybookTabs.test.jsx
git commit -m "playbook: Ads/Tickets/News/DayOf tab components"
```

---

## Task 14: `<PlaybookHeader>` + `/playbook` server page

**Files:**
- Create: `app/playbook/PlaybookHeader.jsx`
- Create: `app/playbook/page.jsx`

- [ ] **Step 1: Implement `PlaybookHeader.jsx`**

Create `app/playbook/PlaybookHeader.jsx`:

```jsx
'use client';
import React from 'react';
import Link from 'next/link';

const TABS = [
  { k: 'ads', l: 'Ad checklist' },
  { k: 'tickets', l: 'Tickets' },
  { k: 'news', l: 'Newsletter' },
  { k: 'dayof', l: 'Day of event' },
];

export default function PlaybookHeader({ show, activeTab }) {
  if (!show) return null;
  return (
    <header style={{ marginBottom: 18 }}>
      <div className="row-meta" style={{ letterSpacing: '.18em' }}>
        SHOW MARKETING · PLAYBOOK
      </div>
      <h1 className="serif" style={{ fontSize: 38, lineHeight: 1.1 }}>
        {show.band_name}
      </h1>
      <div className="row-meta">
        {show.show_date} · <Link href="/booking">switch show</Link>
      </div>
      <nav className="toggles" style={{ marginTop: 14 }}>
        {TABS.map((t) => (
          <Link
            key={t.k}
            className={`btn sm ${activeTab === t.k ? 'primary' : ''}`}
            href={`/playbook?show=${show.id}&tab=${t.k}`}
          >
            {t.l}
          </Link>
        ))}
      </nav>
    </header>
  );
}
```

- [ ] **Step 2: Implement `/playbook` page**

Create `app/playbook/page.jsx`:

```jsx
import Database from 'better-sqlite3';
import { DB_FILE, initSchema } from '../../lib/db';
import { getShowById, nextUpcoming } from '../../lib/showsRepo';
import PlaybookHeader from './PlaybookHeader';
import AdsTab from './tabs/AdsTab';
import TicketsTab from './tabs/TicketsTab';
import NewsTab from './tabs/NewsTab';
import DayOfTab from './tabs/DayOfTab';

export const dynamic = 'force-dynamic';

const TABS = { ads: AdsTab, tickets: TicketsTab, news: NewsTab, dayof: DayOfTab };

export default function PlaybookPage({ searchParams }) {
  const sp = searchParams ?? {};
  const requestedId = Number(sp.show);
  const tab = TABS[sp.tab] ? sp.tab : 'ads';

  const db = new Database(DB_FILE);
  initSchema(db);
  const today = new Date().toISOString().slice(0, 10);
  let show = Number.isFinite(requestedId) && requestedId > 0
    ? getShowById(db, 'default', requestedId)
    : null;
  if (!show) show = nextUpcoming(db, 'default', { today });
  db.close();

  if (!show) {
    return (
      <div className="page">
        <div className="card" style={{ padding: 18 }}>
          <div className="serif" style={{ fontSize: 22, marginBottom: 6 }}>
            No upcoming shows
          </div>
          <div className="row-meta">
            Run <code>npm run ingest:shows</code> after Lauren updates the workbook.
          </div>
        </div>
      </div>
    );
  }

  const TabComp = TABS[tab];
  return (
    <div className="page">
      <PlaybookHeader show={show} activeTab={tab} />
      <TabComp show={show} />
    </div>
  );
}
```

- [ ] **Step 3: Smoke-render check**

Run: `npm run build 2>&1 | tail -40`
Expected: `/playbook` appears in route list; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/playbook/PlaybookHeader.jsx app/playbook/page.jsx
git commit -m "playbook: header + server page with tab routing"
```

---

## Task 15: `<ArchiveSearch>` + `/shows/archive` page

**Files:**
- Create: `app/shows/archive/ArchiveSearch.jsx`
- Create: `app/__tests__/ArchiveSearch.test.jsx`
- Create: `app/shows/archive/page.jsx`

- [ ] **Step 1: Write the failing test**

Create `app/__tests__/ArchiveSearch.test.jsx`:

```jsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ArchiveSearch from '../shows/archive/ArchiveSearch';

const ROWS = [
  { id: 1, band_name: 'open mic', show_date: '2025-02-26', era_year: 2025 },
  { id: 2, band_name: 'the hip snacks', show_date: '2024-03-01', era_year: 2024 },
];

describe('ArchiveSearch', () => {
  test('renders one row per archive entry', () => {
    render(<ArchiveSearch initialRows={ROWS} eras={[2025, 2024]} />);
    expect(screen.getByText('open mic')).toBeInTheDocument();
    expect(screen.getByText('the hip snacks')).toBeInTheDocument();
  });

  test('filters by band substring (client-side)', () => {
    render(<ArchiveSearch initialRows={ROWS} eras={[2025, 2024]} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'snacks' } });
    expect(screen.getByText('the hip snacks')).toBeInTheDocument();
    expect(screen.queryByText('open mic')).toBeNull();
  });

  test('filters by era', () => {
    render(<ArchiveSearch initialRows={ROWS} eras={[2025, 2024]} />);
    fireEvent.change(screen.getByLabelText(/era/i), { target: { value: '2024' } });
    expect(screen.queryByText('open mic')).toBeNull();
    expect(screen.getByText('the hip snacks')).toBeInTheDocument();
  });

  test('shows empty state when no matches', () => {
    render(<ArchiveSearch initialRows={ROWS} eras={[2025, 2024]} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'xyz' } });
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest app/__tests__/ArchiveSearch.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ArchiveSearch.jsx`**

Create `app/shows/archive/ArchiveSearch.jsx`:

```jsx
'use client';
import React, { useMemo, useState } from 'react';

export default function ArchiveSearch({ initialRows, eras }) {
  const [q, setQ] = useState('');
  const [era, setEra] = useState('');

  const rows = useMemo(() => {
    return initialRows.filter((r) => {
      if (era && String(r.era_year) !== era) return false;
      if (q && !r.band_name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [initialRows, q, era]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <input
          type="search"
          placeholder="Search band name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, padding: '8px 12px' }}
        />
        <label>
          <span className="row-meta" style={{ marginRight: 6 }}>Era</span>
          <select value={era} onChange={(e) => setEra(e.target.value)}>
            <option value="">All</option>
            {eras.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
      </div>
      {rows.length === 0 ? (
        <div className="row-meta" style={{ padding: 18 }}>No matches.</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Band</th>
              <th>Date</th>
              <th>Era</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.band_name}</td>
                <td className="mono">{r.show_date}</td>
                <td>{r.era_year ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest app/__tests__/ArchiveSearch.test.jsx`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Implement `app/shows/archive/page.jsx`**

Create `app/shows/archive/page.jsx`:

```jsx
import Database from 'better-sqlite3';
import { DB_FILE, initSchema } from '../../../lib/db';
import { archiveSearch, archiveEras } from '../../../lib/showsRepo';
import ArchiveSearch from './ArchiveSearch';

export const dynamic = 'force-dynamic';

export default function ArchivePage() {
  const db = new Database(DB_FILE);
  initSchema(db);
  const rows = archiveSearch(db, 'default', {});
  const eras = archiveEras(db, 'default');
  db.close();

  return (
    <div className="page">
      <header style={{ marginBottom: 18 }}>
        <div className="row-meta" style={{ letterSpacing: '.18em' }}>SHOWS · ARCHIVE</div>
        <h1 className="serif" style={{ fontSize: 38, lineHeight: 1.1 }}>
          Past <em>shows</em>
        </h1>
        <div className="row-meta">{rows.length} shows on file.</div>
      </header>
      <ArchiveSearch initialRows={rows} eras={eras} />
    </div>
  );
}
```

- [ ] **Step 6: Smoke-render check**

Run: `npm run build 2>&1 | tail -40`
Expected: `/shows/archive` in route list; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add app/shows/archive app/__tests__/ArchiveSearch.test.jsx
git commit -m "shows/archive: server page + client search/filter"
```

---

## Task 16: Nav registry entries

**Files:**
- Modify: `app/_components/navRegistry.js`

- [ ] **Step 1: Add the three entries**

Open `app/_components/navRegistry.js`. After the last entry in `NAV_ITEMS` and before its closing `]`, append:

```js
  {
    id: 'booking',
    href: '/booking',
    name: 'Booking',
    sub: 'Calendar + pipeline',
    group: 'Entertainment',
    terms: 'booking calendar pipeline shows',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'playbook',
    href: '/playbook',
    name: 'Playbook',
    sub: 'Show marketing',
    group: 'Entertainment',
    terms: 'playbook marketing ads tickets dice',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
  {
    id: 'shows-archive',
    href: '/shows/archive',
    name: 'Past shows',
    sub: 'Archive search',
    group: 'Entertainment',
    terms: 'archive past shows history',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
```

- [ ] **Step 2: Verify the registry parses**

Run: `node -e "import('./app/_components/navRegistry.js').then(m => console.log(m.NAV_ITEMS.filter(i => i.group === 'Entertainment').map(i => i.id)))"`
Expected: `[ 'booking', 'playbook', 'shows-archive' ]`.

- [ ] **Step 3: Commit**

```bash
git add app/_components/navRegistry.js
git commit -m "nav: register Entertainment group (booking, playbook, archive)"
```

---

## Task 17: package.json — `ingest:shows` + test scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add ingest script**

In the `"scripts"` block of `package.json`, add a new entry near the other `ingest:` scripts:

```json
"ingest:shows": "node --experimental-strip-types scripts/ingest-shows.mjs",
```

If `ingest:all` exists, append `&& npm run ingest:shows` to its command. (If it doesn't, skip — Lauren can run `ingest:shows` alone.)

- [ ] **Step 2: Add test scripts near the other `test:` entries**

```json
"test:show-status": "node --experimental-strip-types --test tests/js/test-show-status.mjs",
"test:shows-ingest": "node --experimental-strip-types --test tests/js/test-shows-ingest.mjs",
"test:shows-repo": "node --experimental-strip-types --test tests/js/test-shows-repo.mjs",
"test:shows-api": "node --experimental-strip-types --test tests/js/test-shows-api.mjs",
"test:shows-py": "pytest tests/python/test_ingest_shows_xlsx.py",
```

Optional convenience aggregator if it fits the existing convention:

```json
"test:shows": "npm run test:show-status && npm run test:shows-ingest && npm run test:shows-repo && npm run test:shows-api && npm run test:shows-py",
```

- [ ] **Step 3: Verify all scripts run end-to-end**

Run: `npm run test:shows`
Expected: every sub-test passes (mirrors the individual task runs).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "scripts: ingest:shows + test:shows-* aggregator"
```

---

## Task 18: Playwright e2e smoke

**Files:**
- Create: `tests/e2e/shows.spec.ts`

- [ ] **Step 1: Write the test**

Create `tests/e2e/shows.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

const PIN = process.env.LARIAT_PIN || '1234';

test('shows surfaces — login → booking → playbook → archive', async ({ page }) => {
  // Log in via PIN.
  await page.goto('/login-pin');
  await page.fill('input[name="pin"]', PIN);
  await page.click('button[type="submit"]');

  // Booking.
  await page.goto('/booking');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/calendar/i);

  // Click first artist link → playbook.
  const firstLink = page.getByRole('link').filter({ hasText: /^[a-z]/i }).first();
  if (await firstLink.count()) {
    await firstLink.click();
    await expect(page).toHaveURL(/\/playbook\?show=\d+/);
  }

  // Archive.
  await page.goto('/shows/archive');
  await expect(page.getByText(/past/i)).toBeVisible();
});
```

- [ ] **Step 2: Run the e2e (requires `npm run dev` or `npm run build && npm run start`)**

In one terminal: `npm run build && npm run start`
In another: `npm run test:e2e -- shows.spec.ts`
Expected: 1 test passing.

(If the dev DB has no ingested shows, the test still passes — the click block is guarded with `if (await firstLink.count())`.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/shows.spec.ts
git commit -m "e2e: shows surfaces smoke (login → booking → playbook → archive)"
```

---

## Task 19: Live ingest + visual review

**Files:** none

- [ ] **Step 1: Run the real ingest**

Run: `npm run ingest:shows`
Expected: prints `shows: <N>  archive: <M>  tiktok: <K>` and exits 0 (or `partial` with a `dropped: …` summary).

- [ ] **Step 2: Start the dev server**

Run: `npm run dev`
Expected: server up on `:3000`.

- [ ] **Step 3: Visual eyeball — open each surface**

In a browser:
- `http://localhost:3000/booking` — calendar populated, pipeline cards counting.
- `http://localhost:3000/playbook` — defaults to next upcoming; tab nav cycles through the four tabs; status pills colored correctly.
- `http://localhost:3000/shows/archive` — search input + era select work; rows render with dates.

Compare each against the matching prototype function in `design/Lariat2/pages-event.jsx`:
- `Booking` (line 197) — the calendar table + pipeline cards.
- `Playbook` (line 1042) — KPI strip + tab nav (we ship 4 of the 6 tabs).

- [ ] **Step 4: If any visual gap is significant, file a follow-up**

Use a TODO comment in the relevant `.jsx` file (`// TODO(phase4-narrow-followup): …`) — do not in-line a fix. The plan is complete when functional behavior is correct and tests are green; pixel-level polish is explicitly out of scope per the spec.

- [ ] **Step 5: Final commit (only if Step 4 produced any changes)**

```bash
git add -A
git commit -m "shows: phase4-narrow polish notes from visual review"
```

---

## Task 20: Merge gate

**Files:** none

- [ ] **Step 1: Run the full test sweep**

```bash
npm run test:shows
npm run test:unit
node --test tests/js/test-show-status.mjs tests/js/test-shows-ingest.mjs tests/js/test-shows-repo.mjs tests/js/test-shows-api.mjs
pytest tests/python/test_ingest_shows_xlsx.py
```

Expected: all green. (Also re-run any pre-existing test:* scripts that touch `lib/db.ts` or `middleware.js` — the schema additions and prefix list are the most-likely regression surfaces.)

- [ ] **Step 2: Diff the worktree against main**

Run: `git log --oneline main..HEAD`
Expected: ~17–20 small commits, each focused.

- [ ] **Step 3: Decide merge mechanism**

Pick one (the user is the decider):

- Merge the worktree branch into `main` directly (`git checkout main && git merge --no-ff feature/lariat2-phase4-narrow`), or
- Open a PR if remote review is wanted.

Do NOT delete the worktree until the user confirms the merge. The worktree path is the audit trail for the entire phase.

---

## Notes for the implementer

- **CLAUDE.md hard rules.** Read `lib/db.ts` migration policy before touching any existing DDL. The spec/plan only adds new `CREATE TABLE IF NOT EXISTS` blocks — never edit existing DDL.
- **No mocked SQLite.** Every test that needs a DB uses `:memory:` via `setDbPathForTest()` (when going through API routes) or `new Database(':memory:')` directly (in repo/ingest tests). Mocking SQLite is a documented past regression in the project.
- **Realistic fixtures.** The fixture builder uses real band names from the source xlsx — keep it that way if the fixture needs extension.
- **Three runners, do not mix.** Tests use `node --test` for server/API/rule code, Jest for React components, pytest for Python. Don't try to import a `.jsx` file from a `node:test` file.
- **Status semantics.** `lib/showStatus.ts` is the single source of truth for color/label/stage. UI never re-implements rules locally — always call `statusColor()` / `pipelineStage()`.
- **Lauren is SoT.** No write paths from UI. If a future feature needs writes, that's a new spec.

---

## Self-review checklist (executed before handoff)

- [x] **Spec coverage.** Each section of the spec maps to at least one task: §4 architecture (Tasks 1, 5, 7), §5 schema (Task 1), §6 components (Tasks 9–15), §7 data flow (Tasks 4–7), §8 error handling (Task 4 lock/missing exits, Task 5 transactional rollback), §9 testing (Tasks 2, 4, 5, 6, 7, 9, 10, 13, 15, 18). Nav + middleware + package.json wiring (Tasks 8, 16, 17).
- [x] **No placeholders.** Every code block is complete; every command has expected output.
- [x] **Type consistency.** `pipelineStage(row, showIsPast?)` signature is identical between `lib/showStatus.ts` and the repo call site. `KNOWN_STAGES` is the single source of stage names. `ShowRow.status` is `Record<string,string>` everywhere it's read. Repo function names (`upcomingShows`, `pipelineCounts`, `archiveSearch`, `archiveEras`, `getShowById`, `nextUpcoming`) are identical between the test imports and the implementation.
- [x] **Spec deviation called out.** The plan documents (in *Modified · package.json* and *Deviation from spec*) why `ingest_runs.dropped_json` is not introduced and how dropped data is surfaced instead.
