// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// PIN-gated print-ready settlement view.
//
// Returns text/html (not application/pdf) — the operator hits browser
// "Save as PDF" from the print dialog auto-opened by the inline script.
// This avoids a headless-browser dependency and lets the operator pick
// paper size + destination. See lib/settlementPrint.ts.

import { hasPinCookie } from '../../../../../../lib/pin';
import { locationFromRequest } from '../../../../../../lib/location';
import { getSettlement } from '../../../../../../lib/settlementRepo';
import { renderSettlementHtml } from '../../../../../../lib/settlementPrint';
import { json } from '../../../../../../lib/routeHelpers';

export async function GET(req, { params }) {
  if (!(await hasPinCookie(req)))
    return json({ error: 'unauthorized' }, { status: 401 });
  const showId = Number(params.id);
  if (!Number.isInteger(showId))
    return json({ error: 'bad show id' }, { status: 400 });
  const locationId = locationFromRequest(req);
  let summary;
  try {
    summary = getSettlement(showId, locationId);
  } catch (e) {
    if (/not found/.test(String(e?.message)))
      return json({ error: 'show not found' }, { status: 404 });
    throw e;
  }
  const html = renderSettlementHtml(summary);
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
