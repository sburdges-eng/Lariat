// @ts-check
import Link from 'next/link';
import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { formatDollars } from '../../lib/formatMoney';
import { enrichOrderGuideRows } from '../../lib/orderGuideEnrichment.ts';

/** @typedef {import('../../lib/orderGuideEnrichment.ts').OrderGuideRow} OrderGuideRow */

export const dynamic = 'force-dynamic';

/**
 * The order guide is what somebody actually orders from, so it has to be the
 * guide for the venue the URL names. This page used to hardcode
 * DEFAULT_LOCATION_ID and never read searchParams at all, so
 * /purchasing?location=west showed the default venue's guide with nothing on
 * screen to say so.
 *
 * @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props
 */
export default async function PurchasingPage({ searchParams } = {}) {
  const sp = (await searchParams) || {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  // Every hop between these three pages has to carry the venue, or the
  // location dies on the first click and the next page silently shows
  // 'default'. Empty for the default venue so ordinary URLs stay clean.
  const locQuery = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';
  const db = getDb();
  const rawRows = /** @type {OrderGuideRow[]} */ (
    db
      .prepare(
        `SELECT ingredient, base_qty, unit, vendor, unit_price FROM order_guide_items WHERE location_id = ? ORDER BY vendor, ingredient LIMIT 200`
      )
      .all(loc)
  );
  const rows = enrichOrderGuideRows(db, rawRows, loc);
  const n = /** @type {{ c: number }} */ (
    db.prepare(`SELECT COUNT(*) as c FROM order_guide_items WHERE location_id = ?`).get(loc)
  ).c;

  return (
    <div>
      <h1>Order guide</h1>
      <p className="subtitle">
        From the <strong>Order Guide</strong> sheet ({n} items). Pull fresh after the operations workbook is updated.
        {' '}
        <Link href={`/purchasing/compare${locQuery}`}>Sysco vs Shamrock</Link>
        {' · '}
        <Link href={`/purchasing/link${locQuery}`}>Link vendors</Link>
      </p>

      {n === 0 && (
        <div className="card" style={{ borderColor: 'var(--yellow)' }}>
          No order guide yet. Drop the operations workbook in place, then pull fresh.
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>Base qty</th>
              <th>Unit</th>
              <th>Vendor</th>
              <th>Unit $</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.ingredient}</td>
                <td>{r.base_qty != null ? String(r.base_qty) : '—'}</td>
                <td>{r.unit}</td>
                <td>{r.vendor}</td>
                <td>{formatDollars(r.unit_price)}</td>
                <td>
                  {r.enrichment?.preferred_vendor ? (
                    <span title="Preferred vendor">Pref {r.enrichment.preferred_vendor}</span>
                  ) : null}
                  {r.enrichment?.quality_locked ? (
                    <span title={r.enrichment.quality_lock_reason || 'quality'} style={{ marginLeft: 6 }}>Locked</span>
                  ) : null}
                  {r.enrichment?.vendor_mismatch ? (
                    <span title="Guide vendor differs from preferred" style={{ marginLeft: 6, color: 'var(--amber, #8a5a00)' }}>
                      Mismatch
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
