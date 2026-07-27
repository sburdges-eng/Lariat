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
import { serviceDateISO, sheetStorageKey, isTaskMatrix } from '../../lib/boh/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PACKET = path.join(REPO_ROOT, 'docs/boh/print/lariat-ops-packet.html');

const doc = new JSDOM(fs.readFileSync(PACKET, 'utf8')).window.document;
const pages = [...doc.querySelectorAll('.page')];

const TICK = '☐'; // ☐ as the packet prints it

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

/**
 * Every string the generator stored for one sheet, flattened.
 *
 * @param sep joined on a character normalize() keeps, so a needle cannot
 *   match by straddling two unrelated fields. Pass '' when the source line
 *   is one the generator deliberately splits across parts — a paragraph of
 *   prose becomes static chips and box labels, and the words are still all
 *   there even though no single part holds the sentence.
 */
function sheetText(sheet, sep = '|') {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(sheet.blocks);
  return out.map(normalize).join(sep);
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

  it('keeps every word of every prose paragraph', () => {
    // Paragraphs carry the gate conditions and the order-call checklist —
    // the sentences a manager actually works from. A paragraph is split
    // into chips, blanks and boxes, so it survives as pieces rather than
    // as one run of text; what must not happen is a piece going missing.
    const missing = [];
    pages.forEach((page, i) => {
      const haystack = sheetText(BOH_SHEETS[i], '');
      for (const p of page.querySelectorAll(':scope > p')) {
        for (const word of p.textContent.split(/\s+/)) {
          // A label drops the colon that introduced its blank — "Date:"
          // is stored as "Date". Only the trailing one goes: the packet is
          // full of clock times and "4:00" must still be found as written.
          const needle = normalize(word).replace(/:$/, '');
          // Short tokens are separators and punctuation, not content.
          if (needle.length < 3) continue;
          if (!haystack.includes(needle)) {
            missing.push(`${BOH_SHEETS[i].slug}: "${word}" from "${p.textContent.slice(0, 50)}…"`);
          }
        }
      }
    });
    assert.deepEqual(missing, [], `words absent from generated data:\n${missing.join('\n')}`);
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

describe('boh sheets — tick boxes printed in prose', () => {
  /** Every part of every `fields` block on a sheet. */
  const partsOf = (sheet) =>
    sheet.blocks.filter((b) => b.kind === 'fields').flatMap((b) => b.parts);

  const checksOn = (slug) =>
    partsOf(BOH_SHEETS.find((s) => s.slug === slug))
      .filter((p) => p.kind === 'check')
      .map((p) => p.label);

  it('leaves no tick box stranded as printed text', () => {
    // A box the parser leaves in prose is a box a cook cannot tick. The
    // packet prints them in paragraphs as well as table cells, and the
    // paragraph ones were static until this.
    const stranded = [];
    for (const sheet of BOH_SHEETS) {
      for (const block of sheet.blocks) {
        if (block.kind === 'note' || block.kind === 'callout') {
          if (block.text.includes(TICK)) stranded.push(`${sheet.slug}: ${block.text.slice(0, 60)}`);
        } else if (block.kind === 'fields') {
          for (const part of block.parts) {
            if (part.kind === 'static' && part.text.includes(TICK)) {
              stranded.push(`${sheet.slug}: ${part.text.slice(0, 60)}`);
            }
          }
        }
      }
    }
    // The recipe index prints one ☐ as a key to the column, not as a box.
    assert.equal(stranded.length, 1, `tick boxes left as text:\n${stranded.join('\n')}`);
    assert.match(stranded[0], /^recipe-index: .*=/);
  });

  it('keeps the recipe-book key as prose', () => {
    // "☐ = printed card in the book" explains the symbol. Turning it into
    // a box would invite a cook to tick the legend.
    const legend = partsOf(BOH_SHEETS.find((s) => s.slug === 'recipe-index')).concat(
      BOH_SHEETS.find((s) => s.slug === 'recipe-index').blocks.filter((b) => b.kind === 'note'),
    );
    assert.ok(
      JSON.stringify(legend).includes('= printed card in the book'),
      'the key line should survive somewhere as text',
    );
    assert.ok(
      !checksOn('recipe-index').some((l) => l.startsWith('=')),
      'the key line must not become a tickable box',
    );
  });

  it('labels a box printed after its task with the whole task', () => {
    // "Each — deep-clean task of the day (rotation sheet, initial) ☐ ·
    //  A/B — restock + flip · sauce bottles · wipe + sweep · trash ☐"
    // is two boxes, not two words. The interpunct separates duties inside
    // one box; only the box itself ends a label.
    const labels = checksOn('dinner-day-plan');
    assert.ok(
      labels.includes('Each — deep-clean task of the day (rotation sheet, initial)'),
      `missing the deep-clean box, got: ${JSON.stringify(labels)}`,
    );
    assert.ok(
      labels.includes('A/B — restock + flip · sauce bottles · wipe + sweep · trash'),
      'the A/B duty list is one box, interpunct and all',
    );
  });

  it('lifts the time block out of the label and leaves it as a chip', () => {
    const sheet = BOH_SHEETS.find((s) => s.slug === 'dinner-day-plan');
    const lull = sheet.blocks.find(
      (b) => b.kind === 'fields' && b.parts.some((p) => p.kind === 'check'),
    );
    assert.equal(lull.parts[0].kind, 'static');
    assert.match(lull.parts[0].text, /^\*\*Lull \(7–8\):\*\*$/);
    assert.equal(lull.parts.filter((p) => p.kind === 'check').length, 3);
  });

  it('labels a box printed before its task with the task that follows', () => {
    const labels = checksOn('sysco-count');
    assert.ok(labels.includes('Counted all four zones'), JSON.stringify(labels));
    assert.ok(labels.includes('86-prone items double-checked'));
  });

  it('keeps pencil blanks and boxes on the same line', () => {
    // "Count date: ___  Counted by: ___  Order placed: ☐ Sun ☐ Wed"
    const sheet = BOH_SHEETS.find((s) => s.slug === 'sysco-count');
    const header = sheet.blocks.find((b) => b.kind === 'fields');
    const kinds = header.parts.map((p) => p.kind);
    assert.deepEqual(kinds, ['field', 'field', 'static', 'check', 'check']);
    assert.deepEqual(
      header.parts.filter((p) => p.kind === 'check').map((p) => p.label),
      ['Sun', 'Wed'],
    );
  });

  it('does not swallow a box into the label of a blank', () => {
    // The prep sheet's "Event prep pulled in? ☐ Yes (list) ____ ☐ No events"
    // parsed as one field whose label carried both boxes.
    const labels = checksOn('prep-par');
    assert.ok(labels.includes('Yes (list)'), JSON.stringify(labels));
    assert.ok(labels.includes('No events'));
    for (const part of partsOf(BOH_SHEETS.find((s) => s.slug === 'prep-par'))) {
      assert.ok(!part.label?.includes(TICK), `${part.label} still carries a box`);
    }
  });

  it('counts prose boxes toward the done count', () => {
    const sheet = BOH_SHEETS.find((s) => s.slug === 'sysco-count');
    const ids = checkableIds(sheet);
    const proseIds = sheet.blocks
      .filter((b) => b.kind === 'fields')
      .flatMap((b) => b.parts)
      .filter((p) => p.kind === 'check')
      .map((p) => p.id);
    assert.ok(proseIds.length > 0, 'expected prose boxes on the count sheet');
    for (const id of proseIds) {
      assert.ok(ids.includes(id), `${id} is tickable but not counted`);
    }
  });

  it('pastes a ticked prose box to the handoff board', () => {
    const sheet = BOH_SHEETS.find((s) => s.slug === 'sysco-count');
    const zones = sheet.blocks
      .filter((b) => b.kind === 'fields')
      .flatMap((b) => b.parts)
      .find((p) => p.kind === 'check' && p.label === 'Counted all four zones');
    const text = sheetToText(sheet, { checks: { [zones.id]: true }, entries: {}, notes: '' }, '2026-07-26');
    assert.match(text, /\[x\] Counted all four zones/);
  });
});

describe('boh sheets — the deep-clean rotation', () => {
  it('is the only grid shaped as a day-by-station task matrix', () => {
    // A five-column grid of tasks is the one table that cannot be read on a
    // phone without scrolling sideways, so the board stacks it into a card
    // per day. Anything else stays a table on purpose.
    const matrices = [];
    for (const sheet of BOH_SHEETS) {
      for (const block of sheet.blocks) {
        if (block.kind === 'grid' && isTaskMatrix(block)) {
          matrices.push(`${sheet.slug}:${block.columns.length}col`);
        }
      }
    }
    assert.deepEqual(matrices, ['deep-clean:5col']);
  });

  it('leaves the day label and one tickable task per station', () => {
    const sheet = BOH_SHEETS.find((s) => s.slug === 'deep-clean');
    const rotation = sheet.blocks.find((b) => b.kind === 'grid' && isTaskMatrix(b));
    assert.deepEqual(
      rotation.rows.map((r) => r.cells[0].text),
      ['WED', 'THU', 'FRI', 'SAT', 'SUN'],
    );
    for (const row of rotation.rows) {
      assert.equal(row.cells.length, rotation.columns.length);
      for (const cell of row.cells.slice(1)) {
        assert.equal(cell.kind, 'check');
        assert.ok(cell.text.length > 0, `${row.id} has a station cell with no task`);
      }
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
  it('uses the venue day on a UTC server', () => {
    // 02:30Z is still dinner on July 26 in Colorado. The server's own
    // timezone must not decide which sheet key a cook gets.
    assert.equal(serviceDateISO(new Date('2026-07-27T02:30:00.000Z')), '2026-07-26');
  });

  it('uses the venue local day, not the UTC day', () => {
    // 8:30pm on 26 January local is still the 26th to a cook working
    // dinner. A UTC slice would call it the 27th and hand them a blank
    // day plan mid-service.
    const evening = new Date('2026-01-27T03:30:00.000Z');
    assert.equal(serviceDateISO(evening), '2026-01-26');
  });

  it('rolls at local midnight', () => {
    assert.equal(serviceDateISO(new Date('2026-07-27T05:59:00.000Z')), '2026-07-26');
    assert.equal(serviceDateISO(new Date('2026-07-27T06:01:00.000Z')), '2026-07-27');
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
