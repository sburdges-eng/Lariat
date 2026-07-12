// @ts-check
import Link from 'next/link';
import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { formatDollars } from '../../../lib/formatMoney';
import { listVendorCompareRows } from '../../../lib/vendorCompare.ts';
import { listSingleVendorMasters, summarizeMappingCoverage } from '../../../lib/vendorMapping.ts';
import CompareActions from './CompareActions.jsx';
import AttachVendorActions from './AttachVendorActions.jsx';

/** @typedef {import('../../../lib/vendorCompare.ts').VendorOfferSnapshot} VendorOfferSnapshot */

export const dynamic = 'force-dynamic';

/** @param {VendorOfferSnapshot | null | undefined} offer */
function fmtPrice(offer) {
  if (!offer || offer.status !== 'ok' || offer.normalized_price == null) return '—';
  const unit = offer.normalized_unit ? `/${offer.normalized_unit}` : '';
  return `${formatDollars(offer.normalized_price)}${unit}`;
}

/** @param {string | null | undefined} reason */
function reasonLabel(reason) {
  if (reason === 'unit_mismatch') return 'different pack';
  if (reason === 'need_density') return 'need weight bridge';
  if (reason === 'count_bridge') return 'count item';
  return 'can\'t compare';
}

export default function VendorComparePage() {
  const db = getDb();
  const summary = listVendorCompareRows(db, { locationId: DEFAULT_LOCATION_ID });
  const coverage = summarizeMappingCoverage(db, DEFAULT_LOCATION_ID);
  const singleVendorMasters = listSingleVendorMasters(db, DEFAULT_LOCATION_ID);

  return (
    <div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        <Link href="/purchasing">← Order guide</Link>
        {' · '}
        <Link href="/purchasing/link">Link vendors</Link>
      </p>
      <h1>Sysco vs Shamrock</h1>
      <p className="subtitle">
        {coverage.mapped_pairs} mapped · {coverage.single_vendor} on one vendor · {coverage.unlinked_sysco} Sysco
        unlinked · {coverage.unlinked_shamrock} Shamrock unlinked
      </p>

      {summary.rows.length === 0 && (
        <div className="card" style={{ borderColor: 'var(--yellow)' }}>
          No mapped pairs yet. <Link href="/purchasing/link">Link vendors</Link> to add your first staple.
        </div>
      )}

      {summary.rows.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Sysco</th>
                <th>Shamrock</th>
                <th>Preferred</th>
                <th>Lock</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => {
                const cheaper = row.cheaper_vendor;
                const syscoStyle =
                  cheaper === 'sysco' ? { background: 'var(--panel-2, #f0ebe0)' } : undefined;
                const shamStyle =
                  cheaper === 'shamrock' ? { background: 'var(--panel-2, #f0ebe0)' } : undefined;
                return (
                  <tr key={row.master_id}>
                    <td>{row.canonical_name}</td>
                    <td style={syscoStyle}>
                      {row.sysco?.status === 'ok' ? fmtPrice(row.sysco) : reasonLabel(row.sysco?.reason)}
                    </td>
                    <td style={shamStyle}>
                      {row.shamrock?.status === 'ok' ? fmtPrice(row.shamrock) : reasonLabel(row.shamrock?.reason)}
                    </td>
                    <td>{row.preferred_vendor || '—'}</td>
                    <td>
                      {row.quality_locked ? (
                        <span title={row.quality_lock_reason || 'quality'}>Locked</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <CompareActions
                        masterId={row.master_id}
                        preferredVendor={row.preferred_vendor}
                        qualityLocked={row.quality_locked}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {singleVendorMasters.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>One vendor only</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Has</th>
                <th>Missing</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {singleVendorMasters.map((row) => (
                <tr key={row.master_id}>
                  <td>{row.canonical_name}</td>
                  <td>{row.linked_vendor}</td>
                  <td>{row.missing_vendor}</td>
                  <td>
                    <AttachVendorActions
                      masterId={row.master_id}
                      missingVendor={row.missing_vendor}
                      canonicalName={row.canonical_name}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
