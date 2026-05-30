// @ts-nocheck - server page matching the existing management dashboard style.
// /management/receiving-matches - manager queue for accepted receiving rows
// that could not be resolved to one ingredient master during cook entry.

import Link from 'next/link';

import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';

import ReceivingMatchResolver from './ReceivingMatchResolver';

export const dynamic = 'force-dynamic';

function readQueue(db, locationId) {
  return db.prepare(
    `SELECT r.id, r.shift_date, r.vendor, r.invoice_ref, r.category, r.item,
            r.vendor_sku, r.received_qty, r.received_unit, r.match_status,
            r.match_reason, r.created_at
       FROM receiving_log r
      WHERE r.location_id = ?
        AND r.status IN ('accepted', 'accepted_with_note')
        AND r.received_qty IS NOT NULL
        AND r.received_qty > 0
        AND r.received_unit IS NOT NULL
        AND TRIM(r.received_unit) <> ''
        AND r.match_status IN ('unmatched', 'ambiguous')
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 100`,
  ).all(locationId);
}

function readMasters(db) {
  return db.prepare(
    `SELECT master_id, canonical_name, category, preferred_vendor
       FROM ingredient_masters
      ORDER BY lower(canonical_name), master_id
      LIMIT 1000`,
  ).all();
}

function fmtQty(row) {
  if (row.received_qty == null || !row.received_unit) return '-';
  return `${row.received_qty} ${row.received_unit}`;
}

function fmtDateTime(value) {
  if (!value) return '-';
  const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ReceivingMatchesPage({ searchParams }) {
  const locParam = searchParams?.location;
  const loc =
    typeof locParam === 'string' && locParam.trim()
      ? locParam.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();
  const queue = readQueue(db, loc);
  const masters = readMasters(db);

  return (
    <div>
      <h1>Receiving matches</h1>
      <p className="subtitle">
        Accepted lines that need a master ingredient.
      </p>

      <div style={{ marginBottom: 16 }}>
        <Link href="/management">Back to management</Link>
      </div>

      {queue.length === 0 ? (
        <section className="tl-card">
          <h2 className="section-h">All caught up</h2>
          <p className="subtitle" style={{ marginBottom: 0 }}>
            No accepted delivery lines need a master ingredient.
          </p>
        </section>
      ) : (
        <section className="tl-card">
          <h2 className="section-h">Waiting ({queue.length})</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line, #cfc6b0)' }}>
                  <th style={{ padding: '8px 6px' }}>Received</th>
                  <th style={{ padding: '8px 6px' }}>Vendor</th>
                  <th style={{ padding: '8px 6px' }}>Item</th>
                  <th style={{ padding: '8px 6px' }}>SKU</th>
                  <th style={{ padding: '8px 6px' }}>Qty</th>
                  <th style={{ padding: '8px 6px' }}>Reason</th>
                  <th style={{ padding: '8px 6px' }}>Match</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((row) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--line, #e2dac8)' }}>
                    <td style={{ padding: '10px 6px', verticalAlign: 'top' }}>
                      {fmtDateTime(row.created_at)}
                    </td>
                    <td style={{ padding: '10px 6px', verticalAlign: 'top' }}>
                      {row.vendor}
                      {row.invoice_ref ? (
                        <div style={{ color: 'var(--muted, #6f6758)', fontSize: 11 }}>
                          {row.invoice_ref}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ padding: '10px 6px', verticalAlign: 'top' }}>
                      {row.item || '-'}
                    </td>
                    <td style={{ padding: '10px 6px', verticalAlign: 'top' }}>
                      {row.vendor_sku || '-'}
                    </td>
                    <td style={{ padding: '10px 6px', verticalAlign: 'top' }}>
                      {fmtQty(row)}
                    </td>
                    <td style={{ padding: '10px 6px', verticalAlign: 'top' }}>
                      {row.match_reason || row.match_status}
                    </td>
                    <td style={{ padding: '10px 6px', verticalAlign: 'top' }}>
                      <ReceivingMatchResolver
                        row={row}
                        masters={masters}
                        locationId={loc}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
