// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
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

/** @typedef {{ params: Promise<{ id?: string }> | { id?: string } }} RouteCtx */

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function GET(req, { params }) {

  params = await params;
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
    if (/not found/.test(String(/** @type {{ message?: unknown } | null} */ (e)?.message)))
      return json({ error: 'show not found' }, { status: 404 });
    throw e;
  }
  const html = renderSettlementHtml(summary);
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // Audit H7 (2026-05-14): defense-in-depth headers. Every
      // interpolated field in renderSettlementHtml flows through
      // escapeHtml, and the inline <style> + <script> blocks are
      // static today — so this CSP is no behaviour change. It locks
      // out external loads and pins the inline-only contract so a
      // future contributor adding user-data interpolation into the
      // STYLE/script blocks would need an explicit CSP relaxation
      // (visible diff), not a silent regression.
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}
