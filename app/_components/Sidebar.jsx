'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import PinLogout from './PinLogout.jsx';
import OfflineIndicator from './OfflineIndicator.jsx';
import InstallButton from './InstallButton.jsx';

const LOC_KEY = 'lariat_location';

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [staff, setStaff] = useState([]);
  const [cookId, setCookId] = useState('');
  const [locations, setLocations] = useState([{ id: 'default', name: 'The Lariat' }]);
  const [locationId, setLocationId] = useState('default');

  useEffect(() => {
    fetch('/api/staff')
      .then(r => r.json())
      .then(d => setStaff(d || []))
      .catch((err) => console.error('Failed to load staff picker:', err));
    const savedCook = typeof window !== 'undefined' ? window.localStorage.getItem('lariat_cook') : '';
    if (savedCook) setCookId(savedCook);
    const savedLoc = typeof window !== 'undefined' ? window.localStorage.getItem(LOC_KEY) : '';
    if (savedLoc) setLocationId(savedLoc);
  }, []);

  useEffect(() => {
    fetch('/api/locations')
      .then(r => r.json())
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

  const link = useCallback((href, label) => {
    const withLoc = href === '/' || href.startsWith('/stations') || href.startsWith('/recipes') || href.startsWith('/eighty-six') || href.startsWith('/inventory') || href.startsWith('/kitchen-assistant') || href.startsWith('/gold-stars') || href.startsWith('/food-safety') || href.startsWith('/labor')
      ? `${href}${locQuery}`
      : href;
    const active = pathname === href || (href !== '/' && pathname.startsWith(href));
    return (
      <Link href={withLoc} className={active ? 'active' : ''}>{label}</Link>
    );
  }, [pathname, locQuery]);

  return (
    <aside className="sidebar">
      <div className="brand">
        THE LARIAT
        <small>Kitchen Cockpit</small>
      </div>
      <nav className="nav">
        {link('/', 'Today')}
        {link('/stations', 'Stations')}
        {link('/recipes', 'Recipes')}
        {link('/eighty-six', '86 Board')}
        {link('/inventory', 'Inventory')}
        {link('/kitchen-assistant', 'Ask the kitchen')}
        {link('/specials', 'Specials')}
        {link('/gold-stars', 'Gold stars')}
        <div className="nav-section">Compliance</div>
        {link('/food-safety', 'Food safety')}
        {link('/food-safety/temp-log', 'Temp log')}
        {link('/food-safety/receiving', 'Receiving')}
        {link('/labor', 'Labor')}
        <div className="nav-section">Manager stuff</div>
        {link('/analytics', 'Sales numbers')}
        {link('/costing', 'Recipe costs')}
        {link('/purchasing', 'Order guide')}
        {link('/menu-engineering', 'Menu performance')}
        {link('/beo', 'Events & prep')}
        {link('/equipment', 'Equipment')}
        <div className="nav-section">Location</div>
        <div className="location-picker">
          <OfflineIndicator />
          <label htmlFor="lariat-loc">Location</label>
          <select id="lariat-loc" value={locationId} onChange={onLocationChange}>
            {locationOptions.map((l) => (
              <option key={l.id} value={l.id}>{l.name || l.id}</option>
            ))}
          </select>
          <p className="location-hint">Stays set on this device.</p>
        </div>
      </nav>
      <div className="cook-picker">
        <label>You&apos;re clocked in as</label>
        <select value={cookId} onChange={onCookChange}>
          <option value="">— pick your name —</option>
          {staff.map(s => (
            <option key={s.id} value={s.id}>{s.first} {s.last}</option>
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
