'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import PrepHistoryPanel from './PrepHistoryPanel';
import CoursePanel from './_components/CoursePanel';
import LariAmbient from '../_components/LariAmbient';
import { formatDollars } from '../../lib/formatMoney';
import type { CateringMenuItem } from '../../lib/data';

/* ── types ────────────────────────────────────────────────────── */

/** A catering-menu pick rendered in the right-rail MenuPanel. */
type MenuItem = CateringMenuItem;

/** A BEO event (party) as returned by /api/beo. */
interface BeoEvent {
  id: number;
  title: string;
  event_date: string | null;
  event_time: string | null;
  contact_name: string | null;
  guest_count: number | null;
  notes: string | null;
  tax_rate: number | null;
  service_fee_pct: number | null;
  location_id?: string | null;
}

/** A prep-sheet / invoice line item. Notes columns are nullable free-text. */
interface LineItem {
  id: number;
  event_id: number;
  item_name: string;
  category: string | null;
  unit_cost: number;
  quantity: number;
  course_id?: number | null;
  order_time?: string | null;
  prep_notes?: string | null;
  secondary_prep_notes?: string | null;
  order_items_notes?: string | null;
  group_note?: string | null;
}

/** A LineItem decorated with its computed line total (dollars). */
type LineItemWithTotal = LineItem & { line_total: number };

/** A course a line can be bound to (T11). */
interface Course {
  id: number;
  course_label: string;
}

/** Top-level shape of the /api/beo payload. */
interface BeoData {
  events?: BeoEvent[];
  line_items?: LineItem[];
  location_id?: string | null;
}

/** Patch object for partial event/line updates. */
type Patch = Record<string, unknown>;

/* ── formatting helpers ───────────────────────────────────────── */

function roundMoney(n: unknown): number {
  return Math.round(Number(n || 0) * 100) / 100;
}

/* ── main ─────────────────────────────────────────────────────── */

interface BeoBoardProps {
  /** Catering menu rendered in the right-rail picker. */
  initialMenu?: MenuItem[];
}

export default function BeoBoard({ initialMenu = [] }: BeoBoardProps) {
  const [data, setData] = useState<BeoData | null>(null);
  const [menu] = useState<MenuItem[]>(initialMenu);
  const [openEventId, setOpenEventId] = useState<number | null>(null);
  const [err, setErr] = useState('');
  // Client-share link state. shareUrl is set after we fetch the token for
  // the open event; copied flips true for a beat so the operator sees the
  // confirmation. Both reset when openEventId changes.
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  // T11: courses live at BeoBoard so PrepSheetTable + CoursePanel share
  // one source of truth. Refetched on event change and after CoursePanel
  // mutations call back through onCoursesChanged.
  const [courses, setCourses] = useState<Course[]>([]);

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

  const loadCourses = async (eventId: number | null, locationId: string | null | undefined = 'default') => {
    const resolvedLocation = locationId ?? 'default';
    if (!eventId) {
      setCourses([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/beo/courses?event_id=${encodeURIComponent(eventId)}&location=${encodeURIComponent(resolvedLocation)}`,
      );
      if (!res.ok) return;
      const j = await res.json();
      setCourses(Array.isArray(j.courses) ? (j.courses as Course[]) : []);
    } catch {
      // silent — UI will show empty course list
    }
  };

  useEffect(() => {
    const ev = (data?.events || []).find((e) => e.id === openEventId);
    loadCourses(openEventId, ev?.location_id || 'default');
     
  }, [openEventId, data?.events]);

  // Clear the share link when switching events — different event, different
  // token. Operator hits Share again to refresh.
  useEffect(() => {
    setShareUrl('');
    setCopied(false);
  }, [openEventId]);

  const shareEvent = async (id: number) => {
    setErr('');
    try {
      const res = await fetch(`/api/beo/${encodeURIComponent(id)}/share-token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Couldn’t generate share link — try again.');
        return;
      }
      const j = await res.json();
      // share_url may be relative if LARIAT_BASE_URL isn't set on the
      // server. Absolutize against the current origin so what the operator
      // copies is the URL the client will actually open.
      const abs = j.share_url?.startsWith('http')
        ? j.share_url
        : `${window.location.origin}${j.share_url || `/beo/share/${j.token}`}`;
      setShareUrl(abs);
      setCopied(false);
    } catch {
      setErr('Network error — please try again.');
    }
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable on insecure contexts (e.g. raw IP
      // over HTTP on a kitchen iPad). Fall back to a select-text prompt.
      setErr('Couldn’t copy automatically — select and copy the link below.');
    }
  };

  const post = async (body: Record<string, unknown>) => {
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

  const addParty = async (e: FormEvent<HTMLFormElement>) => {
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

  const addLine = async (event_id: number, item: MenuItem) => {
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

  const updateLine = async (id: number, patch: Patch) => {
    const ok = await post({ action: 'update_line', id, ...patch });
    if (ok) load();
  };

  const deleteLine = async (id: number) => {
    const ok = await post({ action: 'delete_line', id });
    if (ok) load();
  };

  const updateEvent = async (ev: BeoEvent, patch: Patch) => {
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

  const killParty = async (id: number) => {
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
          <p className="subtitle">Prep-sheet layout — ITEM, PREP, SECONDARY PREP, ORDER ITEMS. Click any row to expand the recipe dropdowns.</p>
        </div>
      </div>

      {/* params omitted (undefined) — LariAmbient treats it as no extra query params.
          Explicit here only because the untyped .jsx infers `params` as required. */}
      <LariAmbient surface="beo" location={data?.location_id} params={undefined} />

      {err && <div className="card border-red mb-20 text-red">{err}</div>}

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
          <>
            <button type="button" className="btn" onClick={() => shareEvent(openEvent.id)}>
              Share with client
            </button>
            <button type="button" className="btn red" onClick={() => killParty(openEvent.id)}>
              Kill party
            </button>
          </>
        )}
      </div>
      {shareUrl && (
        <div className="card mb-20 flex-center-gap">
          <span className="beo-share-label">Send this link to the host:</span>
          <input
            className="input beo-share-input"
            readOnly
            value={shareUrl}
            onFocus={(e) => e.target.select()}
          />
          <button type="button" className="btn" onClick={copyShareUrl}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}

      {/* Add-party form */}
      <details className="beo-add-party">
        <summary>+ New party</summary>
        <form onSubmit={addParty} className="form-row mt-12">
          <div className="field-name">
            <label className="label">Party name</label>
            <input className="input form-field" value={newTitle}
                   onChange={(e)=>setNewTitle(e.target.value)}
                   placeholder="e.g. Bob Clauss" required />
          </div>
          <div className="field-date">
            <label className="label">Date</label>
            <input type="date" className="input form-field" value={newDate}
                   onChange={(e)=>setNewDate(e.target.value)} />
          </div>
          <div className="field-time">
            <label className="label">Time</label>
            <input className="input form-field" value={newTime}
                   onChange={(e)=>setNewTime(e.target.value)}
                   placeholder="5-7pm" />
          </div>
          <div className="field-contact">
            <label className="label">Contact</label>
            <input className="input form-field" value={newContact}
                   onChange={(e)=>setNewContact(e.target.value)}
                   placeholder="point of contact" />
          </div>
          <div className="field-covers">
            <label className="label">Covers</label>
            <input type="number" className="input form-field" value={newGuests}
                   onChange={(e)=>setNewGuests(e.target.value)} />
          </div>
          <div className="field-notes">
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
          {/* ───── LEFT: prep sheet ───── */}
          <div className="beo-invoice">
            <EventHeader event={openEvent} onSave={(patch) => updateEvent(openEvent, patch)} />

            <PrepSheetTable
              items={lineItems}
              onUpdate={updateLine}
              onDelete={deleteLine}
              event={openEvent}
              onEventSave={(patch) => updateEvent(openEvent, patch)}
              courses={courses}
            />
          </div>

          {/* ───── RIGHT: stacked menu picker + courses + past-prep reference ───── */}
          <div className="beo-rail">
            <MenuPanel menu={menu} onPick={(item) => addLine(openEvent.id, item)} />
            {/* CoursePanel is an untyped (.jsx, @ts-nocheck) component whose
                `lines` default infers as never[]; cast at the boundary. */}
            <CoursePanel
              event={openEvent}
              lines={lineItems as never}
              courses={courses}
              onCoursesChanged={() => loadCourses(openEventId, openEvent?.location_id)}
            />
            <PrepHistoryPanel
              itemNames={lineItems.map((l) => l.item_name)}
              location={openEvent.location_id}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Event header (title / date / time / contact / guests / notes) ─ */

interface EventHeaderProps {
  event: BeoEvent;
  onSave: (_patch: Patch) => void;
}

function EventHeader({ event, onSave }: EventHeaderProps) {
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

  const commit = (patch: Patch) => onSave(patch);

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

/* ── Prep-sheet table — mirrors archive BEO/BID SHEET xlsx format ─
   Columns:  GROUP note · ITEM (green) · PREP (yellow) · SECONDARY PREP (red) · ORDER ITEMS (salmon) · TIME · Cost · Qty · Total
   Rows group by shared category (the "these items use the same toppings…"
   merged-A-column note from the xlsx).  Each row is expandable for recipe
   dropdowns at ITEM / PREP / SECONDARY-PREP level.
─────────────────────────────────────────────────────────────── */

interface PrepSheetTableProps {
  items: LineItem[];
  onUpdate: (_id: number, _patch: Patch) => void;
  onDelete: (_id: number) => void;
  event: BeoEvent;
  onEventSave: (_patch: Patch) => void;
  courses?: Course[];
}

function PrepSheetTable({ items, onUpdate, onDelete, event, onEventSave, courses = [] }: PrepSheetTableProps) {
  const rows: LineItemWithTotal[] = items.map((it) => ({ ...it, line_total: roundMoney(it.unit_cost * it.quantity) }));
  const subtotal = rows.reduce((s, r) => s + r.line_total, 0);
  const taxRate = Number(event.tax_rate || 0);
  const feePct = Number(event.service_fee_pct || 0);

  // Local inputs hold the raw <input> value (string) while editing, falling
  // back to the numeric rate; committed as Number() on blur.
  const [localTax, setLocalTax] = useState<number | string>(taxRate);
  const [localFee, setLocalFee] = useState<number | string>(feePct);

  useEffect(() => {
    setLocalTax(taxRate);
  }, [event.id, taxRate]);

  useEffect(() => {
    setLocalFee(feePct);
  }, [event.id, feePct]);

  const tax = roundMoney(subtotal * taxRate);
  const fee = roundMoney(subtotal * (feePct / 100));
  const total = roundMoney(subtotal + tax + fee);

  // Group consecutive rows that share a category — the `group_note` on the
  // first row of a run spans the whole run (merged-A-column behavior).
  const groups: { category: string; rows: LineItemWithTotal[] }[] = [];
  for (const r of rows) {
    const cat = r.category || '';
    const last = groups[groups.length - 1];
    if (last && last.category === cat) last.rows.push(r);
    else groups.push({ category: cat, rows: [r] });
  }

  return (
    <div className="beo-prep-sheet">
      <table className="beo-prep-table">
        <colgroup>
          <col className="beo-col-group" />
          <col className="beo-col-item" />
          <col className="beo-col-prep" />
          <col className="beo-col-sec" />
          <col className="beo-col-order" />
          <col className="beo-col-course" />
          <col className="beo-col-time" />
          <col className="beo-col-cost" />
          <col className="beo-col-qty" />
          <col className="beo-col-total" />
          <col className="beo-col-kill" />
        </colgroup>
        <thead>
          <tr className="beo-prep-header">
            <th className="beo-h-group">GROUP NOTE</th>
            <th className="beo-h-item">ITEM</th>
            <th className="beo-h-prep">PREP</th>
            <th className="beo-h-sec">SECONDARY PREP</th>
            <th className="beo-h-order">ORDER ITEMS</th>
            <th className="beo-h-course">COURSE</th>
            <th className="beo-h-time">TIME</th>
            <th className="beo-h-cost num">COST</th>
            <th className="beo-h-qty num">QTY</th>
            <th className="beo-h-total num">TOTAL</th>
            <th aria-label="row actions" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="beo-empty-row">
              <td colSpan={11}>No items yet. Pick from the menu on the right →</td>
            </tr>
          )}
          {groups.map((g) =>
            g.rows.map((r, ri) => (
              <PrepSheetRow
                key={r.id}
                row={r}
                first={ri === 0}
                span={g.rows.length}
                onUpdate={onUpdate}
                onDelete={onDelete}
                courses={courses}
              />
            )),
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={9} className="beo-total-label">Sub total</td>
            <td className="num">{formatDollars(subtotal ?? 0, { nullDisplay: '$0.00' })}</td>
            <td />
          </tr>
          <tr>
            <td colSpan={9} className="beo-total-label">
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
            <td className="num">{formatDollars(tax ?? 0, { nullDisplay: '$0.00' })}</td>
            <td />
          </tr>
          <tr>
            <td colSpan={9} className="beo-total-label">
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
            <td className="num">{formatDollars(fee ?? 0, { nullDisplay: '$0.00' })}</td>
            <td />
          </tr>
          <tr className="beo-grand-total">
            <td colSpan={9} className="beo-total-label">Total</td>
            <td className="num">{formatDollars(total ?? 0, { nullDisplay: '$0.00' })}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* Single prep-sheet row — each cell color-coded, each level expandable.
   The recipe "dropdowns" noted in the archive sheet ride as <details> blocks
   that open inline so a chef can drill ITEM → PREP → SECONDARY PREP. */
interface PrepSheetRowProps {
  row: LineItemWithTotal;
  first: boolean;
  span: number;
  onUpdate: (_id: number, _patch: Patch) => void;
  onDelete: (_id: number) => void;
  courses?: Course[];
}

function PrepSheetRow({ row, first, span, onUpdate, onDelete, courses = [] }: PrepSheetRowProps) {
  const [name, setName]   = useState(row.item_name);
  // cost/qty hold raw <input> strings while editing; committed as Number() on blur.
  const [cost, setCost]   = useState<number | string>(row.unit_cost);
  const [qty,  setQty]    = useState<number | string>(row.quantity);
  const [time, setTime]   = useState(row.order_time || '');
  const [prep, setPrep]   = useState(row.prep_notes || '');
  const [sec,  setSec]    = useState(row.secondary_prep_notes || '');
  const [ord,  setOrd]    = useState(row.order_items_notes || '');
  const [grp,  setGrp]    = useState(row.group_note || '');

  useEffect(() => {
    setName(row.item_name);
    setCost(row.unit_cost);
    setQty(row.quantity);
    setTime(row.order_time || '');
    setPrep(row.prep_notes || '');
    setSec(row.secondary_prep_notes || '');
    setOrd(row.order_items_notes || '');
    setGrp(row.group_note || '');
  }, [row.id, row.item_name, row.unit_cost, row.quantity,
      row.order_time, row.prep_notes, row.secondary_prep_notes,
      row.order_items_notes, row.group_note]);

  const pushIf = (patch: Patch) => {
    const keys = Object.keys(patch);
    const rowRecord = row as unknown as Record<string, unknown>;
    for (const k of keys) {
      if ((rowRecord[k] ?? '') !== (patch[k] ?? '')) {
        onUpdate(row.id, patch);
        return;
      }
    }
  };

  return (
    <tr className="beo-prep-row">
      {/* GROUP NOTE — only render on the first row of a category run;
          spans all rows in that run (mirrors the xlsx A-column merge). */}
      {first ? (
        <td className="beo-c-group" rowSpan={span}>
          <textarea
            className="beo-cell beo-cell-group"
            rows={2}
            value={grp}
            onChange={(e) => setGrp(e.target.value)}
            onBlur={() => pushIf({ group_note: grp || null })}
            placeholder="shared toppings / setup / allergens for this group"
          />
        </td>
      ) : null}

      {/* ITEM — green column */}
      <td className="beo-c-item">
        <details className="beo-disclosure">
          <summary>
            <input
              className="beo-cell beo-cell-item"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => name !== row.item_name && onUpdate(row.id, { item_name: name })}
            />
          </summary>
          <div className="beo-drop">
            <span className="beo-drop-label">Ingredients for {row.item_name || 'this item'}</span>
            <div className="beo-drop-hint">
              Fills the ORDER ITEMS column — pulls from the recipe dropdown
              when the menu item is linked.
            </div>
          </div>
        </details>
      </td>

      {/* PREP — yellow column */}
      <td className="beo-c-prep">
        <details className="beo-disclosure">
          <summary>
            <input
              className="beo-cell beo-cell-prep"
              value={prep}
              onChange={(e) => setPrep(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => pushIf({ prep_notes: prep || null })}
              placeholder="prep (e.g. Pico de Gallo, mexi slaw)"
            />
          </summary>
          <div className="beo-drop">
            <span className="beo-drop-label">Items needed for this prep</span>
            <div className="beo-drop-hint">pulls from the recipe dropdown when the menu item is linked</div>
          </div>
        </details>
      </td>

      {/* SECONDARY PREP — red column */}
      <td className="beo-c-sec">
        <details className="beo-disclosure">
          <summary>
            <input
              className="beo-cell beo-cell-sec"
              value={sec}
              onChange={(e) => setSec(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => pushIf({ secondary_prep_notes: sec || null })}
              placeholder="secondary prep (optional)"
            />
          </summary>
          <div className="beo-drop">
            <span className="beo-drop-label">Items needed for secondary prep</span>
            <div className="beo-drop-hint">nested recipe dropdown — ingredients feed the ORDER ITEMS column</div>
          </div>
        </details>
      </td>

      {/* ORDER ITEMS — salmon column (aggregated purchase list) */}
      <td className="beo-c-order">
        <textarea
          className="beo-cell beo-cell-order"
          rows={2}
          value={ord}
          onChange={(e) => setOrd(e.target.value)}
          onBlur={() => pushIf({ order_items_notes: ord || null })}
          placeholder="ingredients to order (rolls up ITEM + PREP + SECONDARY)"
        />
      </td>

      {/* COURSE — bind this line to a course (T11). null = unbound. */}
      <td className="beo-c-course">
        <select
          className="beo-cell beo-cell-course"
          value={row.course_id ?? ''}
          onChange={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value);
            onUpdate(row.id, { course_id: v });
          }}
          aria-label="course"
        >
          <option value="">—</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.course_label}
            </option>
          ))}
        </select>
      </td>

      {/* TIME — fire/serve time */}
      <td className="beo-c-time">
        <input
          className="beo-cell beo-cell-time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => pushIf({ order_time: time || null })}
          placeholder="5:30pm"
          aria-label="fire / serve time"
        />
      </td>

      {/* Cost / Qty / Total — preserve the invoice side of the sheet */}
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
      <td className="num beo-line-total">{formatDollars(row.line_total ?? 0, { nullDisplay: '$0.00' })}</td>
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

/* ── Right-side expandable menu panel ─────────────────────────── */

interface MenuPanelProps {
  menu: MenuItem[];
  onPick: (_item: MenuItem) => void;
}

function MenuPanel({ menu, onPick }: MenuPanelProps) {
  const [filter, setFilter] = useState('');
  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const by = new Map<string, MenuItem[]>();
    for (const it of menu) {
      if (q && !it.name.toLowerCase().includes(q) && !it.category.toLowerCase().includes(q)) continue;
      const bucket = by.get(it.category) ?? [];
      bucket.push(it);
      by.set(it.category, bucket);
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
        <details key={cat} className="beo-menu-group" open>
          <summary className="beo-menu-group-name">{cat}</summary>
          {items.map((it, i) => (
            <button
              type="button"
              key={`${cat}-${i}-${it.name}`}
              className="beo-menu-row"
              onClick={() => onPick(it)}
              title={`Add ${it.name} to prep sheet`}
            >
              <span className="beo-menu-name">{it.name}</span>
              <span className="beo-menu-cost">{formatDollars(it.cost ?? 0, { nullDisplay: '$0.00' })}</span>
              <span className="beo-menu-plus">+</span>
            </button>
          ))}
        </details>
      ))}
    </aside>
  );
}
