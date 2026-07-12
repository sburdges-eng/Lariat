// @ts-check
// Shared by the client PIN form and node route tests.
import { itemForPath } from '../_components/navRegistry.js';

export const DEFAULT_PIN_NEXT = '/analytics';

/**
 * Sanitize an arbitrary `?next=` query value down to a same-origin path,
 * falling back to DEFAULT_PIN_NEXT for anything absolute/protocol-relative
 * (open-redirect guard — middleware.js only ever sends same-origin values,
 * but this also runs against whatever a user types into the URL bar).
 * @param {unknown} rawNext
 * @returns {string}
 */
export function safeNextPath(rawNext) {
  const next = typeof rawNext === 'string' ? rawNext.trim() : '';
  if (!next.startsWith('/')) return DEFAULT_PIN_NEXT;
  if (next.startsWith('//') || next.startsWith('/\\')) return DEFAULT_PIN_NEXT;
  return next;
}

/**
 * Human-readable name of the page a sanitized `next` path points at, for
 * the "Open {destination}" copy on the PIN form.
 * @param {unknown} rawNext
 * @returns {string}
 */
export function destinationLabel(rawNext) {
  const safeNext = safeNextPath(rawNext);
  const pathname = safeNext.split(/[?#]/, 1)[0] || DEFAULT_PIN_NEXT;
  return itemForPath(pathname)?.name || 'Sensitive pages';
}
