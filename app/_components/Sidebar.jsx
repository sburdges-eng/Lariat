'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import PinLogout from './PinLogout.jsx';
import OfflineIndicator from './OfflineIndicator.jsx';
import InstallButton from './InstallButton.jsx';

const LOC_KEY = 'lariat_location';

/* ── Kitchen topology: the physical line order ──
   Cells 1-6 are stations (filled from /api/stations, but we keep a
   stable slot order so keyboard shortcuts don't shift around).
   Cell 8 is the always-present 86 board. */

function StationRing({ prog, glyph }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const pct = prog && prog.total ? Math.min(1, prog.done / prog.total) : 0;
  const off = c * (1 - pct);
  const tone = !prog ? '' : prog.flagged > 0 ? 'crit' : prog.signedOff || prog.done >= prog.total ? '' : prog.done > 0 ? 'warn' : 'crit';
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

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [staff, setStaff] = useState([]);
  const [cookId, setCookId] = useState('');
  const [locations, setLocations] = useState([{ id: 'default', name: 'The Lariat' }]);
  const [locationId, setLocationId] = useState('default');
  const [stations, setStations] = useState([]);

  useEffect(() => {
    fetch('/api/staff')
      .then((r) => r.json())
      .then((d) => setStaff(d || []))
      .catch((err) => console.error('Failed to load staff picker:', err));
    const savedCook = typeof window !== 'undefined' ? window.localStorage.getItem('lariat_cook') : '';
    if (savedCook) setCookId(savedCook);
    const savedLoc = typeof window !== 'undefined' ? window.localStorage.getItem(LOC_KEY) : '';
    if (savedLoc) setLocationId(savedLoc);
  }, []);

  useEffect(() => {
    fetch('/api/locations')
      .then((r) => r.json())
      .then((rows) => {
        if (Array.isArray(rows) && rows.length) setLocations(rows);
      })
      .catch((err) => console.error('Failed to load locations:', err));
  }, []);

  useEffect(() => {
    const q = searchParams.get('location');
    if (q && q.trim()) {
      const v = q.trim();
      setLocationId(v);
      window.localStorage.setItem(LOC_KEY, v);
    }
  }, [searchParams]);

  // Fetch stations + progress for the rail rings
  useEffect(() => {
    const qs = locationId !== 'default' ? `?location=${encodeURIComponent(locationId)}` : '';
    fetch(`/api/stations${qs}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setStations(d))
      .catch((err) => console.error('Failed to load stations:', err));
    // Poll every 30s so the rail reflects line-check progress during service
    const t = setInterval(() => {
      fetch(`/api/stations${qs}`)
        .then((r) => r.json())
        .then((d) => Array.isArray(d) && setStations(d))
        .catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [locationId, pathname]);

  const onCookChange = (e) => {
    setCookId(e.target.value);
    window.localStorage.setItem('lariat_cook', e.target.value);
  };

  const onLocationChange = (e) => {
    const v = e.target.value;
    setLocationId(v);
    window.localStorage.setItem(LOC_KEY, v);
    const u = new URL(window.location.href);
    if (v === 'default') u.searchParams.delete('location');
    else u.searchParams.set('location', v);
    window.location.href = u.pathname + u.search;
  };

  const locQuery = useMemo(
    () => (locationId !== 'default' ? `?location=${encodeURIComponent(locationId)}` : ''),
    [locationId]
  );

  const locationOptions = useMemo(() => {
    const ids = new Set(locations.map((l) => l.id));
    if (locationId && !ids.has(locationId)) {
      return [...locations, { id: locationId, name: `${locationId} (not in DB)` }];
    }
    return locations;
  }, [locations, locationId]);

  // Keyboard shortcuts: 1-6 jump to station N, 8 -> 86 board, 0 -> Today
  useEffect(() => {
    const handler = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.target && e.target.isContentEditable) return;
      const k = e.key;
      if (k === '0') {
        router.push(`/${locQuery}`);
      } else if (/^[1-6]$/.test(k)) {
        const idx = parseInt(k, 10) - 1;
        const s = stations[idx];
        if (s) router.push(`/stations/${s.id}${locQuery}`);
      } else if (k === '8') {
        router.push(`/eighty-six${locQuery}`);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [stations, locQuery, router]);

  // Nav link helper — preserves old location-aware href rewriting
  const link = useCallback(
    (href, label, shortcut) => {
      const withLoc =
        href === '/' ||
        href.startsWith('/stations') ||
        href.startsWith('/recipes') ||
        href.startsWith('/eighty-six') ||
        href.startsWith('/inventory') ||
        href.startsWith('/kitchen-assistant') ||
        href.startsWith('/gold-stars') ||
        href.startsWith('/food-safety') ||
        href.startsWith('/labor')
          ? `${href}${locQuery}`
          : href;
      const active = pathname === href || (href !== '/' && pathname.startsWith(href));
      return (
        <Link href={withLoc} className={active ? 'active' : ''}>
          <span className="nav-key">{shortcut || '·'}</span>
          <span className="nav-lbl">
            <span className="t">{label}</span>
          </span>
        </Link>
      );
    },
    [pathname, locQuery]
  );

  // Station cell (1 of the rings)
  const stationCell = (s, idx) => {
    const href = `/stations/${s.id}${locQuery}`;
    const active = pathname.startsWith(`/stations/${s.id}`);
    const glyph = String(idx + 1);
    return (
      <Link key={s.id} href={href} className={`station-cell ${active ? 'active' : ''}`}>
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
        <span className="sc-key">{glyph}</span>
      </Link>
    );
  };

  return (
    <aside className="sidebar">
      <div className="line-rope" aria-hidden />

      <div className="brand">
        <span>The Line</span>
        <small>Cockpit</small>
      </div>

      <nav className="nav">
        {link('/', 'Today', '0')}

        <div className="nav-section">Stations</div>
        {stations.slice(0, 6).map((s, i) => stationCell(s, i))}
        {stations.length === 0 && (
          <div className="nav-disabled">Loading stations…</div>
        )}

        <div className="nav-section">Service</div>
        {link('/eighty-six', '86 Board', '8')}
        {link('/recipes', 'Recipes', 'R')}
        {link('/inventory', 'Inventory', 'I')}
        {link('/kitchen-assistant', 'Ask the kitchen', '?')}
        {link('/specials', 'Specials', 'S')}
        {link('/gold-stars', 'Gold stars', '★')}

        <div className="nav-section">Compliance</div>
        {link('/food-safety', 'Food safety')}
        {link('/food-safety/temp-log', 'Temp log')}
        {link('/food-safety/receiving', 'Receiving')}
        {link('/food-safety/calibrations', 'Calibrations')}
        {link('/labor', 'Labor')}

        <div className="nav-section">Books</div>
        <div className="shelf-grid">
          <Link href={`/analytics${locQuery}`} className="shelf-tile">
            <b>Sales</b>
            <span>numbers</span>
          </Link>
          <Link href={`/costing${locQuery}`} className="shelf-tile">
            <b>Costs</b>
            <span>recipes</span>
          </Link>
          <Link href={`/purchasing${locQuery}`} className="shelf-tile">
            <b>Orders</b>
            <span>guide</span>
          </Link>
          <Link href={`/menu-engineering${locQuery}`} className="shelf-tile">
            <b>Menu</b>
            <span>perf</span>
          </Link>
          <Link href={`/beo${locQuery}`} className="shelf-tile">
            <b>Events</b>
            <span>& prep</span>
          </Link>
          <Link href={`/equipment${locQuery}`} className="shelf-tile">
            <b>Equip.</b>
            <span>gear</span>
          </Link>
        </div>

        <div className="nav-section">Location</div>
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
              {s.first} {s.last}
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
