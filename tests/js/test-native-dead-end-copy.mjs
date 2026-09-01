#!/usr/bin/env node
// Guards native user-facing copy against dead ends — instructions a cook on an
// iPad cannot follow.
//
// This class of defect keeps coming back. PR #651 rewrote three strings into
// kitchen language; a 2026-09-01 sweep found the exact pre-#651 sentence still
// live in three view models plus a dozen more strings naming JSON files, a
// Python script, and a shell command. The cause is structural: the native
// boards are verbatim ports of the web JSX (90 `.jsx` provenance comments under
// UI/Boards), so the porting convention keeps importing operator-at-a-laptop
// copy. Nothing caught it — tests/js/test-i18n-catalog.mjs checks UI_COPY_RULES
// banned words only against lib/i18n/messages/*.ts and never sees Swift.
//
// Two rules, both STRUCTURAL rather than vocabulary lists, so a new phrasing of
// the same mistake still fails:
//
//   1. No user-facing string points at the web app. iPad is the deployment
//      target; there is no web Settings page to visit. (There is not even one
//      in the web app — PIN management lives at /management/pins.)
//   2. A technical token — a filename, a path, a shell command — may appear
//      ONLY after the "Details for the office:" marker that #651 established.
//      The cook-readable sentence comes first; the detail is quarantined for
//      whoever actually fixes it.
//
// This is a floor, not a ceiling: it cannot judge reading level or tone. It
// catches the specific failure of telling a cook to run something they can't.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-native-dead-end-copy.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UI_DIRS = ['Boards', 'ViewModels', 'Support'].map((d) =>
  path.join(REPO, 'LariatNative/Sources/LariatApp/UI', d),
);

const OFFICE_MARKER = 'Details for the office:';

// Pointing a cook at the web app. Deliberately includes the spellings already
// found in the wild rather than one loose /web/ that would hit "website".
const WEB_POINTER_RE = /\bweb (settings|cockpit|app|ui)\b/i;

// A token a cook cannot act on from a station.
const TECHNICAL_RE = /\.(json|py|db|ts|tsx|jsx|sh)\b|\bnpm run \b|\bscripts\/|\bdata\/cache\b/;

// Strings that are not shown to a person: log/console text, identifiers,
// SF Symbol names, and filesystem plumbing. Keyed by file:literal so an
// exemption cannot silently widen.
const NOT_USER_FACING = new Set([
  // (empty — every current technical mention in these dirs is behind the
  // office marker. Add entries here ONLY for genuinely non-visible strings,
  // with the reason, never to excuse a dead end.)
]);

// Boards whose audience IS the office, where naming a command is the useful
// instruction rather than a dead end — these are `.costing` tier, read by
// whoever runs the ingest, not by a cook on a station.
//
// They are also the three sites whose copy is byte-identical to a web twin
// (app/costing/price-shocks/page.jsx, app/menu-engineering/margin-deltas/page.jsx,
// app/menu-engineering/page.tsx), so rewriting the native half alone would fork
// the wording. Fixing them means touching both sides in one PR — real work,
// deliberately not bundled into a cook-facing copy sweep.
//
// A cook-tier board must NEVER be added here. If a board changes tier, this
// list changes with it.
const OFFICE_TIER_BOARDS = new Set([
  'MarginDeltasView.swift',
  'PriceShocksView.swift',
  'MenuEngineeringView.swift',
]);

function swiftFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.swift'))
    .map((e) => path.join(e.parentPath ?? e.path, e.name));
}

/** Every double-quoted literal on a non-comment line, with its line number. */
function literals(file) {
  const out = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('//') || line.startsWith('///') || line.startsWith('*')) return;
    // Swift string literals; good enough for copy, which never nests quotes.
    for (const m of raw.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const text = m[1];
      if (!text.trim()) continue;
      out.push({ file: path.relative(REPO, file), line: i + 1, text });
    }
  });
  return out;
}

const ALL = UI_DIRS.flatMap(swiftFiles).flatMap(literals);

describe('native user-facing copy — no dead ends for a cook on the line', () => {
  it('found the native UI sources to scan', () => {
    assert.ok(ALL.length > 500, `expected many literals under UI/, found ${ALL.length}`);
  });

  it('never points a cook at the web app', () => {
    const bad = ALL.filter((l) => WEB_POINTER_RE.test(l.text));
    assert.deepEqual(
      bad.map((l) => `${l.file}:${l.line} — ${l.text}`),
      [],
      'iPad is the deployment target; there is no web page for a cook to open',
    );
  });

  it('quarantines filenames, paths and commands behind "Details for the office:"', () => {
    const bad = ALL.filter((l) => {
      if (!TECHNICAL_RE.test(l.text)) return false;
      if (NOT_USER_FACING.has(`${l.file}:${l.text}`)) return false;
      if (OFFICE_TIER_BOARDS.has(path.basename(l.file))) return false;
      const marker = l.text.indexOf(OFFICE_MARKER);
      if (marker === -1) return true;
      // The technical token must come AFTER the marker, not before it.
      return TECHNICAL_RE.test(l.text.slice(0, marker));
    });
    assert.deepEqual(
      bad.map((l) => `${l.file}:${l.line} — ${l.text}`),
      [],
      `a cook cannot run a script or open a JSON file — put it after "${OFFICE_MARKER}"`,
    );
  });

  // The exemption above is the part most likely to rot: it is easier to add a
  // filename to it than to rewrite a sentence. Pin it so growth is deliberate.
  it('keeps the office-tier exemption from quietly growing', () => {
    assert.equal(
      OFFICE_TIER_BOARDS.size,
      3,
      'adding a board here exempts it from the dead-end rule — do that only for an office-tier board, in its own commit, with the reason',
    );
  });
});
