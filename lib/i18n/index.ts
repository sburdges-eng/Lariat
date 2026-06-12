// Lariat i18n — hand-rolled dictionary for cook-tier surfaces (roadmap 3.8).
//
// Deliberately NOT next-intl: the cook corpus is ~200 short strings with
// only `{token}` interpolation and en/es-identical one/other plurals, the
// repo ships six production deps on an offline-first posture, and server
// components need nothing more than a pure getMessages(). If a locale
// with genuinely hard plural rules ever lands, the flat key shape ports
// to next-intl mechanically.
//
// Type-level completeness: `en` is the source of truth; `es` is typed
// `Messages = typeof en`, so `npm run typecheck` fails on any missing or
// extra key. tests/js/test-i18n-catalog.mjs adds the runtime walk
// (placeholder parity, plural pairs, copy rules).
//
// Plurals: convention keys `<key>_one` / `<key>_other`, selected by
// `params.count`. English and Spanish share the rule, so no CLDR tables.

import { en } from './messages/en.ts';
import { es } from './messages/es.ts';

export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Server-readable locale preference. Not httpOnly — the client picker
 *  writes it with document.cookie and calls router.refresh(). */
export const LOCALE_COOKIE = 'lariat_locale';

export type Messages = typeof en;

const CATALOGS: Record<Locale, Messages> = { en, es };

export function normalizeLocale(raw: unknown): Locale {
  if (typeof raw !== 'string') return DEFAULT_LOCALE;
  const v = raw.trim().toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(v) ? (v as Locale) : DEFAULT_LOCALE;
}

export function getMessages(locale: Locale): Messages {
  return CATALOGS[locale] ?? en;
}

type Params = Record<string, string | number>;

function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Translate a dotted key. With `params.count` set, `<key>_one` /
 * `<key>_other` take precedence over a bare `<key>`. Unknown keys fall
 * back to the English catalog, then to the key itself — a missing string
 * must never blank a cook surface mid-shift.
 */
export function t(messages: Messages, key: string, params?: Params): string {
  let template: string | undefined;
  if (params && typeof params.count === 'number') {
    template = lookup(messages, `${key}_${params.count === 1 ? 'one' : 'other'}`);
  }
  template = template ?? lookup(messages, key);
  if (template === undefined && messages !== en) {
    if (params && typeof params.count === 'number') {
      template = lookup(en, `${key}_${params.count === 1 ? 'one' : 'other'}`);
    }
    template = template ?? lookup(en, key);
  }
  if (template === undefined) return key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
