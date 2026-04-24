'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PALETTE_ITEMS, withLocation } from './navRegistry.js';
import { useLocation } from './useLocation.js';

/* A jump-anywhere palette. Opens on ⌘K / Ctrl+K / the "/" key.
   Navigates the app router; carries the currently-selected location
   through the href query string. Keyboard driven. */

export default function CommandPalette() {
  const router = useRouter();
  const { locQuery } = useLocation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const [stations, setStations] = useState([]);
  const inputRef = useRef(null);

  // Load station list once the palette opens.
  useEffect(() => {
    if (!open || stations.length) return;
    fetch(`/api/stations${locQuery}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setStations(d))
      .catch(() => {});
  }, [open, locQuery, stations.length]);

  // Keybindings: open with ⌘K / Ctrl+K / "/" (outside inputs), close with Esc.
  useEffect(() => {
    const onKey = (e) => {
      const inField =
        e.target &&
        (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.tagName === 'SELECT' ||
          e.target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (!open && e.key === '/' && !inField) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (open && e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const commands = useMemo(() => {
    // Live "Line" entries: the first six stations (with progress readouts).
    const stationCmds = stations.slice(0, 6).map((s, i) => ({
      id: `station-${s.id}`,
      group: 'Line',
      name: s.name,
      sub:
        s.prog && s.prog.total
          ? `${s.prog.done}/${s.prog.total} checks${
              s.prog.flagged ? ` · ${s.prog.flagged} flagged` : ''
            }`
          : s.line || 'Station',
      href: `/stations/${s.id}`,
      shortcut: String(i + 1),
      terms: `station ${s.id} ${s.name} ${s.line || ''}`.toLowerCase(),
      locAware: true,
    }));
    return [...stationCmds, ...PALETTE_ITEMS];
  }, [stations]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) =>
      [c.name, c.sub, c.group, c.terms, c.shortcut]
        .join(' ')
        .toLowerCase()
        .includes(s)
    );
  }, [q, commands]);

  // Keep cursor in range when list changes.
  useEffect(() => {
    if (cursor >= filtered.length) setCursor(0);
  }, [filtered.length, cursor]);

  const go = useCallback(
    (cmd) => {
      if (!cmd) return;
      const href = cmd.locAware ? withLocation(cmd.href, locQuery) : cmd.href;
      setOpen(false);
      router.push(href);
    },
    [router, locQuery]
  );

  // Arrow keys on the input element.
  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(filtered[cursor]);
    }
  };

  if (!open) return null;

  // Group rows by cmd.group, preserving first-seen order.
  const groups = [];
  const groupIndex = new Map();
  filtered.forEach((cmd, idx) => {
    if (!groupIndex.has(cmd.group)) {
      groupIndex.set(cmd.group, groups.length);
      groups.push({ name: cmd.group, rows: [] });
    }
    groups[groupIndex.get(cmd.group)].rows.push({ cmd, idx });
  });

  return (
    <div className="cmdk-scrim" onClick={() => setOpen(false)} role="dialog" aria-modal>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input">
          <span className="prompt">»</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onInputKey}
            placeholder="Find a station, a board, a book…"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="hint">esc to close</span>
        </div>

        <div className="cmdk-list" role="listbox">
          {filtered.length === 0 ? (
            <div className="cmdk-empty">Nothing on the line by that name.</div>
          ) : (
            groups.map((g) => (
              <div key={g.name}>
                <div className="cmdk-group">{g.name}</div>
                {g.rows.map(({ cmd, idx }) => (
                  <div
                    key={cmd.id || `${cmd.group}-${cmd.name}`}
                    className={`cmdk-row ${idx === cursor ? 'on' : ''}`}
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => go(cmd)}
                    role="option"
                    aria-selected={idx === cursor}
                  >
                    <div className="cmdk-glyph">{cmd.shortcut}</div>
                    <div className="cmdk-lbl">
                      <div className="cmdk-name">{cmd.name}</div>
                      <div className="cmdk-sub">{cmd.sub}</div>
                    </div>
                    <div className="cmdk-key">↵</div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
