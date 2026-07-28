// @ts-check
'use client';

// One sheet from the line book, shaped for a phone held in a wet hand.
//
// Everything ticked or written here lives in localStorage on this device,
// keyed by sheet and service date. It is a working sheet, not a record:
// no audit trail, nobody else can see it, and it is gone if the phone is.
// Anything that has to be logged — temps, cooling, date marks — goes to
// /food-safety, which the header links to on every sheet.

import Link from 'next/link';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sheetStorageKey, taskMatrixDays } from '../../../lib/boh/index.ts';
import {
  EMPTY_SHEET_STATE,
  blockControlIds,
  countProgress,
  sheetToText,
} from '../../../lib/boh/serialize.ts';
import { useT } from '../../_components/I18nProvider.jsx';

/** @typedef {import('../../../lib/boh/types').BohSheet} BohSheet */
/** @typedef {import('../../../lib/boh/serialize').SheetState} SheetState */

/**
 * Render `**bold**` spans and hard line breaks without dropping to
 * dangerouslySetInnerHTML. The packet bolds what burns you.
 * @param {{ text: string }} props
 */
function Rich({ text }) {
  const lines = String(text).split('\n');
  return lines.map((line, li) => (
    <span key={li}>
      {li > 0 ? <br /> : null}
      {line.split(/(\*\*[^*]+\*\*)/g).map((part, pi) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={pi}>{part.slice(2, -2)}</strong>
        ) : (
          part
        ),
      )}
    </span>
  ));
}

/**
 * @param {{ checked: boolean, onChange: () => void, label: import('react').ReactNode, id: string }} props
 */
function CheckRow({ checked, onChange, label, id }) {
  return (
    <label className={`boh-check${checked ? ' is-done' : ''}`} htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={onChange} />
      <span className="boh-check-label">{label}</span>
    </label>
  );
}

/**
 * @param {{
 *   block: import('../../../lib/boh/types').BohBlock,
 *   state: SheetState,
 *   toggle: (id: string) => void,
 *   write: (id: string, value: string) => void,
 * }} props
 */
function Block({ block, state, toggle, write }) {
  switch (block.kind) {
    case 'heading':
      return block.level === 2 ? (
        <h2 className="boh-h2">
          <Rich text={block.text} />
        </h2>
      ) : (
        <h3 className="boh-h3">
          <Rich text={block.text} />
        </h3>
      );

    case 'note':
      return (
        <p className="boh-note">
          <Rich text={block.text} />
        </p>
      );

    case 'callout':
      return (
        <p className="boh-callout">
          <Rich text={block.text} />
        </p>
      );

    case 'fields':
      return (
        <div className="boh-fields">
          {block.parts.map((part, i) => {
            if (part.kind === 'field') {
              return (
                <label key={i} className="boh-field">
                  <span className="boh-field-label">{part.label}</span>
                  <input
                    type="text"
                    value={state.entries[part.id] ?? ''}
                    onChange={(e) => write(part.id, e.target.value)}
                  />
                </label>
              );
            }
            // A box the packet printed mid-sentence gets the same tick row
            // as one printed in a table — same size target, same counter.
            if (part.kind === 'check') {
              return (
                <CheckRow
                  key={i}
                  id={part.id}
                  checked={Boolean(state.checks[part.id])}
                  onChange={() => toggle(part.id)}
                  label={<Rich text={part.label} />}
                />
              );
            }
            return (
              <span key={i} className="boh-chip">
                <Rich text={part.text} />
              </span>
            );
          })}
        </div>
      );

    case 'tasks':
      return (
        <div className="boh-tasks">
          {block.rows.map((row) => (
            <CheckRow
              key={row.id}
              id={row.id}
              checked={Boolean(state.checks[row.id])}
              onChange={() => toggle(row.id)}
              label={
                <>
                  {row.who ? <span className="boh-who">{row.who}</span> : null}
                  <Rich text={row.task} />
                </>
              }
            />
          ))}
        </div>
      );

    case 'count':
      return (
        <div className="boh-count">
          {block.rows.map((row) => (
            <div key={row.id} className="boh-count-row">
              <div className="boh-count-head">
                {row.checkable ? (
                  <input
                    type="checkbox"
                    aria-label={`Done: ${row.label.replace(/\*\*/g, '')}`}
                    checked={Boolean(state.checks[row.id])}
                    onChange={() => toggle(row.id)}
                  />
                ) : null}
                <span className="boh-count-label">
                  <Rich text={row.label} />
                </span>
              </div>
              {row.meta.length ? (
                <div className="boh-meta">
                  {row.meta.map((meta, i) => (
                    <span key={i} className="boh-meta-item">
                      <span className="boh-meta-label">{meta.label}</span>
                      <Rich text={meta.value} />
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="boh-inputs">
                {block.inputs.map((input) => {
                  const id = `${row.id}.${input.key}`;
                  return (
                    <label key={input.key} className="boh-input">
                      <span>{input.label}</span>
                      <input
                        inputMode="decimal"
                        value={state.entries[id] ?? ''}
                        onChange={(e) => write(id, e.target.value)}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      );

    case 'grid': {
      // A day-by-station matrix of tasks is unreadable as a table on a
      // phone — five columns of sentences means scrolling sideways to find
      // your own station mid-shift. Stack it into a card per day instead.
      const days = taskMatrixDays(block);
      if (days) {
        return (
          <div className="boh-matrix">
            {days.map((day) => (
              <section key={day.id} className="boh-matrix-day">
                <h4 className="boh-matrix-day-name">{day.day}</h4>
                {day.tasks.map((task) => (
                  <div key={task.id} className="boh-matrix-task">
                    <span className="boh-matrix-station">
                      <Rich text={task.station} />
                    </span>
                    <CheckRow
                      id={task.id}
                      checked={Boolean(state.checks[task.id])}
                      onChange={() => toggle(task.id)}
                      label={<Rich text={task.text} />}
                    />
                  </div>
                ))}
              </section>
            ))}
          </div>
        );
      }

      return (
        <div className="boh-grid-wrap">

          <table className="boh-grid">
            <thead>
              <tr>
                {block.columns.map((column, i) => (
                  <th key={i}>
                    <Rich text={column} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.id}>
                  {row.cells.map((cell, i) => (
                    <td key={i}>
                      {cell.kind === 'text' ? <Rich text={cell.text} /> : null}
                      {cell.kind === 'entry' ? (
                        <span className="boh-cell-entry">
                          <input
                            className="boh-cell-input"
                            aria-label={block.columns[i] || 'Write in'}
                            value={state.entries[cell.id] ?? ''}
                            onChange={(e) => write(cell.id, e.target.value)}
                          />
                          {cell.hint ? <span className="boh-hint">{cell.hint}</span> : null}
                        </span>
                      ) : null}
                      {cell.kind === 'check' ? (
                        <CheckRow
                          id={cell.id}
                          checked={Boolean(state.checks[cell.id])}
                          onChange={() => toggle(cell.id)}
                          label={cell.text ? <Rich text={cell.text} /> : null}
                        />
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    default:
      // Unknown block kinds are skipped rather than crashing the sheet —
      // lib/boh/serialize.ts holds the compile-time exhaustiveness check.
      return null;
  }
}

/** Control ids per block, cached on the block object itself. */
const idCache = new WeakMap();

/** @param {import('../../../lib/boh/types').BohBlock} block */
function idsOf(block) {
  let ids = idCache.get(block);
  if (!ids) {
    ids = blockControlIds(block);
    idCache.set(block, ids);
  }
  return ids;
}

/**
 * Re-render a block only when one of its own controls changed.
 *
 * The count sheet carries 276 controls. Without this, every keystroke
 * re-rendered all 41 blocks and all 276 inputs, which an iPad on the line
 * feels as lag while someone is counting the walk-in.
 */
const MemoBlock = memo(Block, (prev, next) => {
  if (prev.block !== next.block) return false;
  if (prev.toggle !== next.toggle || prev.write !== next.write) return false;
  const { checks, entries } = idsOf(next.block);
  for (const id of checks) {
    if (Boolean(prev.state.checks[id]) !== Boolean(next.state.checks[id])) return false;
  }
  for (const id of entries) {
    if (prev.state.entries[id] !== next.state.entries[id]) return false;
  }
  return true;
});

/**
 * @param {{ sheet: BohSheet, serviceDate: string }} props
 */
export default function SheetBoard({ sheet, serviceDate }) {
  const tt = useT();
  const storageKey = sheetStorageKey(sheet.slug, serviceDate);

  const [state, setState] = useState(/** @type {SheetState} */ (EMPTY_SHEET_STATE));
  const [loadedKey, setLoadedKey] = useState(/** @type {string | null} */ (null));
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  /** Sheet text shown on screen when the phone has no usable clipboard. */
  const [handCopy, setHandCopy] = useState(/** @type {string | null} */ (null));
  const handCopyRef = useRef(/** @type {HTMLTextAreaElement | null} */ (null));

  // Saved state is read after mount, never during render — the server has
  // no localStorage and a mismatch would blow up hydration.
  useEffect(() => {
    let next = EMPTY_SHEET_STATE;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        next = {
          checks: parsed?.checks ?? {},
          entries: parsed?.entries ?? {},
          notes: typeof parsed?.notes === 'string' ? parsed.notes : '',
        };
      }
    } catch {
      // Unreadable storage must not take the sheet down — the cook can
      // still work the sheet, it just will not survive a reload.
    }
    setState(next);
    setLoadedKey(storageKey);
  }, [storageKey]);

  // Write back on every change, but only once what is in state actually
  // belongs to this key — otherwise the empty first render would clobber
  // the saved sheet before the load above runs.
  useEffect(() => {
    if (loadedKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
      setSaveFailed(false);
    } catch {
      // Out of quota, or Safari private mode. The in-memory sheet keeps
      // working, but the cook has to be told — silently dropping the save
      // is how someone counts the walk-in twice.
      setSaveFailed(true);
    }
  }, [loadedKey, storageKey, state]);

  const toggle = useCallback(
    /** @param {string} id */
    (id) => setState((prev) => ({ ...prev, checks: { ...prev.checks, [id]: !prev.checks[id] } })),
    [],
  );

  const write = useCallback(
    /** @param {string} id @param {string} value */
    (id, value) => setState((prev) => ({ ...prev, entries: { ...prev.entries, [id]: value } })),
    [],
  );

  const progress = useMemo(() => countProgress(sheet, state), [sheet, state]);

  const startNew = useCallback(() => {
    setState(EMPTY_SHEET_STATE);
    setAsking(false);
  }, []);

  const copiedTimer = useRef(/** @type {number | null} */ (null));
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const confirmCopied = useCallback(() => {
    setCopied(true);
    setHandCopy(null);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
  }, []);

  const copySheet = useCallback(async () => {
    const text = sheetToText(sheet, state, serviceDate);

    // navigator.clipboard only exists in a secure context. The venue serves
    // this over plain http on the kitchen wifi, so on the phones that
    // actually open it there is no clipboard at all — falling back is the
    // normal path here, not the edge case.
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      confirmCopied();
      return;
    } catch {
      // fall through to the on-screen copy
    }

    setHandCopy(text);
  }, [sheet, state, serviceDate, confirmCopied]);

  // Select the text as soon as it appears so a phone only needs one tap,
  // and try the legacy copy command, which — unlike navigator.clipboard —
  // still works without a secure context on most browsers.
  useEffect(() => {
    if (handCopy === null) return;
    const box = handCopyRef.current;
    if (!box) return;
    box.focus();
    box.select();
    box.setSelectionRange(0, box.value.length);
    try {
      if (document.execCommand?.('copy')) confirmCopied();
    } catch {
      // Leave the text on screen to be copied by hand.
    }
  }, [handCopy, confirmCopied]);

  return (
    <div className="boh-sheet">
      <div className="boh-sheet-top">
        <Link href="/boh" className="boh-back">
          ← {tt('boh.backToBook')}
        </Link>
        <h1>{sheet.title}</h1>
        <p className="boh-sheet-date">{tt('boh.sheetFor', { date: serviceDate })}</p>
        <div className="boh-notice">
          <p>{tt('boh.notARecord')}</p>
          <Link href="/food-safety">{tt('boh.foodSafetyLink')}</Link>
        </div>
        {progress.total > 0 ? (
          <p className="boh-progress">
            {tt('boh.doneCount', { done: progress.done, total: progress.total })}
          </p>
        ) : null}
        {saveFailed ? (
          <p className="boh-warn" role="status">
            {tt('boh.notSaving')}
          </p>
        ) : null}
      </div>

      {sheet.blocks.map((block, i) => (
        <MemoBlock key={i} block={block} state={state} toggle={toggle} write={write} />
      ))}

      <label className="boh-notes">
        <span className="boh-field-label">{tt('boh.notes')}</span>
        <textarea
          rows={4}
          placeholder={tt('boh.notesHint')}
          value={state.notes}
          onChange={(e) => {
            const notes = e.target.value;
            setState((prev) => ({ ...prev, notes }));
          }}
        />
      </label>

      {handCopy !== null ? (
        <div className="boh-handcopy">
          <label className="boh-field-label" htmlFor="boh-handcopy-text">
            {tt('boh.copySheet')}
          </label>
          <p className="boh-handcopy-hint">{tt('boh.copyByHand')}</p>
          <textarea
            id="boh-handcopy-text"
            ref={handCopyRef}
            readOnly
            rows={10}
            value={handCopy}
            onFocus={(e) => e.target.select()}
          />
          <button type="button" className="btn" onClick={() => setHandCopy(null)}>
            {tt('boh.copyDone')}
          </button>
        </div>
      ) : null}

      <div className="boh-actions">
        <button type="button" className="btn primary" onClick={copySheet}>
          {copied ? tt('boh.copied') : tt('boh.copySheet')}
        </button>
        {asking ? (
          <>
            <span className="boh-ask">{tt('boh.startNewAsk')}</span>
            <button type="button" className="btn red" onClick={startNew}>
              {tt('boh.startNewYes')}
            </button>
            <button type="button" className="btn" onClick={() => setAsking(false)}>
              {tt('boh.startNewNo')}
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => setAsking(true)}>
            {tt('boh.startNew')}
          </button>
        )}
      </div>
    </div>
  );
}
