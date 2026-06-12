// Server-side locale resolution — reads the lariat_locale cookie set by
// app/_components/LocalePicker.jsx. Server-only module (next/headers);
// client components receive locale via props/context instead.

import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale, type Locale } from './index.ts';

export async function getLocale(): Promise<Locale> {
  try {
    const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
    return normalizeLocale(raw);
  } catch {
    // Outside a request scope (build-time render of a static segment) —
    // every v2 surface is force-dynamic, so this is belt-and-suspenders.
    return DEFAULT_LOCALE;
  }
}
