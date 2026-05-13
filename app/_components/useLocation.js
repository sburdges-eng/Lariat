// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
/**
 * useLocation() — shared client hook for the selected kitchen location.
 *
 * Replaces the ad-hoc `localStorage.getItem('lariat_location')` calls that
 * used to live in Sidebar.jsx and CommandPalette.jsx. One hook, one key.
 *
 * Returns:
 *   locationId    — string (defaults to 'default')
 *   locQuery      — '' when default, else '?location=<id>'
 *   setLocation() — persist a new id + broadcast to other tabs/components
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export const LOC_KEY = 'lariat_location';
export const LOC_EVENT = 'lariat:location-change';
export const DEFAULT_LOCATION = 'default';

function safeRead() {
  if (typeof window === 'undefined') return DEFAULT_LOCATION;
  try {
    return window.localStorage.getItem(LOC_KEY) || DEFAULT_LOCATION;
  } catch {
    return DEFAULT_LOCATION;
  }
}

function safeWrite(id) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOC_KEY, id);
  } catch {
    /* ignore private-mode or quota errors */
  }
}

function qsFor(id) {
  return !id || id === DEFAULT_LOCATION ? '' : `?location=${encodeURIComponent(id)}`;
}

export function useLocation() {
  // We deliberately seed with DEFAULT_LOCATION on the server so the first
  // render is identical on server + client; the real value lands in effect.
  const [locationId, setLocationId] = useState(DEFAULT_LOCATION);
  const params = useSearchParams();

  // Hydrate from localStorage after mount, and keep in sync across tabs.
  useEffect(() => {
    setLocationId(safeRead());
    const onStorage = (e) => {
      if (e.key === LOC_KEY) setLocationId(e.newValue || DEFAULT_LOCATION);
    };
    const onEvent = (e) => {
      setLocationId(e?.detail || DEFAULT_LOCATION);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(LOC_EVENT, onEvent);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(LOC_EVENT, onEvent);
    };
  }, []);

  // Query-string wins if present (e.g. an old deep link with ?location=west).
  useEffect(() => {
    const q = params?.get('location');
    if (q && q.trim()) {
      const v = q.trim();
      safeWrite(v);
      setLocationId(v);
    }
  }, [params]);

  const setLocation = useCallback((id) => {
    const next = id && id.trim() ? id.trim() : DEFAULT_LOCATION;
    safeWrite(next);
    setLocationId(next);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(LOC_EVENT, { detail: next }));
    }
  }, []);

  return {
    locationId,
    locQuery: qsFor(locationId),
    setLocation,
    isDefault: locationId === DEFAULT_LOCATION,
  };
}

/** Apply locQuery to an href, leaving explicit query strings alone. */
export function applyLocationQuery(href, locQuery) {
  if (!href || !locQuery) return href;
  if (href.includes('?')) return href;
  return `${href}${locQuery}`;
}
