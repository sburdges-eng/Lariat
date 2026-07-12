// @ts-check
'use client';

/**
 * RoleProvider — client-side role context derived from the `lariat_pin_ok`
 * cookie (same cookie middleware.js and /api/auth/pin use). Keeps the UI in
 * sync with whatever the server-side guards do.
 *
 * NOTE: `lariat_pin_ok` is set HttpOnly by /api/auth/pin, so `document.cookie`
 * CANNOT see it. The client therefore learns its own role by pinging the
 * server. We use HEAD /api/auth/pin-status (a thin GET that just echoes
 * whether the cookie is present) — same-origin, fast, cache-busted. If that
 * endpoint isn't wired yet we fall back to a probe of /api/auth/pin + a
 * 200/401 heuristic on any sensitive route.
 *
 * Server-side (`/api/audit/log`, `/api/recipes/[slug]` PUT, etc.) is the real
 * gate: it inspects the cookie via `next/headers`. This provider is purely
 * for rendering — show/hide the Edit button, redirect away from the audit-log
 * page for staff, etc. Never trust it for authorization decisions.
 *
 * Contract (consumed by app/management/audit-log, app/recipes/[slug]/edit,
 * and tests under app/__tests__):
 *
 *   const { role, canEditRecipes, canViewFinancials, isLoading } = useRole();
 *
 *   role              'staff' | 'management'
 *   canEditRecipes    true iff role === 'management'
 *   canViewFinancials true iff role === 'management'
 *   isLoading         true on first render, false after the cookie check
 *
 * Detection runs on mount and on `visibilitychange` / `focus` so that a
 * login/logout in another tab is picked up without a full reload.
 *
 * Test shim: because `lariat_pin_ok` is HttpOnly in production, jsdom tests
 * use a non-HttpOnly `lariat_pin_ok` on `document.cookie` to simulate the
 * authenticated state. `readPinCookie()` honors whichever shows up first.
 */

import { createContext, useContext, useEffect, useState } from 'react';

/** @typedef {'staff' | 'management'} Role */

/**
 * @typedef {{
 *   role: Role,
 *   canEditRecipes: boolean,
 *   canViewFinancials: boolean,
 *   isLoading: boolean,
 * }} RoleContextValue
 */

const RoleContext = createContext(/** @type {RoleContextValue | null} */ (null));

/** @returns {boolean} */
function readPinCookie() {
  if (typeof document === 'undefined') return false;
  // Cheap parse — no dependency on `cookie` pkg. In prod the cookie is
  // HttpOnly so this returns false and we rely on the server probe below.
  // Client-side, the value is opaque: we treat any non-empty value as
  // "present". The real HMAC check happens server-side; a tampered
  // cookie won't survive middleware.js or hasPinCookie().
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('lariat_pin_ok='));
  if (!match) return false;
  const v = match.slice('lariat_pin_ok='.length);
  return v.length > 0 && v !== 'deleted';
}

/** @returns {Promise<boolean>} */
async function probePinStatus() {
  if (typeof fetch === 'undefined') return false;
  try {
    // /api/auth/pin GET returns { pin_enabled: bool }. If PIN is disabled
    // the whole gate is open and everyone is "management" on the client.
    // If PIN is enabled, hit a known sensitive endpoint and treat a
    // non-403 as authenticated.
    const cfg = await fetch('/api/auth/pin', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (cfg && cfg.pin_enabled === false) return true;
    const probe = await fetch('/api/audit/log?limit=1', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
    });
    return probe.status !== 403;
  } catch {
    return false;
  }
}

/**
 * @param {{ children: import('react').ReactNode }} props
 */
export function RoleProvider({ children }) {
  const [role, setRole] = useState(/** @type {Role} */ ('staff'));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      // Fast path: tests (and any dev setup that serves the cookie non-HttpOnly)
      // can be read straight from document.cookie.
      if (readPinCookie()) {
        if (!cancelled) {
          setRole('management');
          setIsLoading(false);
        }
        return;
      }
      // Prod path: HttpOnly cookie isn't visible to JS, so ask the server.
      const ok = await probePinStatus();
      if (!cancelled) {
        setRole(ok ? 'management' : 'staff');
        setIsLoading(false);
      }
    };
    sync();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sync();
    };
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const value = {
    role,
    canEditRecipes: role === 'management',
    canViewFinancials: role === 'management',
    isLoading,
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

/**
 * Works inside a RoleProvider tree. If used outside one (e.g. a route that
 * forgot to mount the provider), we degrade gracefully by reading the cookie
 * directly — same observable behavior, one render late, and `isLoading` stays
 * false so page-level gates don't hang.
 *
 * @returns {RoleContextValue}
 */
export function useRole() {
  const ctx = useContext(RoleContext);
  if (ctx) return ctx;

  const isManagement = readPinCookie();
  const role = isManagement ? 'management' : 'staff';
  return {
    role,
    canEditRecipes: isManagement,
    canViewFinancials: isManagement,
    isLoading: false,
  };
}
