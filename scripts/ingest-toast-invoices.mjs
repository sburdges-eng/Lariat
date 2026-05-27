#!/usr/bin/env node
/**
 * Ingest Toast Inc. subscription invoices into lariat.db.
 *
 * Pattern (docs/PATTERNS.md §2): this Node wrapper shells out to the Python
 * parser (`scripts/ingest_toast_invoices.py`) which already writes
 * `data/cache/toast_invoices.json`, then owns all SQLite writes inside a
 * single transaction. Full-refresh per (location_id, source) — deletes the
 * existing toast_subscription_invoices + toast_subscription_invoice_lines
 * rows for the location and re-inserts.
 *
 * Run:
 *   node scripts/ingest-toast-invoices.mjs                   # default location
 *   node scripts/ingest-toast-invoices.mjs --location=main
 *   node scripts/ingest-toast-invoices.mjs --skip-python     # reuse existing JSON cache
 *   node scripts/ingest-toast-invoices.mjs --dir <pdf-dir>   # forwards to Python --dir
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { initSchema, DB_FILE } from '../lib/db.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PY = path.join(ROOT, '.venv', 'bin', 'python');
const PARSER = path.join(__dirname, 'ingest_toast_invoices.py');
const CACHE = path.join(ROOT, 'data', 'cache', 'toast_invoices.json');

export function parseArgs(argv) {
  const out = { location: 'default', skipPython: false, dir: null };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--skip-python') out.skipPython = true;
    else if (arg.startsWith('--location=')) out.location = arg.slice('--location='.length);
    else if (arg === '--location' && args[i + 1]) out.location = args[++i];
    else if (arg.startsWith('--dir=')) out.dir = arg.slice('--dir='.length);
    else if (arg === '--dir' && args[i + 1]) out.dir = args[++i];
  }
  return out;
}

export function ingestToastInvoices(db, payload, locationId = 'default') {
  initSchema(db);

  const headers = Array.isArray(payload?.headers) ? payload.headers : [];
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  const rowsIn = headers.length + lines.length;

  // Open ingest_runs row before doing real work so the timestamp matches start.
  const runId = Number(
    db
      .prepare(
        `INSERT INTO ingest_runs (kind, started_at, status, rows_in)
         VALUES ('toast_invoices', datetime('now','subsec'), 'running', ?)`,
      )
      .run(rowsIn).lastInsertRowid,
  );

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
      /* never let instrumentation mask real errors */
    }
  };

  const delHeaders = db.prepare(
    `DELETE FROM toast_subscription_invoices WHERE location_id = ?`,
  );
  const delLines = db.prepare(
    `DELETE FROM toast_subscription_invoice_lines WHERE location_id = ?`,
  );
  const insHeader = db.prepare(
    `INSERT INTO toast_subscription_invoices
       (invoice_no, invoice_date, invoice_total, line_count, source_pdf, location_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insLine = db.prepare(
    `INSERT INTO toast_subscription_invoice_lines
       (invoice_no, invoice_date, line_seq, item, qty, rate, amount, location_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let summary;
  try {
    summary = db.transaction(() => {
      delLines.run(locationId);
      delHeaders.run(locationId);

      let headerCount = 0;
      for (const h of headers) {
        insHeader.run(
          h.invoice_no,
          h.invoice_date,
          h.invoice_total,
          h.line_count ?? 0,
          h.pdf_path ?? null,
          locationId,
        );
        headerCount += 1;
      }

      // Per-invoice line_seq starts at 1, in input order.
      const seqByInv = new Map();
      let lineCount = 0;
      for (const l of lines) {
        const next = (seqByInv.get(l.invoice_no) ?? 0) + 1;
        seqByInv.set(l.invoice_no, next);
        insLine.run(
          l.invoice_no,
          l.invoice_date,
          next,
          l.item,
          l.qty,
          l.rate,
          l.amount,
          locationId,
        );
        lineCount += 1;
      }
      return { headers: headerCount, lines: lineCount };
    })();
  } catch (err) {
    finalize('failed', null);
    throw err;
  }

  finalize('ok', summary.headers + summary.lines);
  return summary;
}

function main() {
  const args = parseArgs(process.argv);

  if (!args.skipPython) {
    if (!fs.existsSync(PY)) {
      console.error(`venv python not found at ${PY}`);
      process.exit(1);
    }
    const pyArgs = [PARSER];
    if (args.dir) pyArgs.push('--dir', args.dir);
    console.log(`[python] ${PY} ${pyArgs.join(' ')}`);
    execFileSync(PY, pyArgs, { stdio: 'inherit' });
  }

  if (!fs.existsSync(CACHE)) {
    console.error(`Cache not found at ${CACHE}. Run without --skip-python.`);
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(CACHE, 'utf8'));

  const db = new Database(DB_FILE);
  try {
    db.pragma('journal_mode = WAL');
    const summary = ingestToastInvoices(db, payload, args.location);
    console.log(
      `\nIngested ${summary.headers} invoice headers + ${summary.lines} line items into location='${args.location}'.`,
    );
  } finally {
    db.close();
  }
}

const isCli = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (isCli) main();
