'use client';

import { useEffect, useState } from 'react';

export default function BeoBoard() {
  const [data, setData] = useState(null);
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [guests, setGuests] = useState('');
  const [notes, setNotes] = useState('');
  const [prepTask, setPrepTask] = useState({});
  const [err, setErr] = useState('');

  const load = () => {
    fetch('/api/beo')
      .then((r) => r.json())
      .then(setData)
      .catch(() => setErr('Couldn\u2019t load \u2014 refresh the page'));
  };

  useEffect(() => {
    load();
  }, []);

  const addEvent = async (e) => {
    e.preventDefault();
    setErr('');
    const res = await fetch('/api/beo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'event',
        title: title || 'Untitled event',
        event_date: eventDate || null,
        guest_count: guests ? parseInt(guests, 10) : null,
        notes: notes || null,
      }),
    });
    if (!res.ok) {
      setErr('Didn\u2019t save \u2014 try again');
      return;
    }
    setTitle('');
    setEventDate('');
    setGuests('');
    setNotes('');
    load();
  };

  const addPrep = async (eventId) => {
    const task = prepTask[eventId]?.trim();
    if (!task) return;
    setErr('');
    try {
      const res = await fetch('/api/beo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'prep', event_id: eventId, task }),
      });
      if (!res.ok) {
        setErr('Didn\u2019t save \u2014 try again');
        return;
      }
    } catch {
      setErr('Lost connection \u2014 not saved');
      return;
    }
    setPrepTask((p) => ({ ...p, [eventId]: '' }));
    load();
  };

  const togglePrep = async (id, done) => {
    setErr('');
    try {
      const res = await fetch('/api/beo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'prep_done', id, done: !done }),
      });
      if (!res.ok) {
        setErr('Didn\u2019t save \u2014 try again');
        return;
      }
    } catch {
      setErr('Lost connection \u2014 not saved');
      return;
    }
    load();
  };

  const removeEvent = async (id) => {
    if (!window.confirm('Delete this event and its prep list?')) return;
    setErr('');
    try {
      const res = await fetch('/api/beo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete_event', id }),
      });
      if (!res.ok) {
        setErr('Couldn\u2019t delete \u2014 try again');
        return;
      }
    } catch {
      setErr('Lost connection \u2014 not saved');
      return;
    }
    load();
  };

  const tasksByEvent = {};
  for (const t of data?.prep_tasks || []) {
    tasksByEvent[t.event_id] = tasksByEvent[t.event_id] || [];
    tasksByEvent[t.event_id].push(t);
  }

  return (
    <div>
      <h1>Events &amp; Prep</h1>
      <p className="subtitle">Upcoming events and what needs to get prepped.</p>

      {err && <div className="card"><span style={{ color: 'var(--red)' }}>{err}</span></div>}

      <form onSubmit={addEvent} className="card">
        <h2 className="m-0 mb-12">New Party</h2>
        <div className="stack max-w-480">
          <input placeholder="Party Name" value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
          <input type="date" placeholder="Date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="input" />
          <input placeholder="Covers" value={guests} onChange={(e) => setGuests(e.target.value)} className="input" />
          <textarea placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input" />
          <button type="submit" className="btn">Add Party</button>
        </div>
      </form>

      <div className="stack">
        {(data?.events || []).map((ev) => (
          <div key={ev.id} className="card">
            <div className="flex-between">
              <div>
                <div className="card-title">{ev.title}</div>
                <div className="card-subtitle">
                  {ev.event_date || '—'} · {ev.guest_count != null ? `${ev.guest_count} covers` : 'Covers TBD'}
                </div>
                {ev.notes && <p className="mt-8">{ev.notes}</p>}
              </div>
              <button type="button" className="btn red" onClick={() => removeEvent(ev.id)}>
                Kill Party
              </button>
            </div>
            <div className="mt-16">
              <div className="section-head-sm">Prep tasks</div>
              <ul className="list-none p-0 m-0">
                {(tasksByEvent[ev.id] || []).map((t) => (
                  <li 
                    key={t.id} 
                    className="mb-8"
                    onClick={() => togglePrep(t.id, t.done)}
                    style={{
                      padding: '16px 20px',
                      background: 'var(--panel-2)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '18px',
                      transition: 'transform 0.1s',
                      display: 'block'
                    }}
                    onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.97)'}
                    onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <span style={{ textDecoration: t.done ? 'line-through' : 'none', opacity: t.done ? 0.4 : 1, fontWeight: t.done ? 400 : 600 }}>
                      {t.done ? '✓ ' : ''}{t.task}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex-center-gap mt-8">
                <input
                  placeholder="Add prep task"
                  value={prepTask[ev.id] || ''}
                  onChange={(e) => setPrepTask((p) => ({ ...p, [ev.id]: e.target.value }))}
                  className="input flex-1 m-0"
                />
                <button type="button" className="btn" onClick={() => addPrep(ev.id)}>
                  Add
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {data && !data.events?.length && <p className="text-muted">No events yet.</p>}
    </div>
  );
}
