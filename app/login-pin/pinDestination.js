// @ts-nocheck — shared by the client PIN form and node route tests.
import { itemForPath } from '../_components/navRegistry.js';

export const DEFAULT_PIN_NEXT = '/analytics';

export function safeNextPath(rawNext) {
  const next = typeof rawNext === 'string' ? rawNext.trim() : '';
  if (!next.startsWith('/')) return DEFAULT_PIN_NEXT;
  if (next.startsWith('//') || next.startsWith('/\\')) return DEFAULT_PIN_NEXT;
  return next;
}

export function destinationLabel(rawNext) {
  const safeNext = safeNextPath(rawNext);
  const pathname = safeNext.split(/[?#]/, 1)[0] || DEFAULT_PIN_NEXT;
  return itemForPath(pathname)?.name || 'Sensitive pages';
}
