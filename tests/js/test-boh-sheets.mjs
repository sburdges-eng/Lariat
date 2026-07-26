#!/usr/bin/env node
// The line-book sheet data is generated from the printed ops packet by
// scripts/build-boh-sheets.mjs. This test is the reason that generation is
// trustworthy: it re-reads the packet and proves nothing was dropped or
// mangled on the way into lib/boh/sheets.generated.ts.
//
// It matters because the packet carries real operating numbers — Sysco
// pack sizes, weekly usage, par levels, brine and thaw lead times. A
// silent parse regression is not a rendering bug, it is a wrong order
// quantity or a wrong brine time on a cook's phone.
//
// Run: node --experimental-strip-types --test tests/js/test-boh-sheets.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { BOH_SHEETS } from '../../lib/boh/sheets.generated.ts';
import { checkableIds, sheetToText, EMPTY_SHEET_STATE } from '../../lib/boh/serialize.ts';
import { serviceDateISO, sheetStorageKey } from '../../lib/boh/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PACKET = path.join(REPO_ROOT, 'docs/boh/print/lariat-ops-packet.html');

const doc = new JSDOM(fs.readFileSync(PACKET, 'utf8')).window.document;
const pages = [...doc.querySelectorAll('.page')];

/**
 * Compare packet text against generated text on equal footing. The
 * generator adds `**` emphasis markers, turns pencil blanks into rules,
 * and models tick boxes as booleans — none of which is a content change.
 * Whitespace goes too, because a `<br>` contributes a newline to the
 * generated string but nothing to the packet's textContent.
 * @param {string} s
 */
function normalize(s) {
  return s.replace(/[*\u2610\u241F_]/g, '').replace(/\s+/g, '');
}

/** Every string the generator stored for one sheet, flattened. */
function sheetText(sheet) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(sheet.blocks);
  // Joined on a character normalize() keeps, so a needle cannot match by
  // straddling two unrelated fields.
  return out.map(normalize).join('|');
}

describe('boh sheets — shape', () => {
  it('has one sheet per packet page', () => {
    assert.equal(BOH_SHEETS.length, pages.length);
    assert.equal(BOH_SHEETS.length, 12);
  });

  it('titles match the packet headings in order', () => {
    const packetTitles = pages.map((p) => normalize(p.querySelector('h1').textContent));
    const dataTitles = BOH_SHEETS.map((s) => normalize(s.title));
    assert.deepEqual(dataTitles, packetTitles);
  });

  it('slugs are unique and url-safe', () => {
    const slugs = BOH_SHEETS.map((s) => s.slug);
    assert.equal(new Set(slugs).size, slugs.length, 'duplicate slug');
    for (const slug of slugs) {
      assert.match(slug, /^[a-z0-9-]+$/, `${slug} is not url-safe`);
    }
  });

  it('every sheet is on a tier and carries a blurb', () => {
    for (const sheet of BOH_SHEETS) {
      assert.ok(['cook', 'manager'].includes(sheet.tier), `${sheet.slug} tier`);
      assert.ok(sheet.blurb.length > 0, `${sheet.slug} blurb`);
      assert.ok(sheet.blocks.length > 0, `${sheet.slug} has no blocks`);
    }
  });
});

describe('boh sheets — nothing dropped in generation', () => {
  it('keeps every table cell from the packet', () => {
    const missing = [];
    pages.forEach((page, i) => {
      const haystack = sheetText(BOH_SHEETS[i]);
      for (const td of page.querySelectorAll('td')) {
        const needle = normalize(td.textContent);
        if (!needle) continue;
        if (!haystack.includes(needle)) {
          missing.push(`${BOH_SHEETS[i].slug}: ${needle.slice(0, 70)}`);
        }
      }
    });
    assert.deepEqual(missing, [], `packet rows absent from generated data:\n${missing.join('\n')}`);
  });

  it('keeps every SOP step from the packet', () => {
    const missing = [];
    pages.forEach((page, i) => {
      const haystack = sheetText(BOH_SHEETS[i]);
      for (const li of page.querySelectorAll('ol > li')) {
        const needle = normalize(li.textContent);
        if (needle && !haystack.includes(needle)) {
          missing.push(`${BOH_SHEETS[i].slug}: ${needle.slice(0, 70)}`);
        }
      }
    });
    assert.deepEqual(missing, [], `SOP steps absent from generated data:\n${missing.join('\n')}`);
  });

  it('keeps the same number of body rows per sheet', () => {
    pages.forEach((page, i) => {
      const packetRows = [...page.querySelectorAll('tr')].filter((tr) => !tr.querySelector('th'));
      let dataRows = 0;
      for (const block of BOH_SHEETS[i].blocks) {
        if (block.kind === 'tasks' && !block.ordered) dataRows += block.rows.length;
        else if (block.kind === 'count' || block.kind === 'grid') dataRows += block.rows.length;
      }
      assert.equal(dataRows, packetRows.length, `${BOH_SHEETS[i].slug} row count`);
    });
  });

  it('leaves no parser sentinels or unbalanced emphasis behind', () => {
    for (const sheet of BOH_SHEETS) {
      const raw = JSON.stringify(sheet);
      assert.ok(!raw.includes('\u241F'), `${sheet.slug} leaked a blank sentinel`);
      const markers = (raw.match(/\*\*/g) ?? []).length;
      assert.equal(markers % 2, 0, `${sheet.slug} has an unbalanced ** marker`);
    }
  });
});

describe('boh sheets — state ids', () => {
  it('gives every writable and tickable control a unique id', () => {
    // A duplicate id would wire two boxes on two different sheets to the
    // same saved value — tick "boil out the fryers" and something else
    // silently ticks with it.
    const seen = new Map();
    const collide = [];
    for (const sheet of BOH_SHEETS) {
      for (const block of sheet.blocks) {
        const ids = [];
        if (block.kind === 'fields') {
          for (const part of block.parts) if (part.kind === 'field') ids.push(part.id);
        } else if (block.kind === 'tasks') {
          for (const row of block.rows) ids.push(row.id);
        } else if (block.kind === 'count') {
          for (const row of block.rows) {
            ids.push(row.id);
            for (const input of block.inputs) ids.push(`${row.id}.${input.key}`);
          }
        } else if (block.kind === 'grid') {
          for (const row of block.rows) {
            for (const cell of row.cells) if (cell.kind !== 'text') ids.push(cell.id);
          }
        }
        for (const id of ids) {
          if (seen.has(id)) collide.push(`${id} (${seen.get(id)} and ${sheet.slug})`);
          else seen.set(id, sheet.slug);
        }
      }
    }
    assert.deepEqual(collide, [], `duplicate control ids:\n${collide.join('\n')}`);
  });

  it('scopes every id to its own sheet', () => {
    for (const sheet of BOH_SHEETS) {
      for (const id of checkableIds(sheet)) {
        assert.ok(id.startsWith(`${sheet.slug}.`), `${id} does not belong to ${sheet.slug}`);
      }
    }
  });
});

describe('boh service date', () => {
  it('uses the venue local day, not the UTC day', () => {
    // 8pm on 26 July local is still the 26th of July to a cook working
    // dinner. A UTC slice would call it the 27th and hand them a blank
    // day plan mid-service.
    const evening = new Date(2026, 6, 26, 20, 30, 0);
    assert.equal(serviceDateISO(evening), '2026-07-26');
  });

  it('rolls at local midnight', () => {
    assert.equal(serviceDateISO(new Date(2026, 6, 26, 23, 59, 0)), '2026-07-26');
    assert.equal(serviceDateISO(new Date(2026, 6, 27, 0, 1, 0)), '2026-07-27');
  });

  it('zero-pads so keys sort', () => {
    assert.equal(serviceDateISO(new Date(2026, 0, 5, 12, 0, 0)), '2026-01-05');
  });

  it('scopes the storage key to sheet and date', () => {
    assert.equal(
      sheetStorageKey('prep-par', '2026-07-26'),
      'lariat.boh.prep-par.2026-07-26',
    );
  });
});

describe('boh sheets — copy for the handoff board', () => {
  const dinner = BOH_SHEETS.find((s) => s.slug === 'dinner-day-plan');
  const count = BOH_SHEETS.find((s) => s.slug === 'sysco-count');

  it('an untouched day plan pastes every task as not done', () => {
    const text = sheetToText(dinner, EMPTY_SHEET_STATE, '2026-07-26');
    assert.match(text, /^Dinner Day Plan/);
    assert.match(text, /2026-07-26/);
    assert.match(text, /\[ \] All — Clock in/);
    assert.ok(!text.includes('[x]'), 'nothing should be ticked');
  });

  it('ticking a task flips it in the paste', () => {
    const first = dinner.blocks.find((b) => b.kind === 'tasks').rows[0];
    const text = sheetToText(
      dinner,
      { checks: { [first.id]: true }, entries: {}, notes: '' },
      '2026-07-26',
    );
    assert.match(text, /\[x\] All — Clock in/);
  });

  it('a count sheet pastes only what was counted', () => {
    const block = count.blocks.find((b) => b.kind === 'count');
    const row = block.rows[0];
    const text = sheetToText(
      count,
      { checks: {}, entries: { [`${row.id}.have`]: '2', [`${row.id}.order`]: '2' }, notes: '' },
      '2026-07-26',
    );
    const lines = text.split('\n').filter(Boolean);
    assert.match(text, /Chicken wings, precooked — Have 2, Order 2/);
    assert.ok(
      lines.length < 10,
      `a 150-row count sheet with one counted item should paste short, got ${lines.length} lines`,
    );
  });

  it('carries the notes box through', () => {
    const text = sheetToText(
      dinner,
      { checks: {}, entries: {}, notes: 'Low on pico, 86 trout' },
      '2026-07-26',
    );
    assert.match(text, /Notes\nLow on pico, 86 trout/);
  });

  it('does not print a section heading with nothing under it', () => {
    const text = sheetToText(count, EMPTY_SHEET_STATE, '2026-07-26');
    assert.equal(text.split('\n').filter(Boolean).length, 2, 'title and date only');
  });
});
