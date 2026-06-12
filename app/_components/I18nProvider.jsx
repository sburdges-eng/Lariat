// @ts-check
'use client';

import { createContext, useContext, useMemo } from 'react';
import { getMessages, t, DEFAULT_LOCALE } from '../../lib/i18n/index.ts';

// Client-side locale context for the shared boards the v2 tree embeds
// (EightySixBoard, PunchTicketPage, StationChecklist). The v2 layout
// seeds it from the lariat_locale cookie server-side; an instance
// rendered WITHOUT a provider (the v1 routes) gets the English default —
// v1 chrome is not translated because it retires at cutover.
//
// Hydration safety: locale only ever arrives via props/context from the
// server render — never read document.cookie during render.

const I18nContext = createContext({
  locale: DEFAULT_LOCALE,
  messages: getMessages(DEFAULT_LOCALE),
});

/**
 * @param {{ locale: 'en' | 'es', children: import('react').ReactNode }} props
 */
export default function I18nProvider({ locale, children }) {
  const value = useMemo(
    () => ({ locale, messages: getMessages(locale) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Current locale ('en' outside a provider). */
export function useLocale() {
  return useContext(I18nContext).locale;
}

/** Translator bound to the current locale: tt('eightySix.addButton', params). */
export function useT() {
  const { messages } = useContext(I18nContext);
  return useMemo(
    () =>
      /** @param {string} key @param {Record<string, string | number>} [params] */
      (key, params) => t(messages, key, params),
    [messages],
  );
}
