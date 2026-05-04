#!/usr/bin/env node
// Coverage test — every regulated mutation route must opt into
// withIdempotency from lib/idempotency.ts.
//
// Task 4 of the §8 P1 plan. Walks every app/api/**/route.{js,ts}
// file, checks each non-allowlisted exported POST/PUT/PATCH/DELETE
// handler for a withIdempotency reference, and fails with the
// punch list of routes that drifted away from the doctrine.
//
// The allowlist is for routes that legitimately don't need the
// wrapper (read-only routes that don't have a POST/PUT/PATCH/DELETE,
// or auth-issuance, or stubs). Each entry has a one-line rationale
// so the next auditor doesn't have to re-derive it.
//
// Run: node --experimental-strip-types --test tests/js/test-idempotency-coverage.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(__dirname, '../../app/api');

// Routes permanently exempt from the wrapper.
//
// Path is the relative route directory (no leading /api), e.g. 'auth/pin'.
// Each entry has a one-line rationale so the next auditor doesn't have
// to re-derive it.
const ALLOWLIST = new Set([
  // Auth issuance — the cookie itself is the idempotency token; replaying
  // a /api/auth/pin POST returns a fresh signed cookie either way, and
  // the route is rate-limited (5/60s/IP).
  'auth/pin',
  // mDNS hub discovery stub. Not regulated, no DB writes.
  'discover',
  // Cloud-bridge status stub. Read-only.
  'cloud-bridge/status',
  // Audit-log read endpoint. GET-only.
  'audit/log',
  // CSV export endpoint — generates output, no DB write.
  'specials/saved/[id]/export',
]);

// Routes that SHOULD be wrapped per the §8 P1 plan but haven't been
// retrofitted yet. Each entry blocks new un-wrapped routes from
// landing while letting the test stay green during the staged
// rollout. Drains in follow-up PRs.
//
// Plan: docs/superpowers/plans/2026-05-02-sw-replay-idempotency-plan.md
// Goal: empty this set.
const TODO_RETROFIT = new Set([
  // Operational / front-of-house — duplicate writes are annoying but
  // not regulatorily critical; lower priority than HACCP/financial.
  'dining-tables',
  'dining-tables/[id]',
  // (equipment + maintenance + parts + schedule drained in feat/idempotency-retrofit-equipment)
  'gold-stars',
  'gold-stars/[id]',
  'kitchen-assistant',
  'prep-tasks',
  'prep-tasks/[id]',
  'reservations',
  'reservations/[id]',
  'service-hours',
  'preshift-notes',
  'checks',
  'cleaning-schedule',
  // Recipe edit — slug uniqueness gives partial protection but a
  // PUT replay would still re-write all fields. Defer.
  'recipes/[slug]',
  // (specials, specials/saved, specials/saved/[id] drained in
  //  feat/idempotency-retrofit-specials. /api/specials POST drives
  //  Ollama — wrap dedupes both DB writes from saved + wasted Ollama
  //  cycles on replay. PIN gate runs first on saved/[id] PATCH/DELETE.)
  // Compute trigger — POSTs to status route. Defer.
  'compute/status',
  // Costing pack-changes — already covered by acknowledged uniqueness
  // (pack_size_changes.id); wrap is defense-in-depth. Defer.
  'costing/pack-changes',
  // Dish-components POST — operational/financial; defer.
  'dish-components',
  // (Inventory cluster — inventory, inventory/counts (+ [id], + [id]/lines),
  //  inventory/par — drained in feat/idempotency-retrofit-inventory.
  //  All write inventory_updates / inventory_counts / inventory_count_lines /
  //  inventory_par with audit_events; wrapper sits above the existing tx.)
  // (Eighty-six + resolve, breaks, certifications drained in
  //  feat/idempotency-retrofit-labor-stockout — the labor-compliance and
  //  regulated-stockout block. Each wraps withIdempotency at the
  //  POST/PATCH boundary; PIN-gated routes (certifications) keep the
  //  gate ordering: gate first, wrapper second.)
  // (Show event-ops Phase 2 routes — sound/stage/deal/box-office/[lineId]/
  //  sound/[sceneId] — drained in feat/idempotency-retrofit-shows-phase2;
  //  all five routes now wrap withIdempotency at the PUT/POST/PATCH/DELETE
  //  boundary. The PIN-gate runs first; the wrapper sits between the gate
  //  and the handler body. Defense-in-depth on top of repo-level row guards
  //  like markScanned's scanned_at IS NULL.)
  // (HACCP rule-module routes drained in feat/idempotency-retrofit-haccp-rules:
  //  beo, cleaning, cooling, date-marks, pest, sanitizer-check, sds, sick-worker,
  //  thermometer-calibrations, tphc — all now wrap withIdempotency.)
]);

function walkRoutes(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walkRoutes(full, rel));
    } else if (entry.isFile() && /^route\.(js|ts|tsx|mjs)$/.test(entry.name)) {
      const routePath = prefix; // dir-relative path under app/api
      out.push({ filePath: full, routePath });
    }
  }
  return out;
}

const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function findMutationExports(src) {
  const found = [];
  for (const method of MUTATION_METHODS) {
    // Match `export async function POST(` or `export function POST(`
    const re = new RegExp(`^export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`, 'm');
    if (re.test(src)) found.push(method);
  }
  return found;
}

describe('idempotency coverage — every regulated mutation route is wrapped', () => {
  const routes = walkRoutes(API_ROOT);
  const violations = [];

  for (const { filePath, routePath } of routes) {
    if (ALLOWLIST.has(routePath)) continue;
    if (TODO_RETROFIT.has(routePath)) continue;
    const src = fs.readFileSync(filePath, 'utf8');
    const methods = findMutationExports(src);
    if (methods.length === 0) continue;

    const refsWrapper = /withIdempotency/.test(src);
    if (!refsWrapper) {
      violations.push({ routePath, methods, filePath });
    }
  }

  it('produces an empty violation list', () => {
    if (violations.length === 0) {
      // Pass — every regulated mutation route is wrapped (or allowlisted).
      return;
    }
    const lines = violations.map((v) =>
      `  /api/${v.routePath} [${v.methods.join(', ')}] — ${path.relative(process.cwd(), v.filePath)}`,
    );
    assert.fail(
      `${violations.length} regulated mutation route(s) missing withIdempotency:\n${lines.join('\n')}\n\n` +
        `Either:\n` +
        `  (a) wrap the handler in withIdempotency from lib/idempotency.ts (preferred — see PR #118 / #119 / #120 for the pattern), or\n` +
        `  (b) add the route to ALLOWLIST in this test with a one-line rationale.`,
    );
  });

  it('every allowlisted / TODO_RETROFIT route actually exists', () => {
    // Guard against rot — a renamed route in either list would silently
    // pass the main check forever. Walk every entry and confirm the
    // route file is still on disk.
    const realRoutes = new Set(routes.map((r) => r.routePath));
    const staleAllow = [...ALLOWLIST].filter((p) => !realRoutes.has(p));
    const staleTodo = [...TODO_RETROFIT].filter((p) => !realRoutes.has(p));
    assert.deepStrictEqual(staleAllow, [], `ALLOWLIST has stale entries: ${staleAllow.join(', ')}`);
    assert.deepStrictEqual(staleTodo, [], `TODO_RETROFIT has stale entries: ${staleTodo.join(', ')}`);
  });

  it('TODO_RETROFIT shrinks over time (informational)', () => {
    // Not an assertion — just a stable count we can grep for in CI
    // logs. A future PR shrinks the set as routes are retrofitted.
    // The check here exists so a reviewer notices when the count drops.
    // Currently expected: see TODO_RETROFIT above.
    const remaining = TODO_RETROFIT.size;
    console.log(`[idempotency-coverage] TODO_RETROFIT remaining: ${remaining}`);
  });
});
