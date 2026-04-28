'use client';

import { useEffect, useMemo, useState } from 'react';

/* ── formatting helpers ───────────────────────────────────────── */

const USD = (n) =>
  Number(n || 0).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

/* ── main ─────────────────────────────────────────────────────── */

export default function BeoBoard({ initialMenu = [] }) {
  const [data, setData] = useState(null);
  const [menu] = useState(initialMenu);
  const [openEventId, setOpenEventId] = useState(null);
  const [err, setErr] = useState('');

  // Add-party form state
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newContact, setNewContact] = useState('');
  const [newGuests, setNewGuests] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const load = () =>
    fetch('/api/beo')
      .then((r) => r.json())
      .then((j) => {
        setData(j);
        if (openEventId == null && j.events?.length) setOpenEventId(j.events[0].id);
      })
      .catch(() => setErr('Couldn’t load — refresh the page'));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const post = async (body) => {
    setErr('');
    try {
      const res = await fetch('/api/beo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) setErr('Didn’t save — try again');
      return res.ok;
    } catch {
      setErr('Lost connection — not saved');
      return false;
    }
  };

  const addParty = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const ok = await post({
      action: 'event',
      title: newTitle.trim(),
      event_date: newDate || null,
      event_time: newTime.trim() || null,
      contact_name: newContact.trim() || null,
      guest_count: newGuests ? parseInt(newGuests, 10) : null,
      notes: newNotes.trim() || null,
    });
    if (!ok) return;
    setNewTitle(''); setNewDate(''); setNewTime('');
    setNewContact(''); setNewGuests(''); setNewNotes('');
    load();
  };

  const addLine = async (event_id, item) => {
    const ok = await post({
      action: 'line',
      event_id,
      item_name: item.name,
      category: item.category,
      unit_cost: item.cost,
      quantity: 1,
    });
    if (ok) load();
  };

  const updateLine = async (id, patch) => {
    const ok = await post({ action: 'update_line', id, ...patch });
    if (ok) load();
  };

  const deleteLine = async (id) => {
    const ok = await post({ action: 'delete_line', id });
    if (ok) load();
  };

  const updateEvent = async (ev, patch) => {
    const ok = await post({
      action: 'update_event',
      id: ev.id,
      title: ev.title,
      event_date: ev.event_date,
      event_time: ev.event_time,
      contact_name: ev.contact_name,
      guest_count: ev.guest_count,
      notes: ev.notes,
      tax_rate: ev.tax_rate,
      service_fee_pct: ev.service_fee_pct,
      ...patch,
    });
    if (ok) load();
  };

  const killParty = async (id) => {
    if (!window.confirm('Delete this party and everything under it?')) return;
    const ok = await post({ action: 'delete_event', id });
    if (ok) {
      if (openEventId === id) setOpenEventId(null);
      load();
    }
  };

  const events = data?.events || [];
  const openEvent = events.find((e) => e.id === openEventId) || null;
  const lineItems = (data?.line_items || []).filter((l) => l.event_id === openEventId);

  return (
    <div className="beo-page">
      <div className="flex-between mb-20">
        <div>
          <h1>Parties &amp; BEOs</h1>
          <p className="subtitle">Build the BEO the way you always have — pick from the menu on the right, fill in amounts on the left.</p>
        </div>
      </div>

      {err && <div className="card border-red mb-20" style={{ color: 'var(--red)' }}>{err}</div>}

      {/* Event picker */}
      <div className="beo-event-bar">
        <select
          className="input"
          value={openEventId ?? ''}
          onChange={(e) => setOpenEventId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— Choose a party —</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.event_date || 'no date'} · {ev.title}
              {ev.event_time ? ` (${ev.event_time})` : ''}
            </option>
          ))}
        </select>
        {openEvent && (
          <button type="button" className="btn red" onClick={() => killParty(openEvent.id)}>
            Kill party
          </button>
        )}
      </div>

      {/* Add-party form */}
      <details className="beo-add-party">
        <summary>+ New party</summary>
        <form onSubmit={addParty} className="form-row mt-12">
          <div style={{ flex: '2 1 220px' }}>
            <label className="label">Party name</label>
            <input className="input form-field" value={newTitle}
                   onChange={(e)=>setNewTitle(e.target.value)}
                   placeholder="e.g. Bob Clauss" required />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label className="label">Date</label>
            <input type="date" className="input form-field" value={newDate}
                   onChange={(e)=>setNewDate(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 130px' }}>
            <label className="label">Time</label>
            <input className="input form-field" value={newTime}
                   onChange={(e)=>setNewTime(e.target.value)}
                   placeholder="5-7pm" />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label className="label">Contact</label>
            <input className="input form-field" value={newContact}
                   onChange={(e)=>setNewContact(e.target.value)}
                   placeholder="point of contact" />
          </div>
          <div style={{ flex: '0 1 100px' }}>
            <label className="label">Covers</label>
            <input type="number" className="input form-field" value={newGuests}
                   onChange={(e)=>setNewGuests(e.target.value)} />
          </div>
          <div style={{ flex: '3 1 100%' }}>
            <label className="label">Notes</label>
            <textarea className="input form-field" rows={2} value={newNotes}
                      onChange={(e)=>setNewNotes(e.target.value)}
                      placeholder="Allergies, dietary restrictions, setup requests, anything useful" />
          </div>
          <button type="submit" className="btn primary">Add party</button>
        </form>
      </details>

      {/* No party selected */}
      {!openEvent && (
        <div className="empty mt-20">Pick or add a party to start building its BEO.</div>
      )}

      {openEvent && (
        <div className="beo-worksheet">
          {/* ───── LEFT: the invoice ───── */}
          <div className="beo-invoice">
            <EventHeader event={openEvent} onSave={(patch) => updateEvent(openEvent, patch)} />

            <LineItemsTable
              items={lineItems}
              onUpdate={updateLine}
              onDelete={deleteLine}
              event={openEvent}
              onEventSave={(patch) => updateEvent(openEvent, patch)}
            />
          </div>

          {/* ───── RIGHT: the menu ───── */}
          <MenuPanel menu={menu} onPick={(item) => addLine(openEvent.id, item)} />
        </div>
      )}
    </div>
  );
}

/* ── Event header (title / date / time / contact / guests / notes) ─ */

function EventHeader({ event, onSave }) {
  const [title, setTitle] = useState(event.title || '');
  const [date, setDate] = useState(event.event_date || '');
  const [time, setTime] = useState(event.event_time || '');
  const [contact, setContact] = useState(event.contact_name || '');
  const [guests, setGuests] = useState(event.guest_count ?? '');
  const [notes, setNotes] = useState(event.notes || '');

  useEffect(() => {
    setTitle(event.title || '');
    setDate(event.event_date || '');
    setTime(event.event_time || '');
    setContact(event.contact_name || '');
    setGuests(event.guest_count ?? '');
    setNotes(event.notes || '');
  }, [event.id, event.title, event.event_date, event.event_time,
      event.contact_name, event.guest_count, event.notes]);

  const commit = (patch) => onSave(patch);

  return (
    <div className="beo-header">
      <input
        className="beo-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title !== event.title && commit({ title })}
        placeholder="Party name"
      />
      <div className="beo-header-grid">
        <label>
          <span className="label">Date</span>
          <input
            type="date"
            className="input form-field"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onBlur={() => date !== (event.event_date || '') && commit({ event_date: date || null })}
          />
        </label>
        <label>
          <span className="label">Time</span>
          <input
            className="input form-field"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            onBlur={() => time !== (event.event_time || '') && commit({ event_time: time || null })}
            placeholder="5-7pm"
          />
        </label>
        <label>
          <span className="label">Contact</span>
          <input
            className="input form-field"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            onBlur={() => contact !== (event.contact_name || '') && commit({ contact_name: contact || null })}
            placeholder="point of contact"
          />
        </label>
        <label>
          <span className="label">Covers</span>
          <input
            type="number"
            className="input form-field"
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
            onBlur={() => {
              const n = guests === '' ? null : Number(guests);
              if ((event.guest_count ?? null) !== n) commit({ guest_count: n });
            }}
          />
        </label>
      </div>
      <label className="mt-12">
        <span className="label">Notes</span>
        <textarea
          rows={2}
          className="input form-field"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (event.notes || '') && commit({ notes: notes || null })}
          placeholder="Allergies, dietary restrictions, setup requests"
        />
      </label>
    </div>
  );
}

/* ── Line items table (the invoice body) ─ */

function LineItemsTable({ items, onUpdate, onDelete, event, onEventSave }) {
  const rows = items.map((it) => ({ ...it, line_total: roundMoney(it.unit_cost * it.quantity) }));
  const subtotal = rows.reduce((s, r) => s + r.line_total, 0);
  const taxRate = Number(event.tax_rate || 0);
  const feePct = Number(event.service_fee_pct || 0);

  const [localTax, setLocalTax] = useState(taxRate);
  const [localFee, setLocalFee] = useState(feePct);

  useEffect(() => {
    setLocalTax(taxRate);
  }, [event.id, taxRate]);

  useEffect(() => {
    setLocalFee(feePct);
  }, [event.id, feePct]);

  const tax = roundMoney(subtotal * taxRate);
  const fee = roundMoney(subtotal * (feePct / 100));
  const total = roundMoney(subtotal + tax + fee);

  return (
    <div className="beo-invoice-table">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Cost</th>
            <th className="num">Amount</th>
            <th className="num">Total</th>
            <th aria-label="row actions" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="beo-empty-row">
              <td colSpan={5}>No items yet. Pick from the menu on the right →</td>
            </tr>
          )}
          {rows.map((r) => (
            <LineRow
              key={r.id}
              row={r}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="beo-total-label">Sub total</td>
            <td className="num">{USD(subtotal)}</td>
            <td />
          </tr>
          <tr>
            <td colSpan={3} className="beo-total-label">
              <span>Tax</span>
              <input
                type="number"
                step="0.0001"
                className="beo-small-input"
                value={localTax}
                onChange={(e) => setLocalTax(e.target.value)}
                onBlur={() => {
                  const v = Number(localTax);
                  if (Number.isFinite(v) && v !== taxRate) onEventSave({ tax_rate: v });
                }}
                aria-label="tax rate"
              />
              <span className="beo-muted">rate</span>
            </td>
            <td className="num">{USD(tax)}</td>
            <td />
          </tr>
          <tr>
            <td colSpan={3} className="beo-total-label">
              <span>Service fee</span>
              <input
                type="number"
                step="0.1"
                className="beo-small-input"
                value={localFee}
                onChange={(e) => setLocalFee(e.target.value)}
                onBlur={() => {
                  const v = Number(localFee);
                  if (Number.isFinite(v) && v !== feePct) onEventSave({ service_fee_pct: v });
                }}
                aria-label="service fee %"
              />
              <span className="beo-muted">%</span>
            </td>
            <td className="num">{USD(fee)}</td>
            <td />
          </tr>
          <tr className="beo-grand-total">
            <td colSpan={3} className="beo-total-label">Total</td>
            <td className="num">{USD(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function LineRow({ row, onUpdate, onDelete }) {
  const [name, setName] = useState(row.item_name);
  const [cost, setCost] = useState(row.unit_cost);
  const [qty, setQty] = useState(row.quantity);

  useEffect(() => {
    setName(row.item_name);
    setCost(row.unit_cost);
    setQty(row.quantity);
  }, [row.id, row.item_name, row.unit_cost, row.quantity]);

  return (
    <tr>
      <td>
        <input
          className="beo-cell beo-cell-item"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== row.item_name && onUpdate(row.id, { item_name: name })}
        />
      </td>
      <td className="num">
        <input
          type="number"
          step="0.01"
          className="beo-cell beo-cell-num"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          onBlur={() => {
            const v = Number(cost);
            if (Number.isFinite(v) && v !== row.unit_cost) onUpdate(row.id, { unit_cost: v });
          }}
        />
      </td>
      <td className="num">
        <input
          type="number"
          step="1"
          className="beo-cell beo-cell-num"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onBlur={() => {
            const v = Number(qty);
            if (Number.isFinite(v) && v !== row.quantity) onUpdate(row.id, { quantity: v });
          }}
        />
      </td>
      <td className="num beo-line-total">{USD(row.line_total)}</td>
      <td>
        <button
          type="button"
          className="beo-line-delete"
          onClick={() => onDelete(row.id)}
          aria-label="remove line"
          title="Remove line"
        >
          ×
        </button>
      </td>
    </tr>
  );
}

/* ── Right-side menu panel ─ */

function MenuPanel({ menu, onPick }) {
  const [filter, setFilter] = useState('');
  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const by = new Map();
    for (const it of menu) {
      if (q && !it.name.toLowerCase().includes(q) && !it.category.toLowerCase().includes(q)) continue;
      if (!by.has(it.category)) by.set(it.category, []);
      by.get(it.category).push(it);
    }
    return Array.from(by.entries());
  }, [menu, filter]);

  return (
    <aside className="beo-menu">
      <div className="beo-menu-head">
        <h2 className="m-0">Catering menu</h2>
        <input
          className="input"
          placeholder="Filter menu…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {grouped.length === 0 && (
        <div className="beo-empty-row">No matches.</div>
      )}
      {grouped.map(([cat, items]) => (
        <div key={cat} className="beo-menu-group">
          <div className="beo-menu-group-name">{cat}</div>
          {items.map((it, i) => (
            <button
              type="button"
              key={`${cat}-${i}-${it.name}`}
              className="beo-menu-row"
              onClick={() => onPick(it)}
              title={`Add ${it.name} to invoice`}
            >
              <span className="beo-menu-name">{it.name}</span>
              <span className="beo-menu-cost">{USD(it.cost)}</span>
              <span className="beo-menu-plus">+</span>
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}
