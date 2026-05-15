'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

function fmtTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function CountSheet({ head, parRows, orphanLines, locationId = 'default' }) {
  const router = useRouter();
  const closed = !!head.closed_at;
  const [cookId, setCookId] = useState('');
  const [filter, setFilter] = useState('');
  const [savingKey, setSavingKey] = useState(null);
  const [errKey, setErrKey] = useState(null);

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  const groups = useMemo(() => {
    const buckets = new Map();
    for (const row of parRows) {
      const cat = row.category || 'Other';
      if (!buckets.has(cat)) buckets.set(cat, []);
      buckets.get(cat).push(row);
    }
    return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [parRows]);

  const f = filter.trim().toLowerCase();

  const saveLine = async (row, fields) => {
    const key = row.line_id || `par-${row.ingredient}-${row.sku || ''}`;
    setSavingKey(key);
    setErrKey(null);
    try {
      const res = await fetch(
        `/api/inventory/counts/${head.id}/lines`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            location_id: locationId,
            cook_id: cookId,
            vendor: row.vendor || null,
            ingredient: row.ingredient,
            sku: row.sku || null,
            par_qty: row.par_qty ?? null,
            par_unit: row.par_unit ?? null,
            ...fields,
          }),
        },
      );
      if (!res.ok) {
        setErrKey(key);
        setSavingKey(null);
        return;
      }
      setSavingKey(null);
      router.refresh();
    } catch {
      setErrKey(key);
      setSavingKey(null);
    }
  };

  const closeCount = async () => {
    if (!window.confirm('Close this count? You can reopen it if needed.')) return;
    try {
      const res = await fetch(`/api/inventory/counts/${head.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ close: true, cook_id: cookId, location_id: locationId }),
      });
      if (res.ok) router.refresh();
    } catch { /* swallow */ }
  };

  const reopenCount = async () => {
    try {
      const res = await fetch(`/api/inventory/counts/${head.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reopen: true, cook_id: cookId, location_id: locationId }),
      });
      if (res.ok) router.refresh();
    } catch { /* swallow */ }
  };

  return (
    <div>
      <h1>{head.label || `Count ${head.count_date}`}</h1>
      <p className="subtitle">
        {closed ? 'Closed.' : 'Walk the line. Type what you have on hand.'}
      </p>

      <div
        className="card form-row"
        style={{ marginBottom: 16, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find an item"
          className="input form-field"
          style={{ flex: '1 1 200px', maxWidth: 320 }}
          aria-label="Filter items"
        />
        <div style={{ display: 'flex', gap: 8 }}>
          {closed ? (
            <button type="button" className="btn" onClick={reopenCount}>Reopen</button>
          ) : (
            <button type="button" className="btn primary" onClick={closeCount}>
              Close count
            </button>
          )}
        </div>
      </div>

      {groups.map(([cat, rows]) => {
        const visible = f
          ? rows.filter(r =>
              (r.ingredient || '').toLowerCase().includes(f) ||
              (r.sku || '').toLowerCase().includes(f),
            )
          : rows;
        if (visible.length === 0) return null;
        return (
          <section key={cat} style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, margin: '12px 0 8px', opacity: 0.85 }}>{cat}</h2>
            <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {visible.map(row => (
                <CountRow
                  key={`${row.ingredient}|${row.sku || ''}`}
                  row={row}
                  closed={closed}
                  saving={savingKey === (row.line_id || `par-${row.ingredient}-${row.sku || ''}`)}
                  err={errKey === (row.line_id || `par-${row.ingredient}-${row.sku || ''}`)}
                  onSave={saveLine}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {orphanLines.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, margin: '12px 0 8px', opacity: 0.85 }}>Off-list</h2>
          <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {orphanLines.map(row => (
              <li key={row.line_id} className="check-row">
                <div>
                  <div className="check-name">{row.ingredient}</div>
                  <div className="meta">
                    {row.on_hand_qty != null && <>{row.on_hand_qty} {row.unit || ''} · </>}
                    {row.counted_by && <>{row.counted_by} · </>}
                    <time dateTime={row.counted_at}>{fmtTime(row.counted_at)}</time>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!closed && <FreeAddRow countId={head.id} cookId={cookId} locationId={locationId} />}
    </div>
  );
}

function CountRow({ row, closed, saving, err, onSave }) {
  const [qty, setQty] = useState(row.on_hand_qty != null ? String(row.on_hand_qty) : '');
  const [unit, setUnit] = useState(row.unit || row.par_unit || 'pack');
  const [note, setNote] = useState(row.note || '');

  useEffect(() => {
    setQty(row.on_hand_qty != null ? String(row.on_hand_qty) : '');
    setUnit(row.unit || row.par_unit || 'pack');
    setNote(row.note || '');
  }, [row.on_hand_qty, row.unit, row.par_unit, row.note]);

  const submit = (e) => {
    e.preventDefault();
    if (closed) return;
    onSave(row, {
      on_hand_qty: qty === '' ? null : Number(qty),
      unit,
      note: note || null,
    });
  };

  const lowOnHand =
    row.par_qty != null && qty !== '' && Number.isFinite(Number(qty)) && Number(qty) < row.par_qty;

  return (
    <li className="check-row">
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', width: '100%', flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 220px' }}>
          <div className="check-name">{row.ingredient}</div>
          <div className="meta">
            {row.vendor && <>{row.vendor} · </>}
            {row.par_qty != null && <>par {row.par_qty} {row.par_unit || ''} · </>}
            {row.pack_size && <>pack {row.pack_size} {row.pack_unit || ''}</>}
            {row.counted_by && <> · last {row.counted_by} {fmtTime(row.counted_at)}</>}
          </div>
        </div>
        <div style={{ flex: '0 1 110px' }}>
          <label className="label" htmlFor={`qty-${row.ingredient}-${row.sku || ''}`}>On hand</label>
          <input
            id={`qty-${row.ingredient}-${row.sku || ''}`}
            type="number"
            inputMode="decimal"
            step="any"
            value={qty}
            disabled={closed}
            onChange={(e) => setQty(e.target.value)}
            className="input form-field"
            style={lowOnHand ? { borderColor: 'var(--orange, #c0531c)' } : undefined}
            aria-label={`On-hand quantity for ${row.ingredient}`}
          />
        </div>
        <div style={{ flex: '0 1 90px' }}>
          <label className="label" htmlFor={`unit-${row.ingredient}-${row.sku || ''}`}>Unit</label>
          <input
            id={`unit-${row.ingredient}-${row.sku || ''}`}
            type="text"
            value={unit}
            disabled={closed}
            onChange={(e) => setUnit(e.target.value)}
            className="input form-field"
            placeholder="pack"
          />
        </div>
        <div style={{ flex: '1 1 160px' }}>
          <label className="label" htmlFor={`note-${row.ingredient}-${row.sku || ''}`}>Note</label>
          <input
            id={`note-${row.ingredient}-${row.sku || ''}`}
            type="text"
            value={note}
            disabled={closed}
            onChange={(e) => setNote(e.target.value)}
            className="input form-field"
            placeholder="optional"
            maxLength={500}
          />
        </div>
        <button
          type="submit"
          className="btn primary"
          disabled={closed || saving}
        >
          {saving ? 'Saving…' : row.line_id ? 'Update' : 'Save'}
        </button>
        {err && (
          <div role="alert" aria-live="assertive" style={{ color: 'var(--red)', flexBasis: '100%' }}>
            Did not save — try again.
          </div>
        )}
      </form>
    </li>
  );
}

function FreeAddRow({ countId, cookId, locationId }) {
  const router = useRouter();
  const [ingredient, setIngredient] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!ingredient.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`/api/inventory/counts/${countId}/lines`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          location_id: locationId,
          cook_id: cookId,
          ingredient: ingredient.trim(),
          on_hand_qty: qty === '' ? null : Number(qty),
          unit: unit || null,
        }),
      });
      if (!res.ok) {
        setErr('Did not save — try again.');
        setBusy(false);
        return;
      }
      setIngredient('');
      setQty('');
      setUnit('');
      setBusy(false);
      router.refresh();
    } catch {
      setErr('Lost connection — not saved.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card form-row" aria-busy={busy} style={{ marginTop: 16 }}>
      <div style={{ flex: '2 1 220px' }}>
        <label className="label" htmlFor="free-ing">Off-list item</label>
        <input
          id="free-ing"
          type="text"
          value={ingredient}
          onChange={(e) => setIngredient(e.target.value)}
          placeholder="Item not on the par list"
          className="input form-field"
        />
      </div>
      <div style={{ flex: '0 1 110px' }}>
        <label className="label" htmlFor="free-qty">On hand</label>
        <input
          id="free-qty"
          type="number"
          inputMode="decimal"
          step="any"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="input form-field"
        />
      </div>
      <div style={{ flex: '0 1 90px' }}>
        <label className="label" htmlFor="free-unit">Unit</label>
        <input
          id="free-unit"
          type="text"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="input form-field"
          placeholder="ea, lb, qt"
        />
      </div>
      <button type="submit" className="btn" disabled={busy || !ingredient.trim()}>
        {busy ? 'Saving…' : 'Add'}
      </button>
      {err && (
        <div role="alert" aria-live="assertive" style={{ color: 'var(--red)', flexBasis: '100%' }}>
          {err}
        </div>
      )}
    </form>
  );
}
