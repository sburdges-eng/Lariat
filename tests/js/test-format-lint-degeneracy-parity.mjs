#!/usr/bin/env node
// training/eval/format-lint.mjs carries a COPY of isDegenerateAnswer rather
// than importing lib/extractAction.ts, because that module must stay
// dependency-free: it runs under plain `node` (npm run test:format-lint, and
// training/gcp/evaluate-candidates.mjs on a GCP box), so it cannot pull in a
// TypeScript module.
//
// A hand-mirrored copy drifts unless something fails when it does. This file is
// that something: it imports BOTH implementations and asserts they return the
// same verdict on every fixture, including the ones that pin the shape of each
// clause. It must run under --experimental-strip-types (it is wired into
// test:regression-assistant), which is why it is separate from
// test-format-lint.mjs — that suite also runs under plain node.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-format-lint-degeneracy-parity.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { isDegenerateAnswer: libImpl } = await import('../../lib/extractAction');
const { isDegenerateAnswer: evalImpl, lintQuestionResponse, lintCommandResponse } = await import(
  '../../training/eval/format-lint.mjs'
);

const XML_LOOP = Array(12).fill('<ingredient name="diced shallot" />').join('\n');

// Every fixture from the guard's own suite, so the two implementations are
// compared on exactly the cases that define each clause.
const FIXTURES = {
  'xml mimicry': ['<pico>', '  <ingredients>', '    <ingredient name="green chile" />',
    '    <ingredient name="thyme" />', '    <ingredient name="pork rind" />',
    '  </ingredients>', '</pico>'].join('\n'),
  'repetition loop': Array(6).fill('- diced shallot and garlic clove').join('\n'),
  'incident xml loop': XML_LOOP,
  'crlf loop': Array(6).fill('- diced shallot and garlic clove').join('\r\n'),
  'loop tail on long answer': [
    ...Array.from({ length: 20 }, (_, i) => `Prep step ${i + 1}: dice and hold cold.`),
    ...Array(5).fill('- diced shallot and garlic clove'),
  ].join('\n'),
  'interleaved loop': ['Aji verde uses cilantro.', 'filler line one here',
    'Aji verde uses cilantro.', 'filler line two here', 'Aji verde uses cilantro.',
    'filler line three ok', 'Aji verde uses cilantro.', 'filler line four ok'].join('\n'),
  'walk-in temp': 'Walk-in is at 38F — inside the safe range.',
  'green chilli card': 'Green Chilli — makes 8 qt · expo\n• pork butt — 10 lb\n• water — 5 cup\nTags: wheat',
  empty: '',
  'line check 4 stations': 'Line check, 4:30 pm:\nGrill\nNot logged yet.\nSaute\nNot logged yet.\nFry\nNot logged yet.\nExpo\nNot logged yet.',
  'untagged recipe cards': [
    ['Pico de Gallo — makes 4 qt · garde', '• roma tomato — 10 cup', '• red onion — 2 cup'],
    ['Mexi Slaw — makes 2 qt · garde', '• green cabbage — 8 cup', '• lime juice — 1 cup'],
    ['Birria Consomme — makes 6 qt · line', '• beef chuck — 12 lb', '• guajillo chile — 3 cup'],
    ['Aji Verde — makes 1 qt · garde', '• cilantro — 4 cup', '• jalapeno — 6 ea'],
  ].map((c) => `${c.join('\n')}\nTags: none listed — check with a manager.`).join('\n\n'),
  'par listing': ['Par levels for tonight:', 'Grill station', '• pico de gallo — 2 qt',
    'Saute station', '• pico de gallo — 2 qt', 'Fry station', '• pico de gallo — 2 qt',
    'Expo station', '• pico de gallo — 2 qt'].join('\n'),
  'vendor contacts': ['Vendor contacts:', 'Shamrock <orders@shamrockfoods.com>',
    'Sysco <meat@sysco.com>', 'US Foods <dry@usfoods.com>', 'Borden <dairy@borden.com>',
    'Bunzl <paper@bunzl.com>'].join('\n'),
  'bare urls': Array.from({ length: 5 }, (_, i) => `Rule ${i}: see <https://fda.gov/haccp/rule${i}>`).join('\n'),
  'markdown table': ['| date | variance |', '| --- | --- |', '| 2026-06-16 | 0 |',
    '| 2026-06-16 | 0 |', '| 2026-06-16 | 0 |', '| 2026-06-16 | 0 |'].join('\n'),
  'allergen listing': ['Recipes with eggs:', 'Aioli', 'Tags: eggs', 'Caesar', 'Tags: eggs',
    'Hollandaise', 'Tags: eggs', 'Mayo', 'Tags: eggs'].join('\n'),
  'short answer': 'Nothing is 86 today.',
};

describe('format-lint degeneracy mirror stays in step with lib/extractAction', () => {
  for (const [name, text] of Object.entries(FIXTURES)) {
    it(`agrees on: ${name}`, () => {
      assert.equal(
        evalImpl(text),
        libImpl(text),
        `training/eval/format-lint.mjs has drifted from lib/extractAction.ts on "${name}"`,
      );
    });
  }
});

describe('the eval pre-gate disqualifies a looping candidate', () => {
  it('fails a question-path response that mimics the CONTEXT markup', () => {
    const res = lintQuestionResponse(XML_LOOP, { intent: 'recipe' });
    assert.equal(res.ok, false);
    assert.ok(
      res.violations.some((v) => /degenerate output/.test(v)),
      `expected a degenerate-output violation, got: ${JSON.stringify(res.violations)}`,
    );
  });

  it('fails a command-path response whose prose loops', () => {
    const text =
      '```json\n' +
      JSON.stringify({ action: 'eighty_six', item: 'salmon', reason: 'sold out' }) +
      '\n```\n' +
      Array(6).fill('- diced shallot and garlic clove').join('\n');
    const res = lintCommandResponse(text);
    assert.equal(res.ok, false);
    assert.ok(res.violations.some((v) => /degenerate output/.test(v)));
  });

  it('still passes a clean question answer', () => {
    const res = lintQuestionResponse('Walk-in is at 38F — inside the safe range.', {});
    assert.equal(res.ok, true, JSON.stringify(res.violations));
  });

  it('still passes a clean command response', () => {
    const text =
      '```json\n' +
      JSON.stringify({ action: 'eighty_six', item: 'salmon', reason: 'sold out' }) +
      '\n```\nDone.';
    const res = lintCommandResponse(text);
    assert.equal(res.ok, true, JSON.stringify(res.violations));
  });
});
