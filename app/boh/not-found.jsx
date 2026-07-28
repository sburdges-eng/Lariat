// @ts-check
// A sheet slug that is not in the book.
//
// Without this, notFound() fell through to the app-wide 404, which renders
// the whole cockpit home page — a cook who mistyped a URL or kept a stale
// bookmark landed on every board in the building mid-shift with no way back
// to their own sheet. This keeps them one tap from the book.

import Link from 'next/link';
import { BOH_BASE } from '../../lib/boh/index.ts';
import { getMessages, t } from '../../lib/i18n/index.ts';
import { getLocale } from '../../lib/i18n/server.ts';

export default async function BohSheetNotFound() {
  const locale = await getLocale();
  const m = getMessages(locale);

  return (
    <div className="boh-sheet">
      <div className="boh-sheet-top">
        <Link href={BOH_BASE} className="boh-back">
          ← {t(m, 'boh.backToBook')}
        </Link>
        <h1>{t(m, 'boh.missing')}</h1>
        <p className="boh-sheet-date">{t(m, 'boh.missingHelp')}</p>
      </div>
      <div className="boh-actions">
        <Link href={BOH_BASE} className="btn primary">
          {t(m, 'boh.title')}
        </Link>
      </div>
    </div>
  );
}
