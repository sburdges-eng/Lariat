// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import PinLogout from './PinLogout.jsx';
import OfflineIndicator from './OfflineIndicator.jsx';
import InstallButton from './InstallButton.jsx';
import BrandStamp from './BrandStamp.jsx';
import {
  requiresManagerPinPath,
  SIDEBAR_ITEMS,
  SHELF_ITEMS,
  withLocation,
} from './navRegistry.js';
import { useLocation } from './useLocation.js';

/* ── Kitchen topology: the physical line order ──
   Cells 1-6 are stations (filled from /api/stations, but we keep a
   stable slot order so keyboard shortcuts don't shift around).
   Cell 8 is the always-present 86 board. */

function StationRing({ prog, glyph }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const pct = prog && prog.total ? Math.min(1, prog.done / prog.total) : 0;
  const off = c * (1 - pct);
  const tone = !prog
    ? ''
    : prog.flagged > 0
    ? 'crit'
    : prog.signedOff || prog.done >= prog.total
    ? ''
    : prog.done > 0
    ? 'warn'
    : 'crit';
  return (
    <div className={`station-ring ${tone}`}>
      <svg viewBox="0 0 36 36">
        <circle className="track" cx="18" cy="18" r={r} />
        <circle
          className="fill"
          cx="18"
          cy="18"
          r={r}
          strokeDasharray={c}
          strokeDashoffset={off}
        />
      </svg>
      <span className="glyph">{glyph}</span>
    </div>
  );
}

// Group sidebar items by their `group` field, preserving first-seen order.
function groupItems(items) {
  const order = [];
  const byGroup = new Map();
  for (const item of items) {
    if (!byGroup.has(item.group)) {
      order.push(item.group);
      byGroup.set(item.group, []);
    }
    byGroup.get(item.group).push(item);
  }
  return order.map((g) => ({ name: g, items: byGroup.get(g) }));
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { locationId, locQuery, setLocation } = useLocation();
  const [staff, setStaff] = useState([]);
  const [cookId, setCookId] = useState('');
  const [locations, setLocations] = useState([{ id: 'default', name: 'The Lariat' }]);
  const [stations, setStations] = useState([]);

  // Staff picker hydrates once.
  useEffect(() => {
    fetch('/api/staff')
      .then((r) => r.json())
      .then((d) => setStaff(d || []))
      .catch((err) => console.error('Failed to load staff picker:', err));
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem('lariat_cook') : '';
      if (saved) setCookId(saved);
    } catch {
      /* ignore */
    }
  }, []);

  // Locations list — never required for single-site, but populates the dropdown.
  useEffect(() => {
    fetch('/api/locations')
      .then((r) => r.json())
      .then((rows) => {
        if (Array.isArray(rows) && rows.length) setLocations(rows);
      })
      .catch((err) => console.error('Failed to load locations:', err));
  }, []);

  // Live station progress for the rail rings (polled during service).
  useEffect(() => {
    const qs = locQuery;
    const load = () =>
      fetch(`/api/stations${qs}`)
        .then((r) => r.json())
        .then((d) => Array.isArray(d) && setStations(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [locQuery, pathname]);

  const onCookChange = (e) => {
    const next = e.target.value;
    setCookId(next);
    try {
      window.localStorage.setItem('lariat_cook', next);
    } catch {
      /* ignore */
    }
  };

  const onLocationChange = (e) => {
    const next = e.target.value;
    setLocation(next);
    // Keep the URL in step so deep-links and reloads carry the selection.
    const u = new URL(window.location.href);
    if (next === 'default') u.searchParams.delete('location');
    else u.searchParams.set('location', next);
    window.location.href = u.pathname + u.search;
  };

  const locationOptions = useMemo(() => {
    const ids = new Set(locations.map((l) => l.id));
    if (locationId && !ids.has(locationId)) {
      return [...locations, { id: locationId, name: `${locationId} (not in DB)` }];
    }
    return locations;
  }, [locations, locationId]);

  const lineCheckStations = useMemo(
    () => stations.filter((s) => s.prog && s.prog.total),
    [stations]
  );

  // Keyboard shortcuts: numbered keys jump to active line checks, 8 → 86 board, 0 → Today.
  useEffect(() => {
    const handler = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.target && e.target.isContentEditable) return;
      const k = e.key;
      if (k === '0') {
        router.push(withLocation('/', locQuery));
      } else if (/^[1-6]$/.test(k)) {
        const idx = parseInt(k, 10) - 1;
        const s = lineCheckStations[idx];
        if (s) router.push(withLocation(`/stations/${s.id}`, locQuery));
      } else if (k === '8') {
        router.push(withLocation('/eighty-six', locQuery));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lineCheckStations, locQuery, router]);

  // Render a single primary-nav link, registry-driven.
  const navLink = useCallback(
    (item) => {
      const href = item.locAware ? withLocation(item.href, locQuery) : item.href;
      const active =
        pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
      const managerOnly = item.managerOnly || requiresManagerPinPath(item.href);
      const ariaLabel = [
        item.shortcut ? `${item.name} (shortcut ${item.shortcut})` : item.name,
        managerOnly ? 'manager PIN required' : '',
      ]
        .filter(Boolean)
        .join(', ');
      return (
        <Link
          key={item.id}
          href={href}
          className={active ? 'active' : ''}
          aria-current={active ? 'page' : undefined}
          aria-label={ariaLabel}
        >
          <span className="nav-key" aria-hidden="true">{item.shortcut || '·'}</span>
          <span className="nav-lbl">
            <span className="t">{item.name}</span>
            {managerOnly && <span className="m">PIN required</span>}
          </span>
        </Link>
      );
    },
    [pathname, locQuery]
  );

  // Station cell (1 of the rings).
  const stationCell = (s, idx) => {
    const href = withLocation(`/stations/${s.id}`, locQuery);
    const active = pathname.startsWith(`/stations/${s.id}`);
    const glyph = String(idx + 1);
    const progressLabel = s.prog
      ? s.prog.flagged > 0
        ? `${s.prog.flagged} flagged`
        : s.prog.signedOff
          ? 'signed off'
          : `${s.prog.done} of ${s.prog.total} checks done`
      : s.line || 'no progress yet';
    return (
      <Link
        key={s.id}
        href={href}
        className={`station-cell ${active ? 'active' : ''}`}
        aria-current={active ? 'page' : undefined}
        aria-label={`Station ${idx + 1}: ${s.name}, ${progressLabel}. Shortcut ${glyph}.`}
      >
        <StationRing prog={s.prog} glyph={glyph} />
        <div className="sc-body">
          <div className="sc-name">{s.name}</div>
          <div className="sc-sub">
            {s.prog
              ? s.prog.flagged > 0
                ? `${s.prog.flagged} FLAGGED`
                : s.prog.signedOff
                ? 'SIGNED OFF'
                : `${s.prog.done}/${s.prog.total}`
              : s.line || '—'}
          </div>
        </div>
        <span className="sc-key" aria-hidden="true">{glyph}</span>
      </Link>
    );
  };

  // Group the non-Primary sidebar items (Service, Compliance) by section header.
  const groupedSidebar = useMemo(() => {
    const nonPrimary = SIDEBAR_ITEMS.filter((i) => i.group !== 'Primary');
    return groupItems(nonPrimary);
  }, []);

  const primary = SIDEBAR_ITEMS.filter((i) => i.group === 'Primary');

  return (
    <aside className="sidebar">
      <div className="line-rope" aria-hidden />

      <div className="brand">
        <BrandStamp className="brand-mark" decorative />
        <span>The Line</span>
        <small>Cockpit</small>
      </div>

      <nav className="nav">
        {primary.map(navLink)}

        <div className="nav-section stamp">
          <BrandStamp className="stamp-mark" decorative />
          <span>Stations</span>
        </div>
        {lineCheckStations.slice(0, 6).map((s, i) => stationCell(s, i))}
        {stations.length === 0 && <div className="nav-disabled">Loading stations…</div>}

        {groupedSidebar.map((g) => (
          <div key={g.name}>
            <div className="nav-section stamp">
              <BrandStamp className="stamp-mark" decorative />
              <span>{g.name}</span>
            </div>
            {g.items.map(navLink)}
          </div>
        ))}

        <div className="nav-section stamp">
          <BrandStamp className="stamp-mark" decorative />
          <span>Books</span>
        </div>
        <div className="shelf-grid">
          {SHELF_ITEMS.map((item) => {
            const managerOnly = item.managerOnly || requiresManagerPinPath(item.href);
            return (
              <Link
                key={item.id}
                href={withLocation(item.href, locQuery)}
                className="shelf-tile"
                aria-label={`${item.name}${managerOnly ? ', manager PIN required' : ''}`}
              >
                <b>{item.shelf?.b || item.name}</b>
                <span>{managerOnly ? 'PIN · ' : ''}{item.shelf?.sub || item.sub}</span>
              </Link>
            );
          })}
        </div>

        <div className="nav-section stamp">
          <BrandStamp className="stamp-mark" decorative />
          <span>Location</span>
        </div>
        <div className="location-picker">
          <OfflineIndicator />
          <label htmlFor="lariat-loc">Room</label>
          <select id="lariat-loc" value={locationId} onChange={onLocationChange}>
            {locationOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name || l.id}
              </option>
            ))}
          </select>
          <p className="location-hint">Stays set on this device.</p>
        </div>
      </nav>

      <div className="cook-picker">
        <label>You&apos;re clocked in as</label>
        <select value={cookId} onChange={onCookChange}>
          <option value="">— pick your name —</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName || [s.first, s.last].filter(Boolean).join(' ')}
            </option>
          ))}
        </select>
        <PinLogout />
      </div>

      <div className="sidebar-install">
        <InstallButton variant="sidebar" />
      </div>
    </aside>
  );
}
