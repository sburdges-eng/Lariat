#!/usr/bin/env node
/**
 * smoke-vendor-compare-v2.mjs — post-ship critical path for vendor compare v2.
 *
 * Uses the local SQLite file at data/lariat.db (same as dev) by default.
 * Pass --copy to run against a temp clone instead of mutating the local DB.
 *
 * Usage:
 *   npm run smoke:vendor-compare-v2
 *   node --experimental-strip-types scripts/smoke-vendor-compare-v2.mjs --copy
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const USE_COPY = process.argv.includes('--copy');

register(new URL('../tests/js/resolver.mjs', import.meta.url));

const BEVERAGE_CATEGORIES = ['beer', 'wine', 'liquor', 'na beverage'];

const CANONICAL_FALLBACK = 'Smoke staple';

/** @type {{ syscoKey: { vendor: string; sku: string; ingredient: string }; shamrockKey: { vendor: string; sku: string; ingredient: string }; canonicalName: string } | null} */
function findSmokePair(db) {
  const row = db.prepare(
    `
    SELECT
      s.sku AS sysco_sku,
      s.ingredient AS sysco_ingredient,
      sh.sku AS shamrock_sku,
      sh.ingredient AS shamrock_ingredient
    FROM vendor_prices s
    JOIN vendor_prices sh
      ON sh.location_id = s.location_id
     AND lower(trim(sh.vendor)) = 'shamrock'
     AND (sh.master_id IS NULL OR trim(sh.master_id) = '')
    WHERE s.location_id = 'default'
      AND lower(trim(s.vendor)) = 'sysco'
      AND (s.master_id IS NULL OR trim(s.master_id) = '')
      AND (
        (lower(s.ingredient) LIKE '%basil%' AND lower(sh.ingredient) LIKE '%basil%')
        OR (lower(s.ingredient) LIKE '%baking soda%' AND lower(sh.ingredient) LIKE '%baking%')
        OR (lower(s.ingredient) LIKE '%cream cheese%' AND lower(sh.ingredient) LIKE '%cream%cheese%')
        OR (lower(s.ingredient) LIKE '%parsley%' AND lower(sh.ingredient) LIKE '%parsley%')
        OR (lower(s.ingredient) LIKE '%cilantro%' AND lower(sh.ingredient) LIKE '%cilantro%')
      )
    LIMIT 1
  `,
  ).get();
  if (!row) return null;
  const label = row.sysco_ingredient.replace(/\s+/g, ' ').trim().slice(0, 40);
  return {
    syscoKey: { vendor: 'sysco', sku: row.sysco_sku, ingredient: row.sysco_ingredient },
    shamrockKey: { vendor: 'shamrock', sku: row.shamrock_sku, ingredient: row.shamrock_ingredient },
    canonicalName: label || CANONICAL_FALLBACK,
  };
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`✓ ${msg}`);
}

function simulateIngestVpSweep(db, locationId = 'default') {
  const bevPlaceholders = BEVERAGE_CATEGORIES.map(() => '?').join(',');
  const operatorVpMasterByKey = new Map();
  const masterSnapRows = db.prepare(
    `SELECT vendor, sku, master_id FROM vendor_prices
      WHERE location_id = ?
        AND master_id IS NOT NULL AND TRIM(master_id) != ''
        AND COALESCE(LOWER(category), '') NOT IN (${bevPlaceholders})`,
  ).all(locationId, ...BEVERAGE_CATEGORIES);
  for (const r of masterSnapRows) {
    const vendor = String(r.vendor ?? '').trim().toLowerCase();
    const sku = String(r.sku ?? '');
    if (!vendor || !sku) continue;
    operatorVpMasterByKey.set(`${vendor}\x1f${sku}`, String(r.master_id));
  }

  const workbookRows = db
    .prepare(
      `SELECT ingredient, vendor, sku, pack_size, pack_unit, unit_price, category
         FROM vendor_prices WHERE location_id = ? AND COALESCE(LOWER(category), '') NOT IN (${bevPlaceholders})`,
    )
    .all(locationId, ...BEVERAGE_CATEGORIES);

  db.prepare(
    `DELETE FROM vendor_prices WHERE location_id = ? AND COALESCE(LOWER(category), '') NOT IN (${bevPlaceholders})`,
  ).run(locationId, ...BEVERAGE_CATEGORIES);

  const ins = db.prepare(
    `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id, category)
     VALUES (@ingredient, @vendor, @sku, @pack_size, @pack_unit, @unit_price, @location_id, @category)`,
  );
  for (const r of workbookRows) {
    ins.run({
      ingredient: r.ingredient,
      vendor: r.vendor,
      sku: r.sku,
      pack_size: r.pack_size,
      pack_unit: r.pack_unit,
      unit_price: r.unit_price,
      location_id: locationId,
      category: r.category,
    });
  }

  const reapplyVpMaster = db.prepare(`
    UPDATE vendor_prices
       SET master_id = @master_id
     WHERE location_id = @location_id
       AND lower(trim(vendor)) = @vendor
       AND sku = @sku
  `);
  for (const [key, masterId] of operatorVpMasterByKey) {
    const sep = key.indexOf('\x1f');
    const vendor = key.slice(0, sep);
    const sku = key.slice(sep + 1);
    reapplyVpMaster.run({ master_id: masterId, location_id: locationId, vendor, sku });
  }
}

const { resolveDataDir } = await import('../lib/dataDir.ts');
const localDb = path.join(resolveDataDir(), 'lariat.db');

if (!fs.existsSync(localDb)) {
  fail(`local SQLite missing: ${localDb}`);
}

let dbPath = localDb;
let tempCopy = null;
if (USE_COPY) {
  tempCopy = path.join(os.tmpdir(), `lariat-smoke-v2-${Date.now()}.db`);
  fs.copyFileSync(localDb, tempCopy);
  dbPath = tempCopy;
  console.log(`smoke DB copy: ${dbPath}`);
} else {
  console.log(`smoke DB (local sqlite): ${dbPath}`);
}

const { setDbPathForTest, getDb } = await import('../lib/db.ts');
setDbPathForTest(dbPath);
const db = getDb();

delete process.env.LARIAT_PIN;

const { POST: postPair } = await import('../app/api/purchasing/vendor-link/pair/route.js');
const { GET: getCompare } = await import('../app/api/purchasing/vendor-compare/route.js');
const { enrichOrderGuideRow } = await import('../lib/orderGuideEnrichment.ts');

const pairCandidate = findSmokePair(db);
if (!pairCandidate) {
  fail('no unlinked sysco+shamrock pair found in local DB — link one manually or run ingest:costing');
}
const { syscoKey: SYSCO_KEY, shamrockKey: SHAMROCK_KEY, canonicalName: CANONICAL } = pairCandidate;
console.log(`pair candidate: ${CANONICAL} (${SYSCO_KEY.sku} ↔ ${SHAMROCK_KEY.sku})`);

const beforeCmp = await getCompare(new Request('http://localhost/api/purchasing/vendor-compare'));
if (beforeCmp.status !== 200) fail(`compare GET before pair: ${beforeCmp.status}`);
const beforeBody = await beforeCmp.json();
const beforePairs = Number(beforeBody.masters_with_both_vendors ?? 0);

const pairRes = await postPair(
  new Request('http://localhost/api/purchasing/vendor-link/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      syscoKey: SYSCO_KEY,
      shamrockKey: SHAMROCK_KEY,
      canonicalName: CANONICAL,
    }),
  }),
);
if (pairRes.status === 200) {
  pass(`paired Sysco ${SYSCO_KEY.sku} ↔ Shamrock ${SHAMROCK_KEY.sku} as "${CANONICAL}"`);
} else if (pairRes.status === 409) {
  pass(`pair already linked (${SYSCO_KEY.sku} ↔ ${SHAMROCK_KEY.sku}) — continuing smoke`);
} else {
  const err = await pairRes.text();
  fail(`pair POST: ${pairRes.status} ${err}`);
}

const afterCmp = await getCompare(new Request('http://localhost/api/purchasing/vendor-compare'));
const afterBody = await afterCmp.json();
const afterPairs = Number(afterBody.masters_with_both_vendors ?? 0);
if (pairRes.status === 200 && afterPairs !== beforePairs + 1) {
  fail(`compare pairs ${beforePairs} → ${afterPairs} (expected +1)`);
}
if (pairRes.status === 409 && afterPairs < beforePairs) {
  fail(`compare pairs regressed ${beforePairs} → ${afterPairs}`);
}
pass(`compare masters_with_both_vendors ${beforePairs} → ${afterPairs}`);

const masterRow = db
  .prepare(
    `SELECT master_id FROM vendor_prices WHERE lower(trim(vendor))='sysco' AND sku=? LIMIT 1`,
  )
  .get(SYSCO_KEY.sku);
if (!masterRow?.master_id) fail('master_id missing on sysco VP after pair');
const masterId = String(masterRow.master_id);

db.prepare(`UPDATE ingredient_masters SET preferred_vendor = 'sysco' WHERE master_id = ?`).run(masterId);

const shamrockVp = db
  .prepare(
    `SELECT ingredient, vendor, pack_size, pack_unit, unit_price FROM vendor_prices
      WHERE lower(trim(vendor))='shamrock' AND sku=? LIMIT 1`,
  )
  .get(SHAMROCK_KEY.sku);
const enrichment = enrichOrderGuideRow(db, {
  ingredient: shamrockVp.ingredient,
  vendor: shamrockVp.vendor,
  base_qty: shamrockVp.pack_size,
  unit: shamrockVp.pack_unit,
  unit_price: shamrockVp.unit_price,
});
if (!enrichment?.vendor_mismatch) {
  fail('order guide enrichment: expected vendor_mismatch when preferred=sysco, guide=shamrock');
}
pass('order guide mismatch badge data (preferred sysco, guide shamrock)');

const masterIdBeforeIngest = masterId;
simulateIngestVpSweep(db);

const syscoAfter = db
  .prepare(
    `SELECT master_id FROM vendor_prices WHERE lower(trim(vendor))='sysco' AND sku=? LIMIT 1`,
  )
  .get(SYSCO_KEY.sku);
const shamrockAfter = db
  .prepare(
    `SELECT master_id FROM vendor_prices WHERE lower(trim(vendor))='shamrock' AND sku=? LIMIT 1`,
  )
  .get(SHAMROCK_KEY.sku);
if (syscoAfter?.master_id !== masterIdBeforeIngest || shamrockAfter?.master_id !== masterIdBeforeIngest) {
  fail('ingest VP sweep dropped master_id links');
}
pass('ingest VP sweep preserved master_id on both vendors');

if (tempCopy) {
  try {
    fs.unlinkSync(tempCopy);
  } catch {
    /* ignore */
  }
}

console.log('\nOK — vendor compare v2 smoke passed');
