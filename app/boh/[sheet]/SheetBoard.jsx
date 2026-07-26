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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sheetStorageKey } from '../../../lib/boh/index.ts';
import {
  EMPTY_SHEET_STATE,
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
          {block.parts.map((part, i) =>
            part.kind === 'field' ? (
              <label key={i} className="boh-field">
                <span className="boh-field-label">{part.label}</span>
                <input
                  type="text"
                  value={state.entries[part.id] ?? ''}
                  onChange={(e) => write(part.id, e.target.value)}
                />
              </label>
            ) : (
              <span key={i} className="boh-chip">
                <Rich text={part.text} />
              </span>
            ),
          )}
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

    case 'grid':
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

    default:
      // Unknown block kinds are skipped rather than crashing the sheet —
      // lib/boh/serialize.ts holds the compile-time exhaustiveness check.
      return null;
  }
}

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
    } catch {
      // Out of quota or private mode — keep the in-memory sheet working.
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

  const copySheet = useCallback(async () => {
    const text = sheetToText(sheet, state, serviceDate);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission (or no clipboard at all) — put the text on
      // screen so it can still be selected and copied by hand.
      window.prompt(tt('boh.copySheet'), text);
    }
  }, [sheet, state, serviceDate, tt]);

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
      </div>

      {sheet.blocks.map((block, i) => (
        <Block key={i} block={block} state={state} toggle={toggle} write={write} />
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
