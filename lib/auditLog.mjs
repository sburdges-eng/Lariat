// @ts-check
/**
 * Audit logging system for management actions
 * Stores audit trail of recipe edits, cost updates, and other sensitive operations
 */

import fs from 'fs';
import path from 'path';
import { resolveDataDir } from './dataDir.ts';

/**
 * Caller-supplied audit entry passed into {@link logAuditAction}. Shape
 * varies per call site (recipe edits, cost updates, photo uploads, dead-
 * letter drops, etc. — ~20 call sites across app/api/**); `action` is the
 * one field every caller sets. `timestamp`/`id` are optional because the
 * writer fills them in when the caller omits them.
 * @typedef {{ action?: string, timestamp?: string, id?: string, slug?: string, [key: string]: unknown }} AuditEntry
 */

/**
 * A logged audit entry as read back from the JSONL file. Every entry has
 * an `id` and `timestamp` (stamped by {@link logAuditAction}); everything
 * else is whatever shape the writing caller passed.
 * @typedef {{ id: string, timestamp: string, action?: string, slug?: string, [key: string]: unknown }} AuditLogRecord
 */

// Audit M7 (2026-05-14): resolve the audit-log path at CALL time so a
// relocated install (LARIAT_DATA_DIR=…) writes JSONL audit lines into
// the same root as SQLite + JSON cache. Pre-fix this used a module-
// load `process.cwd()/data/audit` constant — splitting the audit
// trail across two directories on a relocated install. The
// LARIAT_AUDIT_PATH escape hatch still wins for tests that point at
// a tmp file.
function defaultAuditLogFile() {
  return path.join(resolveDataDir(), 'audit', 'management-actions.jsonl');
}

function resolveAuditLogFile() {
  const override = process.env.LARIAT_AUDIT_PATH;
  return override && override.trim() ? override : defaultAuditLogFile();
}

/**
 * Ensure audit log directory for the active path exists
 * @param {string} file
 */
function ensureAuditDir(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Log a management action to the audit trail
 * @param {AuditEntry} auditEntry - Audit entry with action, timestamp, user, changes, etc.
 * @returns {AuditLogRecord}
 */
export function logAuditAction(auditEntry) {
  try {
    const file = resolveAuditLogFile();
    ensureAuditDir(file);

    // Add standard fields
    const entry = {
      ...auditEntry,
      timestamp: auditEntry.timestamp || new Date().toISOString(),
      id: generateAuditId(),
    };

    // Append to JSONL file
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');

    return entry;
  } catch (error) {
    console.error('Failed to log audit action:', error);
    throw error;
  }
}

/**
 * Generate unique audit entry ID
 */
function generateAuditId() {
  return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Read recent audit logs
 * @param {number} limit - Number of recent entries to return
 * @returns {AuditLogRecord[]}
 */
export function getRecentAuditLog(limit = 100) {
  try {
    const file = resolveAuditLogFile();
    if (!fs.existsSync(file)) {
      return [];
    }

    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Get the last `limit` entries
    const entries = lines
      .slice(-limit)
      .map(line => {
        try {
          return /** @type {AuditLogRecord} */ (JSON.parse(line));
        } catch {
          return null;
        }
      })
      .filter((entry) => entry !== null)
      .reverse(); // Most recent first

    return entries;
  } catch (error) {
    console.error('Failed to read audit log:', error);
    return [];
  }
}

/**
 * Read the JSONL audit file into memory, then iterate line-by-line,
 * parsing each into an object and pushing it to `out` when
 * `predicate(entry)` is truthy. Misformed lines (interrupted
 * appendFileSync, partial writes) are skipped, not thrown — JSONL
 * files can rot at the tail.
 *
 * Buffered (not truly streaming): the whole file lands in a UTF-8
 * string before iteration. At current Lariat scale (thousands of
 * ~1 KB entries) this peaks under 10 MB and is fine. Revisit with
 * a `readline`/`createReadStream` rewrite if the file ever grows
 * past low-tens-of-MB or rotation is added. The output is the
 * matched-only subset — much smaller than the input.
 *
 * The writer is `logAuditAction` via `appendFileSync` on Node/macOS,
 * so lines are always LF-terminated, never CRLF. `split('\n')` is
 * safe under that contract.
 *
 * Audit ref: docs/audit/2026-05-08-codebase-audit.md §1.
 *
 * @param {(entry: AuditLogRecord) => boolean} predicate
 * @returns {AuditLogRecord[]}
 */
function streamFilter(predicate) {
  const file = resolveAuditLogFile();
  if (!fs.existsSync(file)) {
    return [];
  }

  const content = fs.readFileSync(file, 'utf-8');
  /** @type {AuditLogRecord[]} */
  const out = [];
  // Iterate without filtering empties first so we don't materialize
  // an intermediate copy of every line; rely on the empty-line skip
  // inside the loop. `split('\n')` is fine — JSONL is one entry per
  // line, no embedded newlines.
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    /** @type {AuditLogRecord} */
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      // Skip half-written / corrupted line.
      continue;
    }
    if (predicate(entry)) {
      out.push(entry);
    }
  }
  // Newest-first to preserve the prior contract — getRecentAuditLog
  // reverses on read, and `getAuditLogByAction` / `getAuditLogForRecipe`
  // used to filter that already-reversed array. Their consumer at
  // app/api/audit/log/route.js:51 does `.slice(0, limit)`; if we
  // returned oldest-first here that slice would silently flip the UI's
  // "recent edits" view to "ancient edits."
  return out.reverse();
}

/**
 * Get audit log entries for a specific action
 * @param {string} action - The action type to filter by (e.g., 'recipe_edit', 'cost_update')
 * @returns {AuditLogRecord[]}
 */
export function getAuditLogByAction(action) {
  try {
    return streamFilter(entry => entry.action === action);
  } catch (error) {
    console.error('Failed to filter audit log:', error);
    return [];
  }
}

/**
 * Get audit log entries for a specific recipe
 * @param {string} slug - Recipe slug
 * @returns {AuditLogRecord[]}
 */
export function getAuditLogForRecipe(slug) {
  try {
    return streamFilter(entry => entry.slug === slug);
  } catch (error) {
    console.error('Failed to get recipe audit log:', error);
    return [];
  }
}

/**
 * Export audit log entries whose timestamp falls within
 * `[startDate, endDate]` (inclusive). Scans the full JSONL, no
 * silent cap — the prior implementation went through
 * `getRecentAuditLog(5000)`, which silently dropped any matching
 * entry past the last 5000 rows. For compliance/reporting that's
 * an integrity hole: an inspector requesting "all edits in
 * January" would see "no edits" if January matches sat past the
 * 5000-row tail.
 *
 * Returns newest-first to match `getAuditLogByAction` /
 * `getAuditLogForRecipe` (streamFilter reverses before return).
 * Entries with unparseable `timestamp` values are skipped, not
 * crashed — the predicate returns `false` on NaN.
 *
 * If `startDate` or `endDate` is itself unparseable (e.g. an
 * empty string or a non-date string), the function returns `[]`
 * immediately rather than throwing — same defensive posture as
 * the per-entry NaN skip. Compliance callers get a deterministic
 * empty result instead of a crash.
 *
 * Audit ref: docs/audit/2026-05-08-codebase-audit.md §1 follow-up;
 * PR #208 noted this scope-deferral.
 *
 * @param {Date|string|number} startDate - Start of export window (inclusive)
 * @param {Date|string|number} endDate - End of export window (inclusive)
 * @returns {AuditLogRecord[]}
 */
export function exportAuditLog(startDate, endDate) {
  try {
    const startMs = startDate instanceof Date ? startDate.getTime() : new Date(startDate).getTime();
    const endMs = endDate instanceof Date ? endDate.getTime() : new Date(endDate).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return [];
    }
    return streamFilter(entry => {
      const ts = new Date(entry.timestamp).getTime();
      if (!Number.isFinite(ts)) return false;
      return ts >= startMs && ts <= endMs;
    });
  } catch (error) {
    console.error('Failed to export audit log:', error);
    return [];
  }
}
