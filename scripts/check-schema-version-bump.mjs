#!/usr/bin/env node
// Pre-commit guard: if a staged change to lib/db.ts touches initSchema's
// DDL, require SCHEMA_VERSION to be bumped in the same commit.
//
// The native macOS read-only app (P1a spec §7) trusts
// `schema_migrations.MAX(version)` as a drift marker: it reads the version,
// compares it to the version it was built against, and degrades gracefully
// on mismatch. That trust only holds if every schema edit bumps
// SCHEMA_VERSION — otherwise the web app silently changes the schema while
// the marker still says "unchanged", and the native guard never fires.
//
// The check is a heuristic over the staged unified diff: if any added or
// removed line in lib/db.ts looks like schema DDL (CREATE TABLE / ALTER
// TABLE / ADD COLUMN / CREATE INDEX / DROP ...), the same diff must also
// change the `SCHEMA_VERSION = N` line.
//
// Override (rare — e.g. a comment-only edit inside the DDL the heuristic
// miscatches):
//   LARIAT_ALLOW_SCHEMA_NO_BUMP=1 git commit ...

import { execSync } from 'node:child_process';

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf8' });
}

const DB_FILE = 'lib/db.ts';

const staged = git('diff --cached --name-only')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

if (!staged.includes(DB_FILE)) process.exit(0);

// Added/removed lines from the staged diff for lib/db.ts only (skip the
// +++/--- file headers so a renamed path can't masquerade as DDL).
const changed = git(`diff --cached -- ${DB_FILE}`)
  .split('\n')
  .filter(
    (l) =>
      (l.startsWith('+') || l.startsWith('-')) &&
      !l.startsWith('+++') &&
      !l.startsWith('---'),
  );

const DDL =
  /\b(CREATE\s+(TABLE|UNIQUE\s+INDEX|INDEX|VIRTUAL\s+TABLE|TRIGGER|VIEW)|ALTER\s+TABLE|ADD\s+COLUMN|DROP\s+(TABLE|INDEX|COLUMN|TRIGGER|VIEW))\b/i;

const touchesDDL = changed.some((l) => DDL.test(l));
if (!touchesDDL) process.exit(0);

const bumpsVersion = changed.some((l) => /SCHEMA_VERSION\s*=/.test(l));
if (bumpsVersion) process.exit(0);

if (process.env.LARIAT_ALLOW_SCHEMA_NO_BUMP) {
  console.warn(
    '⚠ lib/db.ts schema DDL changed without a SCHEMA_VERSION bump — allowed via LARIAT_ALLOW_SCHEMA_NO_BUMP.',
  );
  process.exit(0);
}

console.error('✗ refusing to commit: lib/db.ts schema DDL changed but SCHEMA_VERSION was not bumped.');
console.error('  The native read-only app (P1a §7) reads schema_migrations.MAX(version) to detect drift.');
console.error('  Bump `export const SCHEMA_VERSION` in lib/db.ts so the marker reflects the new schema.');
console.error('  Override (comment-only / false positive): LARIAT_ALLOW_SCHEMA_NO_BUMP=1 git commit ...');
process.exit(1);
