#!/usr/bin/env node
// i18n catalog contract — key parity, placeholder parity, plural pairs,
// UI_COPY_RULES banned words, and the t() helper semantics.
// Run: node --experimental-strip-types --test tests/js/test-i18n-catalog.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { en } = await import('../../lib/i18n/messages/en.ts');
const { es } = await import('../../lib/i18n/messages/es.ts');
const { t, getMessages, normalizeLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE } = await import(
  '../../lib/i18n/index.ts'
);

const LOCALES = { en, es };

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

const flat = Object.fromEntries(
  Object.entries(LOCALES).map(([name, catalog]) => [name, flatten(catalog)]),
);

// docs/UI_COPY_RULES.md "AVOID SOFTWARE TERMS" — checked against every
// locale's catalog (kitchen Spanish must avoid SaaS-speak too).
const BANNED =
  /\b(workflow|optimi[sz]e|configure|dashboard|analytics|synchroni[sz]ation|initiate|execute|module|interface|authenticate|submit|generate|validation failed|error occurred)\b/i;

describe('catalog parity', () => {
  it('every locale has exactly the en key set', () => {
    const enKeys = Object.keys(flat.en).sort();
    for (const [name, keys] of Object.entries(flat)) {
      assert.deepEqual(Object.keys(keys).sort(), enKeys, `${name} key set must match en`);
    }
  });

  it('no empty strings in any locale', () => {
    for (const [name, keys] of Object.entries(flat)) {
      for (const [key, value] of Object.entries(keys)) {
        assert.ok(typeof value === 'string' && value.trim() !== '', `${name}:${key} is empty`);
      }
    }
  });

  it('placeholder token sets match en exactly', () => {
    const tokens = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, enValue] of Object.entries(flat.en)) {
      for (const [name, keys] of Object.entries(flat)) {
        if (name === 'en') continue;
        assert.deepEqual(
          tokens(keys[key]),
          tokens(enValue),
          `${name}:${key} placeholders must match en`,
        );
      }
    }
  });

  it('plural keys come in complete _one/_other pairs', () => {
    for (const [name, keys] of Object.entries(flat)) {
      for (const key of Object.keys(keys)) {
        if (key.endsWith('_one')) {
          assert.ok(keys[key.replace(/_one$/, '_other')], `${name}:${key} missing _other`);
        }
        if (key.endsWith('_other')) {
          assert.ok(keys[key.replace(/_other$/, '_one')], `${name}:${key} missing _one`);
        }
      }
    }
  });

  it('obeys the UI_COPY_RULES banned-word list', () => {
    for (const [name, keys] of Object.entries(flat)) {
      for (const [key, value] of Object.entries(keys)) {
        assert.doesNotMatch(value, BANNED, `${name}:${key} uses banned software wording`);
      }
    }
  });
});

describe('t() semantics', () => {
  it('interpolates tokens and leaves unknown tokens visible', () => {
    assert.equal(t(en, 'today.eyebrow', { date: 'Jun 12' }), 'Today · Jun 12');
    assert.equal(t(en, 'today.station.progress', { done: 2, total: 5 }), '2 of 5');
  });

  it('selects _one/_other by count', () => {
    assert.equal(t(en, 'today.stations', { count: 1, n: 1 }), '1 station');
    assert.equal(t(en, 'today.stations', { count: 3, n: 3 }), '3 stations');
    assert.equal(t(es, 'today.stations', { count: 1, n: 1 }), '1 estación');
    assert.equal(t(es, 'today.stations', { count: 3, n: 3 }), '3 estaciones');
  });

  it('falls back to en, then to the key — never blank', () => {
    const broken = JSON.parse(JSON.stringify(es));
    delete broken.today.title;
    assert.equal(t(broken, 'today.title'), 'Line now');
    assert.equal(t(en, 'nope.missing'), 'nope.missing');
  });

  it('normalizeLocale clamps anything unknown to the default', () => {
    assert.equal(normalizeLocale('es'), 'es');
    assert.equal(normalizeLocale('ES '), 'es');
    assert.equal(normalizeLocale('fr'), DEFAULT_LOCALE);
    assert.equal(normalizeLocale(undefined), DEFAULT_LOCALE);
    for (const locale of SUPPORTED_LOCALES) {
      assert.ok(getMessages(locale), `catalog missing for ${locale}`);
    }
  });
});
