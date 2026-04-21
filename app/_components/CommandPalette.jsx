'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/* A jump-anywhere palette. Opens on ⌘K / Ctrl+K / the "/" key.
   Navigates the app router; carries the currently-selected location
   through the href query string. Keyboard driven. */

const STATIC_COMMANDS = [
  { group: 'Stations',   name: 'Today',            sub: 'Rush view',          href: '/',                   key: '0', terms: 'today home' },
  { group: 'Stations',   name: 'All stations',     sub: 'Line overview',      href: '/stations',           key: 'S', terms: 'station line' },
  { group: 'Service',    name: '86 Board',         sub: 'What’s out',         href: '/eighty-six',         key: '8', terms: 'eighty six out' },
  { group: 'Service',    name: 'Recipes',          sub: 'Build, taste, plate',href: '/recipes',            key: 'R', terms: 'recipe book' },
  { group: 'Service',    name: 'Inventory',        sub: 'Counts & moves',     href: '/inventory',          key: 'I', terms: 'inventory count' },
  { group: 'Service',    name: 'Specials',         sub: 'Today’s features',   href: '/specials',           key: 'F', terms: 'specials feature' },
  { group: 'Service',    name: 'Ask the kitchen',  sub: 'Chat with the book', href: '/kitchen-assistant',  key: '?', terms: 'assistant help ai chat' },
  { group: 'Service',    name: 'Gold stars',       sub: 'Recognition',        href: '/gold-stars',         key: '★', terms: 'gold stars recognition' },
  { group: 'Compliance', name: 'Food safety',      sub: 'HACCP hub',          href: '/food-safety',        key: 'H', terms: 'food safety haccp' },
  { group: 'Compliance', name: 'Temp log',         sub: 'Fridges, holds',     href: '/food-safety/temp-log',   key: 'T', terms: 'temp fridge log' },
  { group: 'Compliance', name: 'Receiving',        sub: 'Deliveries in',      href: '/food-safety/receiving',  key: '↵', terms: 'receiving delivery' },
  { group: 'Compliance', name: 'Calibrations',     sub: 'Thermometers',       href: '/food-safety/calibrations', key: 'C', terms: 'calibration thermometer' },
  { group: 'Compliance', name: 'Labor',            sub: 'Breaks & shifts',    href: '/labor',              key: 'L', terms: 'labor break shift clock' },
  { group: 'Books',      name: 'Sales numbers',    sub: 'Daily analytics',    href: '/analytics',          key: '#', terms: 'sales analytics revenue' },
  { group: 'Books',      name: 'Recipe costs',     sub: 'Cost of goods',      href: '/costing',            key: '$', terms: 'costing cost cogs' },
  { group: 'Books',      name: 'Order guide',      sub: 'Purchasing',         href: '/purchasing',         key: 'P', terms: 'purchasing order guide' },
  { group: 'Books',      name: 'Menu performance', sub: 'Engineer the menu',  href: '/menu-engineering',   key: 'M', terms: 'menu engineering performance' },
  { group: 'Books',      name: 'Events & prep',    sub: 'BEOs',               href: '/beo',                key: 'E', terms: 'events beo banquet catering' },
  { group: 'Books',      name: 'Equipment',        sub: 'Gear & PM',          href: '/equipment',          key: 'Q', terms: 'equipment gear maintenance' },
];

const LOC_KEY = 'lariat_location';

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const [stations, setStations] = useState([]);
  const [locQuery, setLocQuery] = useState('');
  const inputRef = useRef(null);

  // Pick up current location from localStorage so nav preserves it
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const loc = window.localStorage.getItem(LOC_KEY);
    if (loc && loc !== 'default') setLocQuery(`?location=${encodeURIComponent(loc)}`);
    else setLocQuery('');
  }, [open]);

  // Load station list once the palette opens
  useEffect(() => {
    if (!open || stations.length) return;
    fetch(`/api/stations${locQuery}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setStations(d))
      .catch(() => {});
  }, [open, locQuery, stations.length]);

  // Keybindings: open with ⌘K / Ctrl+K / "/" (outside inputs), close with Esc
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
    const stationCmds = stations.slice(0, 6).map((s, i) => ({
      group: 'Line',
      name: s.name,
      sub:
        s.prog && s.prog.total
          ? `${s.prog.done}/${s.prog.total} checks${s.prog.flagged ? ` · ${s.prog.flagged} flagged` : ''}`
          : s.line || 'Station',
      href: `/stations/${s.id}`,
      key: String(i + 1),
      terms: `station ${s.id} ${s.name} ${s.line || ''}`.toLowerCase(),
    }));
    return [...stationCmds, ...STATIC_COMMANDS];
  }, [stations]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) =>
      [c.name, c.sub, c.group, c.terms, c.key]
        .join(' ')
        .toLowerCase()
        .includes(s)
    );
  }, [q, commands]);

  // Keep cursor in range when list changes
  useEffect(() => {
    if (cursor >= filtered.length) setCursor(0);
  }, [filtered.length, cursor]);

  const go = useCallback(
    (cmd) => {
      if (!cmd) return;
      const href = cmd.href.includes('?')
        ? cmd.href
        : `${cmd.href}${locQuery}`;
      setOpen(false);
      router.push(href);
    },
    [router, locQuery]
  );

  // Arrow keys on the input element
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

  // Group rows by cmd.group, preserving first-seen order
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
                    key={`${cmd.group}-${cmd.name}`}
                    className={`cmdk-row ${idx === cursor ? 'on' : ''}`}
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => go(cmd)}
                    role="option"
                    aria-selected={idx === cursor}
                  >
                    <div className="cmdk-glyph">{cmd.key}</div>
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
