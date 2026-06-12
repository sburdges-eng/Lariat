#!/usr/bin/env node
// Coverage test — every regulated mutation route must be PIN-gated
// either by middleware.js's matcher prefix OR by an explicit
// hasPinCookie / hasPinOrTempPin / requirePin call at the route level.
//
// Audit DiD opportunity from docs/audit/2026-05-08-codebase-audit.md §1:
//   "Add an integration test that POSTs every route in middleware.js's
//    SENSITIVE list without the cookie and asserts 401 — would have
//    caught the cleaning-schedule PATCH gap and any future regression."
//
// A prior dispatch (T32) tried integration-testing middleware directly
// but `node --test` can't easily exercise Next.js's HTTP-layer middleware
// without a running dev server. Pivoted to static analysis mirroring
// the shape of tests/js/test-idempotency-coverage.mjs:
//
//   For every app/api/**/route.{js,ts} file that exports a mutation
//   method (POST/PUT/PATCH/DELETE), assert one of:
//     (a) the route's path matches a middleware.js matcher prefix
//         (gated by the framework before the handler runs), or
//     (b) the route source calls hasPinCookie / hasPinOrTempPin
//         (gated at the route level — defense in depth for routes the
//         matcher doesn't cover), or
//     (c) the route is on the ALLOWLIST below with a one-line rationale.
//
// Catches the cleaning-schedule PATCH gap class (closed in PR #187)
// without needing Next.js HTTP infra.
//
// Run: node --test tests/js/test-pin-gate-coverage.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const API_ROOT = path.join(REPO_ROOT, 'app/api');
const MIDDLEWARE_PATH = path.join(REPO_ROOT, 'middleware.js');

// Routes that legitimately need NO PIN gate. Path is the relative route
// directory under app/api, e.g. 'auth/pin'. Each entry has a one-line
// rationale so the next auditor doesn't have to re-derive it.
//
// The Lariat threat model: PIN-gated routes are manager/owner authority
// (analytics, costing, financial, regulated reads). The vast majority of
// kitchen mutation routes (HACCP logs, prep tasks, FOH ops, inventory
// counts) MUST stay open to line cooks who don't carry a PIN — gating
// them would shut down service. The audit's DiD opportunity is to lock
// in the existing posture so a NEW route doesn't drift into the
// SENSITIVE namespace without a gate. Drift detection, not coverage.
const ALLOWLIST = new Set([
  // ── Auth issuance (chicken-and-egg) ────────────────────────────────
  // The PIN itself is the credential being exchanged for the cookie.
  // Rate-limited (5/60s/IP) per app/api/auth/pin/route.ts.
  'auth/pin',
  // The temp PIN itself is the credential being exchanged for the
  // temp-pin cookie. Audit §1 flags missing rate limit as a separate
  // finding (not this test's scope).
  'auth/temp-pin/login',

  // ── Pre-auth discovery / health (must work before login) ───────────
  // mDNS hub discovery stub used during peer-discovery handshake.
  'discover',
  // Peer-discovery surface — pre-auth handshake. Audit §1 flags
  // `pubkey_fp` exposure as a separate finding (not this test's scope).
  'peers',
  // Location bootstrap — the multi-site selector reads the location
  // list before any sensitive surface is reachable.
  'locations',

  // ── HACCP rule-module routes (line-cook authority by design) ───────
  // Every HACCP rule module is logged by line cooks under pressure
  // without a manager PIN. Out-of-range readings must be loggable in
  // the moment so the corrective-action workflow can fire (CLAUDE.md
  // hard rule: "never weaken validations or silently auto-correct").
  // Audit ownership = the cook who wrote the row + the audit_events
  // chain, not a PIN gate.
  'cleaning',
  'cooling',
  'date-marks',
  'pest',
  'receiving',
  'sanitizer',
  'sds',
  'signoff',
  'thermometer-calibrations',
  'tphc',
  // Cleaning-schedule (template definitions, separate from cleaning logs)
  // is intentionally NOT PIN-gated — line cooks add/edit recurring
  // tasks. Audit §1 finding #4 was about cross-tenant location_id
  // rewrite on PATCH, fixed in PR #187 by dropping location_id from
  // PATCH-able fields rather than adding a gate. See route comment at
  // app/api/cleaning-schedule/route.js:130-138.
  'cleaning-schedule',

  // ── Front-of-house operational (host-stand authority) ──────────────
  // Reservations, dining-table state, service-hours: host/server
  // surface. No regulatory weight; gating would block normal service.
  'dining-tables',
  'dining-tables/[id]',
  'reservations',
  'reservations/[id]',
  'service-hours',
  // Gold-stars index (kudos) — staff recognition create/read stays open
  // to line staff. The by-id DELETE route is explicitly manager-PIN gated
  // because it removes recognition from the board.
  'gold-stars',

  // ── Prep / kitchen workflow (line-cook authority) ──────────────────
  'prep-tasks',
  'prep-tasks/[id]',
  'preshift-notes',
  'kds/tickets',
  'kds/tickets/[id]/bump',
  'checks',
  // 86-list — line cooks mark a dish unavailable mid-service.
  'eighty-six',
  'eighty-six/resolve',
  // Voice transcription for the LaRi composer (LARIAT_WHISPER opt-in).
  // No DB write — the transcript only lands in the caller's own
  // textarea; cook-tier surface used mid-service with wet hands, same
  // posture as the composer it feeds. CPU abuse is bounded by the 413
  // payload cap and the LAN-only deployment.
  'transcribe',

  // ── Inventory counts (line-cook authority during count nights) ─────
  // Counts are entered on the line by whoever's running inventory; no
  // financial impact until reconciled by the costing path (which IS
  // PIN-gated via /api/costing/*).
  'inventory',
  'inventory/counts',
  'inventory/counts/[id]',
  'inventory/counts/[id]/lines',
  'inventory/par',

  // ── Equipment / maintenance (BOH self-service) ─────────────────────
  // Equipment logging is a maintenance signal, not a regulated record.
  'equipment',
  'equipment/maintenance',
  'equipment/parts',
  'equipment/schedule',

  // ── Recipe components (BOH dish-construction authority) ────────────
  // BOM editing is line-cook authority during recipe development; the
  // financial roll-up that depends on it (costing) is PIN-gated.
  'dish-components',

  // ── Labor surfaces (employee self-service via temp-pin scope) ──────
  // breaks: punch-in/punch-out for the worker themselves.
  'breaks',
  // performance-reviews: manager surface but not yet middleware-gated.
  // Tracked as a follow-up in the audit doc; allowlisting here pins
  // the current posture so we notice if it changes.
  'performance-reviews',
  'performance-reviews/[id]',

  // ── Specials sandbox v1 (ephemeral, pre-PIN by design) ─────────────
  // Audit §1 line 237: "Specials sandbox v1 ephemeral contract holds —
  // app/api/specials/route.js has no DB writes; persistence only via
  // saved/ sub-routes (PIN-gated via middleware on /api/specials/saved/*)."
  'specials',

  // ── Cloud-bridge status (diagnostic, pre-auth so the splash works) ─
  'cloud-bridge/status',
]);

// ------- middleware-matcher parsing -------

function parseMiddlewareMatcherPrefixes(src) {
  // Pull every quoted string out of the `matcher: [...]` array literal.
  // Each entry looks like '/api/costing/:path*' or '/specials/saved'.
  // Convert to a path prefix usable against an app/api route directory:
  //   '/api/costing/:path*'   -> { apiPrefix: 'costing/',     exact: false }
  //   '/api/specials/saved'   -> { apiPrefix: 'specials/saved', exact: true  }
  //   '/analytics/:path*'     -> page-level, ignore for /api coverage
  const matcherMatch = src.match(/matcher\s*:\s*\[([\s\S]*?)\]/);
  if (!matcherMatch) {
    throw new Error('middleware.js: could not locate matcher array');
  }
  const entries = [...matcherMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);

  const apiPrefixes = []; // { prefix, exact }
  for (const entry of entries) {
    if (!entry.startsWith('/api/')) continue;
    const stripped = entry.slice('/api/'.length);
    if (stripped.endsWith('/:path*')) {
      apiPrefixes.push({ prefix: stripped.slice(0, -':path*'.length), exact: false });
    } else if (stripped.includes(':')) {
      // Unrecognized dynamic segment — skip rather than misclassify.
      continue;
    } else {
      apiPrefixes.push({ prefix: stripped, exact: true });
    }
  }
  return apiPrefixes;
}

function isGatedByMiddleware(routePath, prefixes) {
  // routePath is e.g. 'costing/depletion-exceptions' (no leading 'api/').
  for (const { prefix, exact } of prefixes) {
    if (exact) {
      if (routePath === prefix.replace(/\/$/, '')) return true;
    } else {
      // 'costing/' matches 'costing' (the index) and 'costing/foo'.
      const normalized = prefix.replace(/\/$/, '');
      if (routePath === normalized || routePath.startsWith(`${normalized}/`)) return true;
    }
  }
  return false;
}

// ------- route-file walking + classification -------

function walkRoutes(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walkRoutes(full, rel));
    } else if (entry.isFile() && /^route\.(js|ts|tsx|mjs)$/.test(entry.name)) {
      out.push({ filePath: full, routePath: prefix });
    }
  }
  return out;
}

const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function findMutationExports(src) {
  const found = [];
  for (const method of MUTATION_METHODS) {
    const re = new RegExp(`^export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`, 'm');
    if (re.test(src)) found.push(method);
  }
  return found;
}

function callsPinGateAtRoute(src) {
  // Either the canonical helpers from lib/pin.ts, or the per-route
  // requirePin shim used by ~16 routes (audit §1 flags consolidating
  // these as a separate finding — until then, both count as gated).
  // requirePin(?:OrScope)? matches both the unscoped (PR #221) and the
  // scoped (PR #222) extracted helpers in lib/pin.ts.
  return /\b(?:hasPinCookie|hasPinOrTempPin|requirePin(?:OrScope)?)\b/.test(src);
}

// ------- test -------

describe('pin-gate coverage — every regulated mutation route is gated', () => {
  const middlewareSrc = fs.readFileSync(MIDDLEWARE_PATH, 'utf8');
  const middlewarePrefixes = parseMiddlewareMatcherPrefixes(middlewareSrc);
  const routes = walkRoutes(API_ROOT);
  const violations = [];

  for (const { filePath, routePath } of routes) {
    if (ALLOWLIST.has(routePath)) continue;
    const src = fs.readFileSync(filePath, 'utf8');
    const methods = findMutationExports(src);
    if (methods.length === 0) continue;

    const middlewareGated = isGatedByMiddleware(routePath, middlewarePrefixes);
    const routeGated = callsPinGateAtRoute(src);
    if (!middlewareGated && !routeGated) {
      violations.push({ routePath, methods, filePath });
    }
  }

  it('produces an empty violation list', () => {
    if (violations.length === 0) return;
    const lines = violations.map(
      (v) =>
        `  /api/${v.routePath} [${v.methods.join(', ')}] — ${path.relative(process.cwd(), v.filePath)}`,
    );
    assert.fail(
      `${violations.length} regulated mutation route(s) without PIN gate:\n${lines.join('\n')}\n\n` +
        `Either:\n` +
        `  (a) add the route prefix to middleware.js's matcher (preferred for /management/* style page-level surfaces), or\n` +
        `  (b) call hasPinCookie(req) (or hasPinOrTempPin) at the top of the route handler (preferred for /api/* mutation routes), or\n` +
        `  (c) add the route to ALLOWLIST in this test with a one-line rationale.`,
    );
  });

  it('every allowlisted route actually exists', () => {
    // Guard against rot — a renamed route in the allowlist would silently
    // pass the main check forever. Walk every entry and confirm the
    // route file is still on disk.
    const realRoutes = new Set(routes.map((r) => r.routePath));
    const stale = [...ALLOWLIST].filter((p) => !realRoutes.has(p));
    assert.deepStrictEqual(stale, [], `ALLOWLIST has stale entries: ${stale.join(', ')}`);
  });

  it('middleware matcher parses to at least the documented /api prefixes', () => {
    // Sanity-pin the parser against a few prefixes we know are in
    // middleware.js. If middleware.js is reformatted in a way that breaks
    // parseMiddlewareMatcherPrefixes, this fails loudly instead of
    // silently flipping every route to "ungated."
    const flat = middlewarePrefixes.map((p) => p.prefix).sort();
    for (const required of ['costing/', 'analytics/', 'compute/', 'audit/']) {
      assert.ok(
        flat.includes(required),
        `middleware matcher parser missed expected prefix '${required}' (parsed: ${flat.join(', ')})`,
      );
    }
  });
});
