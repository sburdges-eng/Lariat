// @ts-check
// The line book — every sheet in the printed BOH ops packet, on a phone.
//
// Line sheets come first because that is who is holding the phone during
// service. Manager sheets sit below and behind the PIN (middleware.js);
// tier lives in lib/boh and the gate is asserted against it in
// tests/js/test-boh-pin-coverage.mjs.

import Link from 'next/link';
import { sheetsByTier, bohPath } from '../../lib/boh/index.ts';
import { getMessages, t } from '../../lib/i18n/index.ts';
import { getLocale } from '../../lib/i18n/server.ts';

export const dynamic = 'force-dynamic';

/**
 * @param {{ sheet: import('../../lib/boh/types').BohSheet, tag: string | null }} props
 */
function SheetTile({ sheet, tag }) {
  return (
    <Link href={bohPath(sheet.slug)} className="boh-tile">
      <div className="boh-tile-head">
        <span className="boh-tile-title">{sheet.title}</span>
        {tag ? <span className="boh-tag">{tag}</span> : null}
      </div>
      <span className="boh-tile-blurb">{sheet.blurb}</span>
    </Link>
  );
}

export default async function BohHub() {
  const locale = await getLocale();
  const m = getMessages(locale);
  const cook = sheetsByTier('cook');
  const manager = sheetsByTier('manager');

  return (
    <div className="boh-hub">
      <h1>{t(m, 'boh.title')}</h1>
      <p className="subtitle">{t(m, 'boh.subtitle')}</p>

      <div className="boh-notice">
        <p>{t(m, 'boh.notARecord')}</p>
        <Link href="/food-safety">{t(m, 'boh.foodSafetyLink')}</Link>
      </div>

      <div className="boh-tiles">
        {cook.map((sheet) => (
          <SheetTile key={sheet.slug} sheet={sheet} tag={null} />
        ))}
      </div>

      <h2 className="boh-group">{t(m, 'boh.managerTag')}</h2>
      <div className="boh-tiles">
        {manager.map((sheet) => (
          <SheetTile key={sheet.slug} sheet={sheet} tag={t(m, 'boh.managerTag')} />
        ))}
      </div>
    </div>
  );
}
