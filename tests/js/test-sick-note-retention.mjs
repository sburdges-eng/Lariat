import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const { runRetentionReport, cutoffISO, RETENTION_DAYS } = await import('../../scripts/sick-note-retention.mjs');

function tmpDir() {
  const d = path.join(process.cwd(), `.tmp-retention-${process.pid}-${Math.floor(process.hrtime()[1])}`);
  fs.mkdirSync(path.join(d, 'uploads', 'sick-notes', '1'), { recursive: true });
  return d;
}
function iso(daysAgo) { return new Date(Date.now() - daysAgo * 86400_000).toISOString(); }

describe('sick-note retention report', () => {
  it('flags only documents past the 2-year window, and reports file presence', () => {
    const dir = tmpDir();
    const dbPath = path.join(dir, 'lariat.db');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE sick_note_documents (id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL, location_id TEXT NOT NULL, file_path TEXT NOT NULL,
      kind TEXT NOT NULL, original_filename TEXT, uploaded_by TEXT, uploaded_at TEXT NOT NULL)`);
    const ins = db.prepare(`INSERT INTO sick_note_documents (report_id,location_id,file_path,kind,uploaded_at) VALUES (?,?,?,?,?)`);
    ins.run(1, 'default', 'sick-notes/1/old.pdf', 'note', iso(800));  // overdue, file present
    ins.run(1, 'default', 'sick-notes/1/new.pdf', 'note', iso(10));   // fresh
    db.close();
    fs.writeFileSync(path.join(dir, 'uploads', 'sick-notes', '1', 'old.pdf'), 'X');

    const r = runRetentionReport({ dbPath, dataDir: dir });
    assert.equal(RETENTION_DAYS, 730);
    assert.equal(r.overdueCount, 1);
    assert.equal(r.overdue[0].file_path, 'sick-notes/1/old.pdf');
    assert.equal(r.overdue[0].present, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns zero on a fresh DB with no table (report-only, never throws)', () => {
    const dir = tmpDir();
    const dbPath = path.join(dir, 'lariat.db');
    new Database(dbPath).close(); // empty DB, no table
    const r = runRetentionReport({ dbPath, dataDir: dir });
    assert.equal(r.overdueCount, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
