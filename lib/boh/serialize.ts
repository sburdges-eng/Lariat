// Turning a filled sheet into text for the handoff board, and counting
// how much of it is done.
//
// Pure on purpose: the board hands it state and gets a string back, so the
// copy output is testable without a clipboard or a DOM.

import type { BohSheet, BohBlock } from './types.ts';

export interface SheetState {
  checks: Record<string, boolean>;
  entries: Record<string, string>;
  notes: string;
}

export const EMPTY_SHEET_STATE: SheetState = { checks: {}, entries: {}, notes: '' };

/** Drop emphasis markers and pencil rules — this is going into a text box. */
function plain(text: string): string {
  return text.replace(/\*\*/g, '').replace(/_{3,}/g, '____').trim();
}

function entry(state: SheetState, id: string): string {
  return (state.entries[id] ?? '').trim();
}

/** Every id on the sheet that can be ticked. */
export function checkableIds(sheet: BohSheet): string[] {
  const ids: string[] = [];
  for (const block of sheet.blocks) {
    if (block.kind === 'fields') {
      for (const part of block.parts) if (part.kind === 'check') ids.push(part.id);
    } else if (block.kind === 'tasks') {
      for (const row of block.rows) ids.push(row.id);
    } else if (block.kind === 'count') {
      for (const row of block.rows) if (row.checkable) ids.push(row.id);
    } else if (block.kind === 'grid') {
      for (const row of block.rows) {
        for (const cell of row.cells) if (cell.kind === 'check') ids.push(cell.id);
      }
    }
  }
  return ids;
}

/**
 * Every control id a single block owns, split by what it stores.
 *
 * The board uses this to re-render one block instead of the whole sheet
 * when a cook types — the count sheet carries 276 controls and an iPad
 * feels the difference mid-count.
 */
export function blockControlIds(block: BohBlock): { checks: string[]; entries: string[] } {
  const checks: string[] = [];
  const entries: string[] = [];

  switch (block.kind) {
    case 'fields':
      for (const part of block.parts) {
        if (part.kind === 'field') entries.push(part.id);
        else if (part.kind === 'check') checks.push(part.id);
      }
      break;
    case 'tasks':
      for (const row of block.rows) checks.push(row.id);
      break;
    case 'count':
      for (const row of block.rows) {
        if (row.checkable) checks.push(row.id);
        for (const input of block.inputs) entries.push(`${row.id}.${input.key}`);
      }
      break;
    case 'grid':
      for (const row of block.rows) {
        for (const cell of row.cells) {
          if (cell.kind === 'check') checks.push(cell.id);
          else if (cell.kind === 'entry') entries.push(cell.id);
        }
      }
      break;
    default:
      break;
  }
  return { checks, entries };
}

export function countProgress(sheet: BohSheet, state: SheetState): { done: number; total: number } {
  const ids = checkableIds(sheet);
  return {
    done: ids.filter((id) => state.checks[id]).length,
    total: ids.length,
  };
}

/**
 * Only blocks a cook actually touched are worth pasting — a 200-row count
 * sheet with three counted items should paste three lines, not two hundred.
 * Task lists are the exception: done-versus-not-done is the whole message.
 */
function blockToLines(block: BohBlock, state: SheetState): string[] {
  switch (block.kind) {
    case 'heading':
      // Headings are emitted by sheetToText only once content follows.
      return [];

    case 'note':
    case 'callout':
      // Printed instructions. They were already read off the sheet.
      return [];

    case 'fields': {
      // Filled blanks condense onto one line; each ticked box gets its own,
      // in the same shape a task list pastes in.
      //
      // Untouched parts stay out. This paste goes to the handoff board as a
      // message to the next shift, and a list of boxes nobody ticked is not
      // a message — the sheet itself is where the gaps are read.
      const filled: string[] = [];
      const boxes: string[] = [];
      for (const part of block.parts) {
        if (part.kind === 'field') {
          const value = entry(state, part.id);
          if (value) filled.push(`${part.label}: ${value}`);
        } else if (part.kind === 'check' && state.checks[part.id]) {
          boxes.push(`[x] ${plain(part.label)}`);
        }
      }
      const lines: string[] = [];
      if (filled.length) lines.push(filled.join('  ·  '));
      return lines.concat(boxes);
    }

    case 'tasks':
      return block.rows.map((row) => {
        const box = state.checks[row.id] ? '[x]' : '[ ]';
        const who = row.who ? `${plain(row.who)} — ` : '';
        return `${box} ${who}${plain(row.task)}`;
      });

    case 'count':
      return block.rows
        .map((row) => {
          const values = block.inputs
            .map((input) => {
              const v = entry(state, `${row.id}.${input.key}`);
              return v ? `${input.label} ${v}` : '';
            })
            .filter(Boolean);
          const ticked = row.checkable && state.checks[row.id];
          if (!values.length && !ticked) return '';
          const box = row.checkable ? (ticked ? '[x] ' : '[ ] ') : '';
          const tail = values.length ? ` — ${values.join(', ')}` : '';
          return `${box}${plain(row.label)}${tail}`;
        })
        .filter(Boolean);

    case 'grid':
      return block.rows
        .map((row) => {
          const touched = row.cells.some(
            (cell) =>
              (cell.kind === 'entry' && entry(state, cell.id)) ||
              (cell.kind === 'check' && state.checks[cell.id]),
          );
          if (!touched) return '';
          const parts = row.cells
            .map((cell) => {
              if (cell.kind === 'text') return plain(cell.text);
              if (cell.kind === 'entry') {
                const value = entry(state, cell.id);
                return value && cell.hint ? `${value}${plain(cell.hint)}` : value;
              }
              return `${state.checks[cell.id] ? '[x]' : '[ ]'}${cell.text ? ` ${plain(cell.text)}` : ''}`;
            })
            .filter(Boolean);
          return parts.join(' · ');
        })
        .filter(Boolean);

    default: {
      // A new block kind fails the build here rather than silently
      // dropping out of the handoff paste.
      const exhaustive: never = block;
      void exhaustive;
      return [];
    }
  }
}

/**
 * @param sheet the sheet definition
 * @param state what the cook ticked and wrote
 * @param serviceDate ISO date the sheet belongs to
 */
export function sheetToText(sheet: BohSheet, state: SheetState, serviceDate: string): string {
  const lines: string[] = [sheet.title, serviceDate];

  // A section heading only earns its line if something under it was
  // filled in — otherwise a count sheet pastes as a list of empty zones.
  let pendingHeading: string | null = null;

  for (const block of sheet.blocks) {
    if (block.kind === 'heading') {
      pendingHeading = plain(block.text);
      continue;
    }
    const content = blockToLines(block, state);
    if (!content.length) continue;
    if (pendingHeading) {
      lines.push('', pendingHeading);
      pendingHeading = null;
    }
    lines.push(...content);
  }

  const notes = state.notes.trim();
  if (notes) lines.push('', 'Notes', notes);

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
