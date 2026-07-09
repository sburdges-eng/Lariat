// Dataset v2 core — seeded RNG, PII scrubber, eval-contamination filter,
// JSONL emitter. Pure functions; tested by tests/js/test-dataset-v2-core.mjs.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// mulberry32 — deterministic, good-enough distribution for sampling
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Deterministic pseudonyms: sorted unique names -> "Client A", "Client B"…
// Sorting makes the mapping independent of discovery order.
export function buildScrubber(clientNames) {
  const sorted = [...new Set(clientNames.filter(Boolean))].sort();
  const rules = sorted.map((name, i) => ({
    re: new RegExp(`\\b${esc(name)}\\b`, 'gi'),
    to: `Client ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`,
  }));
  return (s) => rules.reduce((acc, r) => acc.replace(r.re, r.to), s);
}

const norm = (t) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

export function shingles(text, n = 8) {
  const w = norm(text);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

// An example is contaminated when its user message shares any word n-gram
// with an eval scenario — keeps T01-T10 honest against the fine-tune.
export function contaminated(example, scenarioShingleSet, n = 8) {
  const user = example.messages.find((m) => m.role === 'user')?.content || '';
  for (const sh of shingles(user, n)) if (scenarioShingleSet.has(sh)) return true;
  return false;
}

export function emitJsonl(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  const clean = rows.map(({ meta, ...rest }) => rest);
  writeFileSync(path, clean.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return clean.length;
}
