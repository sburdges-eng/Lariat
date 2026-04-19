#!/usr/bin/env node
// Validate data/cache/*.json shape. Run: npm run validate-cache

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'cache');

let failed = false;
function fail(msg) {
  console.error('✗', msg);
  failed = true;
}

function needFile(name) {
  const p = path.join(CACHE, name);
  if (!fs.existsSync(p)) {
    fail(`missing ${p}`);
    return null;
  }
  let j;
  try {
    j = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail(`${name}: invalid JSON — ${e.message}`);
    return null;
  }
  return j;
}

let errors = 0;

const stations = needFile('stations.json');
if (stations) {
  if (!Array.isArray(stations) || !stations.length) {
    fail('stations.json must be a non-empty array');
    errors++;
  } else {
    for (const s of stations) {
      if (!s.id || !s.name) {
        fail(`stations.json entry missing id/name: ${JSON.stringify(s)}`);
        errors++;
      }
    }
  }
}

const staff = needFile('staff.json');
if (staff) {
  if (!Array.isArray(staff)) {
    fail('staff.json must be an array');
    errors++;
  } else {
    for (const s of staff) {
      if (!s.id || !s.first || !s.last) {
        fail(`staff.json entry missing id/first/last: ${JSON.stringify(s)}`);
        errors++;
      }
    }
  }
}

const lineChecks = needFile('line_checks.json');
if (lineChecks) {
  if (typeof lineChecks !== 'object' || Array.isArray(lineChecks)) {
    fail('line_checks.json must be an object of station key -> string[]');
    errors++;
  } else {
    for (const [k, v] of Object.entries(lineChecks)) {
      if (!Array.isArray(v)) {
        fail(`line_checks.${k} must be an array`);
        errors++;
      }
    }
  }
}

const setups = needFile('setups.json');
if (setups && (typeof setups !== 'object' || Array.isArray(setups))) {
  fail('setups.json must be an object');
  errors++;
}

const recipes = needFile('recipes.json');
if (recipes) {
  if (!Array.isArray(recipes)) {
    fail('recipes.json must be an array');
    errors++;
  } else {
    for (const r of recipes) {
      if (!r.name || !r.slug) {
        fail(`recipe missing name/slug: ${JSON.stringify(r).slice(0, 80)}`);
        errors++;
      }
    }
  }
}

if (!failed && !errors) {
  console.log('✓ Cache JSON validation passed:', CACHE);
}

process.exit(failed || errors ? 1 : 0);
