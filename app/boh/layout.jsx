// @ts-check
// The line book seeds client locale from the cookie so the sheet chrome
// (buttons, the "working sheet" line, the done counter) speaks the cook's
// language. Sheet body content stays in the language it was written in —
// pack sizes and brine times are not machine-translated.

import I18nProvider from '../_components/I18nProvider.jsx';
import { getLocale } from '../../lib/i18n/server.ts';

export const dynamic = 'force-dynamic';

/** @param {{ children: import('react').ReactNode }} props */
export default async function BohLayout({ children }) {
  const locale = await getLocale();
  return <I18nProvider locale={locale}>{children}</I18nProvider>;
}
