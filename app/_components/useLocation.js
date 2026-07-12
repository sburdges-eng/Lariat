// @ts-check
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

/**
 * @typedef {Object} LocationState
 * @property {string} locationId
 * @property {string} locQuery
 * @property {(id: string) => void} setLocation
 * @property {boolean} isDefault
 */

/** @returns {string} */
function safeRead() {
  if (typeof window === 'undefined') return DEFAULT_LOCATION;
  try {
    return window.localStorage.getItem(LOC_KEY) || DEFAULT_LOCATION;
  } catch {
    return DEFAULT_LOCATION;
  }
}

/** @param {string} id */
function safeWrite(id) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOC_KEY, id);
  } catch {
    /* ignore private-mode or quota errors */
  }
}

/**
 * @param {string} id
 * @returns {string}
 */
function qsFor(id) {
  return !id || id === DEFAULT_LOCATION ? '' : `?location=${encodeURIComponent(id)}`;
}

/** @returns {LocationState} */
export function useLocation() {
  // We deliberately seed with DEFAULT_LOCATION on the server so the first
  // render is identical on server + client; the real value lands in effect.
  const [locationId, setLocationId] = useState(DEFAULT_LOCATION);
  const params = useSearchParams();

  // Hydrate from localStorage after mount, and keep in sync across tabs.
  useEffect(() => {
    setLocationId(safeRead());
    /** @param {StorageEvent} e */
    const onStorage = (e) => {
      if (e.key === LOC_KEY) setLocationId(e.newValue || DEFAULT_LOCATION);
    };
    /** @param {Event} e */
    const onEvent = (e) => {
      const detail = /** @type {CustomEvent<string>} */ (e).detail;
      setLocationId(detail || DEFAULT_LOCATION);
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

  const setLocation = useCallback(/** @param {string} id */ (id) => {
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

/**
 * Apply locQuery to an href, leaving explicit query strings alone.
 * @param {string} href
 * @param {string} locQuery
 * @returns {string}
 */
export function applyLocationQuery(href, locQuery) {
  if (!href || !locQuery) return href;
  if (href.includes('?')) return href;
  return `${href}${locQuery}`;
}
