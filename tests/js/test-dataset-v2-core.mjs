import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, pick, shuffle, buildScrubber, shingles, contaminated } from '../../training/datasetv2/core.mjs';

test('rng is deterministic for a fixed seed', () => {
  const a = makeRng(20260709), b = makeRng(20260709);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('pick draws from the array', () => {
  const rng = makeRng(1);
  for (let i = 0; i < 20; i++) assert.ok([1, 2, 3].includes(pick(rng, [1, 2, 3])));
});

test('shuffle is deterministic and non-mutating', () => {
  const src = [1, 2, 3, 4, 5];
  const out1 = shuffle(makeRng(7), src);
  const out2 = shuffle(makeRng(7), src);
  assert.deepEqual(out1, out2);
  assert.deepEqual(src, [1, 2, 3, 4, 5]);
});

test('scrubber pseudonymizes client names, whole word, case-insensitive', () => {
  const scrub = buildScrubber(['Acme Corp', 'Blue Ranch']);
  assert.equal(scrub('Invoice for acme corp and Blue Ranch.'), 'Invoice for Client A and Client B.');
  assert.equal(scrub('Acmecorp stays'), 'Acmecorp stays');
});

test('scrubber also scrubs snake_case slug forms (ID leaks)', () => {
  const scrub = buildScrubber(['Jane Smith']);
  assert.equal(scrub('Jane Smith (ID: jane_smith)'), 'Client A (ID: client_a)');
});

test('scrubber is deterministic across input order', () => {
  const a = buildScrubber(['Zed LLC', 'Acme Corp']);
  const b = buildScrubber(['Acme Corp', 'Zed LLC']);
  assert.equal(a('Zed LLC'), b('Zed LLC'));
});

test('contamination detects 8-gram overlap with scenarios', () => {
  const scen = shingles('the brisket has been sitting at 90 F for three hours what do I do');
  const bad = { messages: [{ role: 'user', content: 'X the brisket has been sitting at 90 F for three hours yes' }] };
  const ok = { messages: [{ role: 'user', content: 'scale the bacon jam recipe to fifty quarts please' }] };
  assert.equal(contaminated(bad, scen), true);
  assert.equal(contaminated(ok, scen), false);
});
