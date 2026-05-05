#!/usr/bin/env node
// Prism CSV deal-backfill importer — fills `show_deals` for shows that
// ran *before* the Lariat settlement page existed (PR #78 deferred this
// because historical settlements need pre-existing deal points to
// compute against). Phase 2 §B4 cutover plan names this as the 6-show
// parallel-run prerequisite.
//
// Usage:
//   node scripts/import-prism-deals.mjs --csv <path> [--dry-run] \
//     [--location <id>] [--overwrite] [--cook-id <id>]
//
// CSV columns (header required):
//   band_name              — fuzzy-matched (case-insensitive, trimmed)
//                            against shows.band_name. Multiple matches
//                            → row rejected.
//   show_date              — ISO date; must match shows.show_date
//                            exactly (combined with band_name + location_id).
//   guarantee              — dollars. Stored as cents via
//                            Math.round(parsed * 100).
//   vs_pct_after_costs     — 0.85 or blank for flat. Validated 0–1.
//   costs_off_top_json     — JSON literal already in target shape:
//                            [{"label":"Sound","cents":5000}]. Empty → [].
//   buyout                 — dollars; defaults to 0.
//   notes                  — optional freeform.
//
// Semantics:
//   - All writes go through upsertDeal() — no direct INSERTs to show_deals.
//   - --dry-run prints the plan; no DB writes; exit 0.
//   - Default behavior is non-destructive: rows whose show already has a
//     deal are *skipped* with a "row exists, skipping" line on stderr.
//     Pass --overwrite to replace manually-entered deals (the
//     underlying upsert is idempotent and audits as 'correction').
//   - Rows with no matching show OR ambiguous band_name match OR
//     malformed costs_off_top_json are reported on stderr; the import
//     refuses to write any rows if any errored (atomic batch).
//   - Cook id defaults to 'prism-backfill'; audit actor_source is
//     'prism_backfill' so the audit log distinguishes imported history
//     from operator entries made via /shows/[id]/settlement.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { register } from 'node:module';

// Same TS-resolve hook as the tests / sibling importers so we can
// import lib/*.ts modules from a plain .mjs script.
register(new URL('../tests/js/resolver.mjs', import.meta.url));

const dbMod = await import('../lib/db.ts');
const { upsertDeal } = await import('../lib/settlementRepo.ts');

// ── Args ───────────────────────────────────────────────────────────
const { values } = parseArgs({
  options: {
    csv: { type: 'string' },
    location: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    overwrite: { type: 'boolean', default: false },
    'cook-id': { type: 'string' },
    encoding: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || !values.csv) {
  process.stdout.write(
    'Usage: node scripts/import-prism-deals.mjs --csv <path> ' +
      '[--dry-run] [--location <id>] [--overwrite] [--cook-id <id>] ' +
      '[--encoding <utf-8|cp1252>]\n',
  );
  process.exit(values.help ? 0 : 1);
}

const csvPath = path.resolve(values.csv);
if (!fs.existsSync(csvPath)) {
  process.stderr.write(`import-prism-deals: file not found: ${csvPath}\n`);
  process.exit(1);
}

const locationId = values.location || 'default';
const dryRun = Boolean(values['dry-run']);
const overwrite = Boolean(values.overwrite);
const cookId = values['cook-id'] || 'prism-backfill';

// ── RFC-4180-ish CSV parser (matches sibling importers) ────────────
function parseCsv(text) {
  // Strip the UTF-8 BOM (U+FEFF) if Excel/Google-Sheets prepended one.
  // Use \uFEFF escape rather than the literal byte so eslint's
  // no-irregular-whitespace rule doesn't flag the line.
  const src = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (c === '\r') {
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const REQUIRED_COLUMNS = [
  'band_name',
  'show_date',
  'guarantee',
  'vs_pct_after_costs',
  'costs_off_top_json',
  'buyout',
  'notes',
];

// Encoding handling. Prism's CSV export encoding isn't documented by the
// vendor — we default to UTF-8 but support cp1252 for the common
// Windows-origin SaaS export case. Pass --encoding cp1252 if band names
// arrive mojibaked (curly quotes, accented characters mangled). All
// supported labels are TextDecoder-native; no iconv dependency.
const SUPPORTED_ENCODINGS = ['utf-8', 'cp1252', 'windows-1252', 'latin1', 'iso-8859-1'];
const encodingArg = (values.encoding || 'utf-8').toLowerCase().replace(/^utf8$/, 'utf-8');
if (!SUPPORTED_ENCODINGS.includes(encodingArg)) {
  process.stderr.write(
    `import-prism-deals: unsupported --encoding "${values.encoding}". ` +
      `Supported: ${SUPPORTED_ENCODINGS.join(', ')}\n`,
  );
  process.exit(1);
}
if (encodingArg === 'utf-8' && !values.encoding) {
  process.stderr.write(
    'import-prism-deals: reading as UTF-8 (Prism encoding is unconfirmed; ' +
      'pass --encoding cp1252 if band names arrive mojibaked)\n',
  );
}
const buf = fs.readFileSync(csvPath);
const text = new TextDecoder(encodingArg, { fatal: false }).decode(buf);
const raw = parseCsv(text);
if (raw.length === 0) {
  process.stderr.write('import-prism-deals: empty CSV\n');
  process.exit(1);
}

const header = raw[0].map((s) => s.trim());
for (const col of REQUIRED_COLUMNS) {
  if (!header.includes(col)) {
    process.stderr.write(
      `import-prism-deals: missing required column "${col}". ` +
        `Expected header: ${REQUIRED_COLUMNS.join(',')}\n`,
    );
    process.exit(1);
  }
}
const colIdx = Object.fromEntries(header.map((h, i) => [h, i]));

function pick(fields, name) {
  const idx = colIdx[name];
  if (idx === undefined) return '';
  const v = fields[idx];
  return v === undefined ? '' : v;
}

// ── Stage rows ─────────────────────────────────────────────────────
const sqlite = dbMod.getDb();

// Pull all candidate shows for this location once; fuzzy-match in JS
// to centralize "case-insensitive, trimmed" semantics.
const allShows = sqlite
  .prepare(
    `SELECT id, band_name, show_date FROM shows WHERE location_id = ?`,
  )
  .all(locationId);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeBand(s) {
  return String(s ?? '').trim().toLowerCase();
}

const staged = []; // { lineNumber, csv, deal, showId, errors, willSkip }

for (let i = 1; i < raw.length; i++) {
  const fields = raw[i];
  if (fields.length === 0) continue;
  if (fields.length === 1 && fields[0].trim() === '') continue;

  const lineNumber = i + 1;
  const errors = [];

  const bandName = pick(fields, 'band_name').trim();
  const showDate = pick(fields, 'show_date').trim();
  const guaranteeRaw = pick(fields, 'guarantee').trim();
  const vsPctRaw = pick(fields, 'vs_pct_after_costs').trim();
  const costsRaw = pick(fields, 'costs_off_top_json').trim();
  const buyoutRaw = pick(fields, 'buyout').trim();
  const notesRaw = pick(fields, 'notes');

  if (!bandName) errors.push('band_name is required');
  if (!ISO_DATE.test(showDate))
    errors.push(`show_date must be ISO YYYY-MM-DD (got "${showDate}")`);

  // Guarantee: required; numeric; non-negative.
  let guaranteeCents = 0;
  if (!guaranteeRaw) {
    errors.push('guarantee is required');
  } else {
    const n = Number(guaranteeRaw);
    if (!Number.isFinite(n) || n < 0) {
      errors.push(`guarantee must be a non-negative number (got "${guaranteeRaw}")`);
    } else {
      guaranteeCents = Math.round(n * 100);
    }
  }

  // vs_pct_after_costs: blank → null (flat deal); else numeric in [0,1].
  let vsPctAfterCosts = null;
  if (vsPctRaw !== '') {
    const n = Number(vsPctRaw);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      errors.push(
        `vs_pct_after_costs must be blank or a number in [0,1] (got "${vsPctRaw}")`,
      );
    } else {
      vsPctAfterCosts = n;
    }
  }

  // costs_off_top_json: blank → []; else JSON array of {label, cents}.
  let costsOffTop = [];
  if (costsRaw !== '') {
    try {
      const parsed = JSON.parse(costsRaw);
      if (!Array.isArray(parsed)) {
        errors.push('costs_off_top_json must parse to a JSON array');
      } else {
        for (let j = 0; j < parsed.length; j++) {
          const c = parsed[j];
          if (
            !c ||
            typeof c.label !== 'string' ||
            typeof c.cents !== 'number' ||
            !Number.isFinite(c.cents)
          ) {
            errors.push(
              `costs_off_top_json[${j}] must be { label:string, cents:number }`,
            );
            costsOffTop = [];
            break;
          }
          costsOffTop.push({ label: c.label, cents: Math.round(c.cents) });
        }
      }
    } catch (e) {
      errors.push(`costs_off_top_json is not valid JSON: ${e.message}`);
    }
  }

  // Buyout: blank → 0; else numeric, non-negative.
  let buyoutCents = 0;
  if (buyoutRaw !== '') {
    const n = Number(buyoutRaw);
    if (!Number.isFinite(n) || n < 0) {
      errors.push(`buyout must be a non-negative number (got "${buyoutRaw}")`);
    } else {
      buyoutCents = Math.round(n * 100);
    }
  }

  const notes = notesRaw ? String(notesRaw).trim() : '';

  // Show match: case-insensitive, trimmed band_name + exact show_date.
  let showId = null;
  let willSkip = false;
  if (errors.length === 0) {
    const target = normalizeBand(bandName);
    const matches = allShows.filter(
      (s) => normalizeBand(s.band_name) === target && s.show_date === showDate,
    );
    if (matches.length === 0) {
      errors.push(
        `no show found for "${bandName}" on ${showDate} in location "${locationId}"`,
      );
    } else if (matches.length > 1) {
      errors.push(
        `ambiguous match: ${matches.length} shows for "${bandName}" on ${showDate}`,
      );
    } else {
      showId = matches[0].id;
      // Only check existence after we know the show; skip-vs-overwrite
      // decision happens here so dry-run reports the same plan.
      const existing = sqlite
        .prepare(
          `SELECT id FROM show_deals WHERE show_id = ? AND location_id = ?`,
        )
        .get(showId, locationId);
      if (existing && !overwrite) {
        willSkip = true;
      }
    }
  }

  staged.push({
    lineNumber,
    csv: { bandName, showDate },
    deal: {
      guaranteeCents,
      vsPctAfterCosts,
      costsOffTop,
      buyoutCents,
    },
    notes: notes || null,
    showId,
    errors,
    willSkip,
  });
}

const errored = staged.filter((s) => s.errors.length > 0);
const writable = staged.filter((s) => s.errors.length === 0 && !s.willSkip);
const skipped = staged.filter((s) => s.errors.length === 0 && s.willSkip);

// ── Report ─────────────────────────────────────────────────────────
function fmt(s) {
  const flatVs =
    s.deal.vsPctAfterCosts === null ? 'flat' : `vs ${s.deal.vsPctAfterCosts}`;
  return (
    `  line ${s.lineNumber}: ${s.csv.bandName} @ ${s.csv.showDate} → ` +
    `show_id=${s.showId} guarantee=${s.deal.guaranteeCents}c ${flatVs} ` +
    `buyout=${s.deal.buyoutCents}c costs=${s.deal.costsOffTop.length}`
  );
}

if (errored.length) {
  process.stderr.write(
    `import-prism-deals: ${errored.length} invalid rows:\n`,
  );
  for (const e of errored) {
    process.stderr.write(`  line ${e.lineNumber}: ${e.errors.join('; ')}\n`);
  }
}

if (skipped.length) {
  process.stderr.write(
    `import-prism-deals: ${skipped.length} rows skipped (deal already exists; ` +
      `pass --overwrite to replace):\n`,
  );
  for (const s of skipped) {
    process.stderr.write(
      `  line ${s.lineNumber}: ${s.csv.bandName} @ ${s.csv.showDate} (show_id=${s.showId})\n`,
    );
  }
}

if (dryRun) {
  process.stdout.write(
    `import-prism-deals: DRY RUN — ${staged.length} rows parsed ` +
      `(${writable.length} would write, ${skipped.length} would skip, ` +
      `${errored.length} errored)\n`,
  );
  if (writable.length) {
    process.stdout.write('\nwould upsert:\n');
    for (const s of writable) process.stdout.write(`${fmt(s)}\n`);
  }
  process.exit(0);
}

if (errored.length > 0) {
  process.stderr.write(
    `import-prism-deals: refusing to write — fix the errored rows above and re-run\n`,
  );
  process.exit(1);
}

// ── Execute ────────────────────────────────────────────────────────
let written = 0;
try {
  // upsertDeal already opens its own tx per row; wrapping the loop in
  // an outer tx makes the whole batch atomic so a mid-batch failure
  // doesn't leave half a backfill.
  sqlite.transaction(() => {
    for (const s of writable) {
      upsertDeal(s.showId, s.deal, cookId, locationId, {
        notes: s.notes,
        actorSource: 'prism_backfill',
      });
      written++;
    }
  })();
} catch (err) {
  process.stderr.write(`import-prism-deals: transaction failed: ${err.message}\n`);
  process.exit(1);
}

process.stdout.write(
  `import-prism-deals: wrote ${written} deal(s), skipped ${skipped.length}, errored 0\n`,
);
process.exit(0);
