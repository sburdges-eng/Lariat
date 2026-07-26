#!/usr/bin/env node
// Generate lib/boh/sheets.generated.ts from the printed BOH ops packet.
//
// Why generate instead of hand-writing the sheets: the packet carries ~400
// rows of real operating numbers — Sysco pack sizes, weekly usage, par
// levels, brine and thaw lead times. A typo retyping those is not a
// rendering bug, it is a wrong order quantity or a wrong brine time in a
// cook's hand. Parsing the packet makes transcription mechanical, and
// tests/js/test-boh-sheets.mjs proves the output still matches the source.
//
// Run: node scripts/build-boh-sheets.mjs
// Then: npm run typecheck

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(REPO_ROOT, 'docs/boh/print/lariat-ops-packet.html');
const OUT = path.join(REPO_ROOT, 'lib/boh/sheets.generated.ts');

const TICK = '\u2610'; // ☐
const BLANK = '\u241F'; // sentinel standing in for a pencil blank

// Sheet identity by packet page order. The packet's own page order is the
// order a manager works the book, so it is also the hub order.
const SHEETS = [
  { slug: 'dinner-day-plan', tier: 'cook', blurb: 'Wed–Sat. Doors at 4.' },
  { slug: 'sunday-day-plan', tier: 'cook', blurb: 'Brunch. Doors at 11.' },
  { slug: 'deep-clean', tier: 'cook', blurb: 'Who cleans what, by day.' },
  { slug: 'prep-par', tier: 'cook', blurb: 'What to make today, and how much.' },
  { slug: 'sysco-count', tier: 'manager', blurb: 'Walk the building and count.' },
  { slug: 'purveyor-planner', tier: 'manager', blurb: 'Order days, drop days, phone numbers.' },
  { slug: 'manager-week', tier: 'manager', blurb: 'The manager week, block by block.' },
  { slug: 'eod-log', tier: 'manager', blurb: 'End of night sign-off.' },
  { slug: 'sop-grille', tier: 'cook', blurb: 'Grille and sauté — setup to close.' },
  { slug: 'sop-fry-garde', tier: 'cook', blurb: 'Fry and garde — setup to close.' },
  { slug: 'sop-expo-dish', tier: 'cook', blurb: 'Expo and dish pit — setup to close.' },
  { slug: 'recipe-index', tier: 'cook', blurb: 'Every recipe card on file.' },
];

/** Columns a cook writes numbers into on a count or par sheet. */
const COUNT_INPUT_HEADERS = new Set(['have', 'order', 'on hand', 'make']);

/**
 * Flatten an element to text, keeping the two things that carry meaning:
 * bold emphasis (the packet bolds what burns you) and pencil blanks.
 * @param {Node} node
 * @returns {string}
 */
function rich(node) {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      out += child.nodeValue;
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = /** @type {Element} */ (child);
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') {
      out += '\n';
    } else if (tag === 'b' || tag === 'strong') {
      const inner = rich(el).trim();
      out += inner ? `**${inner}**` : '';
    } else if (el.classList.contains('blank')) {
      out += BLANK;
    } else {
      out += rich(el);
    }
  }
  return out;
}

/**
 * Collapse runs of whitespace but keep intentional line breaks.
 * @param {string} s
 */
function tidy(s) {
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
    .trim();
}

/**
 * Text for a block that has nowhere to put a writable field, so the
 * packet's pencil blanks render as printed rules instead of a sentinel.
 * @param {Element} el
 */
function text(el) {
  return tidy(rich(el)).replaceAll(BLANK, '_____');
}

/**
 * Split on the packet's `·` separator, but not on separators sitting
 * inside a bold span — "**Doors 4:00 · Service 4:00–9:30**" is one phrase
 * and splitting it strands the `**` markers.
 * @param {string} s
 */
function splitOutsideBold(s) {
  const segments = [];
  let current = '';
  let bold = false;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '*' && s[i + 1] === '*') {
      bold = !bold;
      current += '**';
      i += 1;
    } else if (s[i] === '\u00b7' && !bold) {
      segments.push(current);
      current = '';
    } else {
      current += s[i];
    }
  }
  segments.push(current);
  return segments;
}

/** Longest run of text still readable as a field label on a phone. */
const MAX_LABEL = 48;

/**
 * @param {string} s
 */
function labelize(s) {
  return tidy(s).replace(/\*/g, '').replace(/[:\u2013-]\s*$/, '').trim();
}

/**
 * Turn a line carrying pencil blanks into static chips and writable
 * fields. Handles both packet dialects: the day-plan header
 * ("Date ___ · Doors 4:00 · A–Grille ___") and the prep-sheet header
 * ("**Date:** ___ **Service:** ___"). Each blank takes the phrase
 * immediately before it as its label.
 * @param {string} raw
 * @param {string} idBase
 */
function parseFields(raw, idBase) {
  const parts = [];
  const chunks = raw.split(BLANK);

  chunks.forEach((chunk, i) => {
    const segments = splitOutsideBold(chunk);
    const isLabelChunk = i < chunks.length - 1;
    // Everything but the final segment is prose; the final segment names
    // the blank that follows this chunk.
    const staticSegments = isLabelChunk ? segments.slice(0, -1) : segments;

    for (const segment of staticSegments) {
      const trimmed = tidy(segment);
      if (trimmed) parts.push({ kind: 'static', text: trimmed });
    }

    if (!isLabelChunk) return;

    const label = labelize(segments[segments.length - 1]);
    if (label.length > MAX_LABEL) {
      // Too long to sit beside a box — keep it as prose and leave the
      // field unlabelled rather than truncating a cook's instruction.
      parts.push({ kind: 'static', text: tidy(segments[segments.length - 1]) });
      parts.push({ kind: 'field', id: `${idBase}.f${i}`, label: 'Note' });
      return;
    }
    parts.push({ kind: 'field', id: `${idBase}.f${i}`, label: label || 'Note' });
  });

  return { kind: 'fields', parts };
}

/**
 * @param {Element} table
 */
function headerCells(table) {
  return [...table.querySelectorAll('th')].map((th) => text(th));
}

/**
 * @param {Element} table
 * @returns {Element[]}
 */
function bodyRows(table) {
  return [...table.querySelectorAll('tr')].filter((tr) => !tr.querySelector('th'));
}

/**
 * Who/Task/✓ — the day-plan shape. Big tappable rows on a phone.
 * @param {string[]} headers
 */
function isTaskTable(headers) {
  const lower = headers.map((h) => h.toLowerCase());
  return lower[0] === 'who' && lower[1] === 'task' && lower.includes('\u2713');
}

/**
 * Item/.../Have/Order — the count and par shape.
 * @param {string[]} headers
 */
function countInputIndexes(headers) {
  const found = [];
  headers.forEach((h, i) => {
    if (COUNT_INPUT_HEADERS.has(h.toLowerCase())) found.push(i);
  });
  return found;
}

/**
 * @param {Element} table
 * @param {string} idBase
 */
function parseTasks(table, idBase) {
  const rows = bodyRows(table).map((tr, r) => {
    const cells = [...tr.children];
    return {
      id: `${idBase}.r${r}`,
      who: cells[0] ? text(cells[0]) || null : null,
      task: cells[1] ? text(cells[1]) : '',
    };
  });
  return { kind: 'tasks', ordered: false, rows };
}

/**
 * @param {Element} table
 * @param {string[]} headers
 * @param {number[]} inputIdx
 * @param {string} idBase
 */
function parseCount(table, headers, inputIdx, idBase) {
  const tickIdx = headers.findIndex((h) => h === '\u2713');
  const inputs = inputIdx.map((i) => ({ key: slugifyKey(headers[i]), label: headers[i] }));
  const rows = bodyRows(table).map((tr, r) => {
    const cells = [...tr.children];
    const meta = [];
    headers.forEach((h, i) => {
      if (i === 0 || i === tickIdx || inputIdx.includes(i)) return;
      const value = cells[i] ? text(cells[i]) : '';
      if (value) meta.push({ label: h, value });
    });
    return {
      id: `${idBase}.r${r}`,
      label: cells[0] ? text(cells[0]) : '',
      meta,
      checkable: tickIdx !== -1,
    };
  });
  return { kind: 'count', inputs, rows };
}

/**
 * Everything else stays a table. Cells become writable where the packet
 * left a blank, and tickable where it printed a box.
 * @param {Element} table
 * @param {string[]} headers
 * @param {string} idBase
 */
function parseGrid(table, headers, idBase) {
  const rows = bodyRows(table).map((tr, r) => {
    const cells = [...tr.children].map((td, c) => {
      const id = `${idBase}.r${r}.c${c}`;
      let value = text(td);
      if (value === TICK) return { kind: 'check', id, text: '' };
      if (value.endsWith(TICK)) {
        return { kind: 'check', id, text: value.slice(0, -1).trim() };
      }
      // "/3" is a printed denominator on the weekly score grid — the
      // manager writes the earned number in front of it, so the box gets
      // the entry and "/3" stays alongside as a hint.
      if (/^\/\d+$/.test(value)) return { kind: 'entry', id, hint: value };
      if (value === '') return { kind: 'entry', id };
      return { kind: 'text', text: value };
    });
    return { id: `${idBase}.r${r}`, cells };
  });
  return { kind: 'grid', columns: headers, rows };
}

/**
 * Station SOPs are ordered lists, not tables — setup, line check, close.
 * A cook ticks those off exactly like a day plan.
 * @param {Element} ol
 * @param {string} idBase
 */
function parseSteps(ol, idBase) {
  const rows = [...ol.querySelectorAll(':scope > li')].map((li, r) => ({
    id: `${idBase}.r${r}`,
    who: null,
    task: text(li),
  }));
  return { kind: 'tasks', ordered: true, rows };
}

/**
 * @param {string} label
 */
function slugifyKey(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * @param {Element} page
 * @param {{ slug: string, tier: string }} meta
 */
function parseSheet(page, meta) {
  const blocks = [];
  let title = meta.slug;

  for (const el of page.children) {
    const tag = el.tagName.toLowerCase();
    const idBase = `${meta.slug}.b${blocks.length}`;

    if (tag === 'h1') {
      title = text(el);
    } else if (tag === 'h2' || tag === 'h3') {
      blocks.push({ kind: 'heading', level: tag === 'h2' ? 2 : 3, text: text(el) });
    } else if (tag === 'p' && el.classList.contains('rules')) {
      // The rules box states the gate conditions and the never-do lines.
      // It stays prose even if it carries a blank — emphasis over entry.
      blocks.push({ kind: 'callout', text: text(el) });
    } else if (tag === 'p') {
      // Both packet dialects for a pencil blank: a .blank span (already a
      // sentinel from rich()) and a literal run of underscores.
      const raw = rich(el).replace(/_{3,}/g, BLANK);
      if (raw.includes(BLANK)) {
        blocks.push(parseFields(raw, idBase));
      } else {
        const body = tidy(raw);
        if (body) blocks.push({ kind: 'note', text: body });
      }
    } else if (tag === 'ol') {
      blocks.push(parseSteps(el, idBase));
    } else if (tag === 'table') {
      const headers = headerCells(el);
      const inputIdx = countInputIndexes(headers);
      if (isTaskTable(headers)) {
        blocks.push(parseTasks(el, idBase));
      } else if (inputIdx.length > 0) {
        blocks.push(parseCount(el, headers, inputIdx, idBase));
      } else {
        blocks.push(parseGrid(el, headers, idBase));
      }
    }
  }

  return { slug: meta.slug, title, blurb: meta.blurb, tier: meta.tier, blocks };
}

function main() {
  const html = fs.readFileSync(SOURCE, 'utf8');
  const doc = new JSDOM(html).window.document;
  const pages = [...doc.querySelectorAll('.page')];

  if (pages.length !== SHEETS.length) {
    throw new Error(
      `packet has ${pages.length} pages but ${SHEETS.length} sheets are configured — ` +
        `update SHEETS in scripts/build-boh-sheets.mjs`,
    );
  }

  const sheets = pages.map((page, i) => parseSheet(page, SHEETS[i]));

  const body = JSON.stringify(sheets, null, 2);
  const out = `// GENERATED FILE — do not edit by hand.
//
// Source:     docs/boh/print/lariat-ops-packet.html
// Generator:  scripts/build-boh-sheets.mjs
// Regenerate: node scripts/build-boh-sheets.mjs
//
// tests/js/test-boh-sheets.mjs asserts this file still matches the packet.

import type { BohSheet } from './types.ts';

export const BOH_SHEETS: BohSheet[] = ${body};
`;

  fs.writeFileSync(OUT, out, 'utf8');

  const counts = sheets.map((s) => `  ${s.slug} (${s.tier}) — ${s.blocks.length} blocks`);
  process.stdout.write(
    `wrote ${path.relative(REPO_ROOT, OUT)}\n${counts.join('\n')}\n` +
      `${sheets.length} sheets\n`,
  );
}

main();
