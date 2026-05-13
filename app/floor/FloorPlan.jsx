// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

// Status → fill color for table rectangles. Mirrors the canonical
// state machine from /api/dining-tables: open → seated → dirty → open.
// 'closed' takes a table out of rotation (kept gray).
const STATUS_FILL = {
  open: 'var(--green, #16a34a)',
  seated: 'var(--red, #ef4444)',
  dirty: 'var(--orange, #c0531c)',
  closed: 'var(--muted, #888)',
};

const STATUS_LABEL = {
  open: 'Open',
  seated: 'Seated',
  dirty: 'Dirty',
  closed: 'Closed',
};

// Pixels per table-coord unit on the SVG canvas. Tables in the DB use
// abstract grid units (e.g. x=0..6, w=1..2); 60px per unit gives a
// readable 60×60 square minimum without forcing a real-world scale.
const UNIT = 60;
const PADDING = 24;
const MIN_W = 600;
const MIN_H = 400;

// Default starter set used by the empty-state "Add a few tables"
// button — six 2-tops on a 2-row grid. Matches the API's default
// capacity (2). Kept tiny so a brand-new install can get a working
// floor in one click; the manager can rename/resize later.
const STARTER_TABLES = [
  { id: 'T1', name: 'T1', capacity: 2, x: 0, y: 0, w: 1, h: 1 },
  { id: 'T2', name: 'T2', capacity: 2, x: 2, y: 0, w: 1, h: 1 },
  { id: 'T3', name: 'T3', capacity: 2, x: 4, y: 0, w: 1, h: 1 },
  { id: 'T4', name: 'T4', capacity: 2, x: 0, y: 2, w: 1, h: 1 },
  { id: 'T5', name: 'T5', capacity: 2, x: 2, y: 2, w: 1, h: 1 },
  { id: 'T6', name: 'T6', capacity: 2, x: 4, y: 2, w: 1, h: 1 },
];

export default function FloorPlan({ tables, reservations, locationId, today }) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  // busyId guards every mutation: while non-null, all action buttons
  // are disabled, even on other tables. Single-shared-flight is
  // simpler than per-button refs and matches the EightySixBoard
  // pattern of "one in-flight write at a time".
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  // Selected table is resolved from `tables` so a router.refresh()
  // after a status change immediately shows the new status in the
  // open panel without needing a separate re-fetch.
  const selected = useMemo(
    () => tables.find((t) => t.id === selectedId) || null,
    [tables, selectedId],
  );

  // SVG canvas size = bounding box of all tables, with min 600x400.
  // Tables can sit at any (x,y) — we take max(x+w), max(y+h). Floor
  // coords are non-negative by convention; if a future migration
  // allows negatives this would need adjustment.
  const { canvasW, canvasH } = useMemo(() => {
    let maxX = 0;
    let maxY = 0;
    for (const t of tables) {
      const w = Number(t.w) || 1;
      const h = Number(t.h) || 1;
      const x = Number(t.x) || 0;
      const y = Number(t.y) || 0;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    }
    return {
      canvasW: Math.max(MIN_W, maxX * UNIT + PADDING * 2),
      canvasH: Math.max(MIN_H, maxY * UNIT + PADDING * 2),
    };
  }, [tables]);

  const patchTable = async (id, body) => {
    setBusyId(id);
    setErr('');
    try {
      const res = await fetch(`/api/dining-tables/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...body,
          location_id: locationId,
          cook_id: cookId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Did not save — try again.');
        setBusyId(null);
        return false;
      }
    } catch {
      setErr('Lost connection — not saved.');
      setBusyId(null);
      return false;
    }
    setBusyId(null);
    return true;
  };

  const seatReservation = async (resId, tableId) => {
    // Two-PATCH "seat a reservation" flow:
    //   1) PATCH /api/reservations/:id { seat: true, table_id }
    //      → marks the reservation seated + assigns the table.
    //   2) PATCH /api/dining-tables/:id { status: 'seated' }
    //      → flips the floor square red.
    // We do them sequentially: if (1) fails the table stays open; if
    // (2) fails the reservation is already seated but the floor
    // square is wrong — we surface an error so the host can re-tap.
    setBusyId(tableId);
    setErr('');
    let ok = false;
    try {
      const res = await fetch(`/api/reservations/${resId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          seat: true,
          table_id: tableId,
          location_id: locationId,
          cook_id: cookId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Could not seat reservation.');
        setBusyId(null);
        return;
      }
      ok = true;
    } catch {
      setErr('Lost connection — not saved.');
      setBusyId(null);
      return;
    }
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/dining-tables/${encodeURIComponent(tableId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            status: 'seated',
            location_id: locationId,
            cook_id: cookId,
          }),
        },
      );
      if (!res.ok) {
        setErr('Reservation seated but table state did not update — refresh.');
      }
    } catch {
      setErr('Reservation seated but table state did not update — refresh.');
    }
    setBusyId(null);
    router.refresh();
  };

  const addStarterTables = async () => {
    setBusyId('__starter__');
    setErr('');
    for (const t of STARTER_TABLES) {
      try {
        const res = await fetch('/api/dining-tables', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...t,
            location_id: locationId,
            cook_id: cookId,
          }),
        });
        // 409 (id already in use) is benign — someone else may have
        // seeded already, or this is a partial retry. Keep going.
        if (!res.ok && res.status !== 409) {
          const j = await res.json().catch(() => ({}));
          setErr(j.error || 'Could not add starter tables.');
          setBusyId(null);
          return;
        }
      } catch {
        setErr('Lost connection — not saved.');
        setBusyId(null);
        return;
      }
    }
    setBusyId(null);
    router.refresh();
  };

  const onChangeStatus = async (id, status) => {
    const ok = await patchTable(id, { status });
    if (ok) router.refresh();
  };

  return (
    <div>
      <h1>Floor</h1>
      <p className="subtitle">
        {tables.length} table{tables.length === 1 ? '' : 's'} ·{' '}
        {countByStatus(tables, 'seated')} seated ·{' '}
        {countByStatus(tables, 'open')} open ·{' '}
        {countByStatus(tables, 'dirty')} dirty
      </p>

      <Legend />

      {err && (
        <div
          role="alert"
          aria-live="assertive"
          className="card"
          style={{
            borderLeft: '3px solid var(--red)',
            color: 'var(--red)',
            margin: '12px 0',
          }}
        >
          {err}
        </div>
      )}

      {tables.length === 0 ? (
        <EmptyState
          onAdd={addStarterTables}
          busy={busyId === '__starter__'}
        />
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="card" style={{ flex: '1 1 600px', overflow: 'auto', padding: 8 }}>
            <svg
              width={canvasW}
              height={canvasH}
              role="img"
              aria-label="Floor plan"
              style={{ display: 'block', background: '#fafaf7' }}
            >
              {tables.map((t) => (
                <TableShape
                  key={t.id}
                  t={t}
                  selected={t.id === selectedId}
                  onClick={() => setSelectedId(t.id)}
                />
              ))}
            </svg>
          </div>

          {selected && (
            <ActionPanel
              table={selected}
              reservations={reservations}
              busyId={busyId}
              cookId={cookId}
              onClose={() => setSelectedId(null)}
              onChangeStatus={onChangeStatus}
              onSeatReservation={seatReservation}
            />
          )}
        </div>
      )}
    </div>
  );
}

function countByStatus(tables, status) {
  let n = 0;
  for (const t of tables) if (t.status === status) n += 1;
  return n;
}

function Legend() {
  // Visual key for the four table colors. Rendered as a short
  // horizontal strip so it stays out of the way on narrow tablets.
  const items = [
    { status: 'open', label: 'Open' },
    { status: 'seated', label: 'Seated' },
    { status: 'dirty', label: 'Dirty' },
    { status: 'closed', label: 'Closed' },
  ];
  return (
    <div
      aria-label="legend"
      role="list"
      style={{
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
        margin: '8px 0 16px',
        fontSize: 13,
      }}
    >
      {items.map((it) => (
        <div
          key={it.status}
          role="listitem"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 14,
              height: 14,
              borderRadius: 3,
              background: STATUS_FILL[it.status],
              border: '1px solid rgba(0,0,0,0.15)',
            }}
          />
          {it.label}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onAdd, busy }) {
  return (
    <div className="empty card" role="status" aria-live="polite" style={{ padding: 24 }}>
      <div style={{ fontSize: 16, marginBottom: 8 }}>
        No tables on this floor yet.
      </div>
      <div className="meta" style={{ marginBottom: 16 }}>
        Drop in a small starter set (T1–T6, two-tops) so you can play
        with the colors. You can rename and rearrange later.
      </div>
      <button
        type="button"
        className="btn primary"
        onClick={onAdd}
        disabled={busy}
      >
        {busy ? 'Adding…' : 'Add a few tables to get started'}
      </button>
    </div>
  );
}

function TableShape({ t, selected, onClick }) {
  // Each table is a <g> wrapping the rect + labels so the entire
  // square is one click target (not just the rect edge). The group
  // gets focus styles via outline so keyboard users can reach it.
  const x = (Number(t.x) || 0) * UNIT + PADDING;
  const y = (Number(t.y) || 0) * UNIT + PADDING;
  const w = Math.max(1, Number(t.w) || 1) * UNIT;
  const h = Math.max(1, Number(t.h) || 1) * UNIT;
  const fill = STATUS_FILL[t.status] || STATUS_FILL.open;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return (
    <g
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Table ${t.id}, ${STATUS_LABEL[t.status] || t.status}, ${t.capacity} seats`}
      style={{ cursor: 'pointer', outline: selected ? '2px solid #111' : 'none' }}
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6}
        ry={6}
        fill={fill}
        stroke={selected ? '#111' : 'rgba(0,0,0,0.25)'}
        strokeWidth={selected ? 2 : 1}
      />
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fontSize={Math.max(14, Math.min(w, h) / 4)}
        fontWeight={700}
        fill="#fff"
        style={{ pointerEvents: 'none' }}
      >
        {t.id}
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        fontSize={11}
        fill="#fff"
        style={{ pointerEvents: 'none', opacity: 0.95 }}
      >
        ppl {t.capacity}
      </text>
      <text
        x={cx}
        y={cy + 28}
        textAnchor="middle"
        fontSize={10}
        fill="#fff"
        style={{ pointerEvents: 'none', opacity: 0.85 }}
      >
        {STATUS_LABEL[t.status] || t.status}
      </text>
    </g>
  );
}

function ActionPanel({
  table,
  reservations,
  busyId,
  cookId,
  onClose,
  onChangeStatus,
  onSeatReservation,
}) {
  // Only show reservations not yet assigned to a table — the host
  // is by definition picking the table here. If a reservation
  // already has a table_id (booked but pre-assigned), it can still
  // be re-seated to this table; we show all booked rows for today.
  const unseated = reservations || [];
  const busy = busyId !== null;
  const tone = STATUS_FILL[table.status] || '#888';
  const isClosed = table.status === 'closed';

  return (
    <aside
      aria-label={`Actions for ${table.id}`}
      className="card"
      style={{
        flex: '0 0 280px',
        position: 'sticky',
        top: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 18 }}>{table.id}</strong>
        <button
          type="button"
          className="btn"
          onClick={onClose}
          aria-label="Close action panel"
          style={{ padding: '2px 10px' }}
        >
          ×
        </button>
      </div>
      <div className="meta">
        {table.name !== table.id && <>{table.name} · </>}
        ppl {table.capacity}
      </div>
      <span
        style={{
          alignSelf: 'flex-start',
          padding: '2px 10px',
          borderRadius: 999,
          background: tone,
          color: '#fff',
          fontSize: 12,
        }}
      >
        {STATUS_LABEL[table.status] || table.status}
      </span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Status verbs are gated by current status. The state
            machine: open → seated → dirty → open. Each button only
            fires the natural next transition. */}
        {table.status === 'open' && !isClosed && (
          <>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => onChangeStatus(table.id, 'seated')}
            >
              Mark seated
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => onChangeStatus(table.id, 'dirty')}
            >
              Mark dirty
            </button>
          </>
        )}
        {table.status === 'seated' && (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => onChangeStatus(table.id, 'dirty')}
          >
            Mark dirty
          </button>
        )}
        {table.status === 'dirty' && (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => onChangeStatus(table.id, 'open')}
          >
            Mark open
          </button>
        )}
        {!isClosed ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => onChangeStatus(table.id, 'closed')}
          >
            Close table
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => onChangeStatus(table.id, 'open')}
          >
            Reopen
          </button>
        )}
      </div>

      {table.status === 'open' && unseated.length > 0 && (
        <div>
          <div className="section-head" style={{ marginTop: 4, marginBottom: 6 }}>
            Seat a reservation
          </div>
          {!cookId && (
            <div className="meta" style={{ color: 'var(--red)', marginBottom: 6 }}>
              Set a cook PIN to seat reservations.
            </div>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {unseated.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !cookId}
                  onClick={() => onSeatReservation(r.id, table.id)}
                  style={{ width: '100%', textAlign: 'left' }}
                >
                  <span style={{ fontWeight: 600 }}>{r.party_name}</span>{' '}
                  <span style={{ opacity: 0.7 }}>
                    · {r.party_size} ppl · {formatRowTime(r.reservation_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {table.notes && (
        <div className="meta" style={{ borderTop: '1px solid #eee', paddingTop: 8 }}>
          {table.notes}
        </div>
      )}
    </aside>
  );
}

// "YYYY-MM-DD HH:MM" → "7:00 PM" (12h). Mirrors the formatter in
// ReservationsBoard.jsx so the same row reads identically on both
// pages.
function formatRowTime(at) {
  if (!at) return '';
  const m = /(\d{2}):(\d{2})$/.exec(at);
  if (!m) return '';
  let h = Number(m[1]);
  const mm = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mm} ${ampm}`;
}
