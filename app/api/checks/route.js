import { getDb } from '../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../lib/location';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

export async function POST(req) {
  try {
    const body = await req.json();
    const shift_date = clip(body.shift_date, 32);
    const station_id = clip(body.station_id, 64);
    const item = clip(body.item, 300);
    if (!shift_date || !station_id || !item) {
      return Response.json({ error: 'missing fields' }, { status: 400 });
    }
    const loc = locationFromBody(body);
    const db = getDb();
    const status = body.status === null ? null : (['pass', 'fail', 'na'].includes(body.status) ? body.status : 'na');

    // F15 / FDA §3-301.11: bare-hand-contact-with-RTE attestation.
    // Tri-state: true → 1, false → 0, anything else (undefined/null) → null.
    // NULL means "this line-check item doesn't touch RTE food" (e.g. a
    // raw-only prep task or a cleanup task); the row stays out of the
    // attestation accounting. The UI opts items in by sending the field.
    let gloveAttested = null;
    if (body.glove_change_attested === true) gloveAttested = 1;
    else if (body.glove_change_attested === false) gloveAttested = 0;

    const stmt = db.prepare(`
      INSERT INTO line_check_entries
        (shift_date, station_id, item, status, par, have, need, note, cook_id, glove_change_attested, location_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      shift_date,
      station_id,
      item,
      status,
      clip(body.par, 64),
      clip(body.have, 64),
      clip(body.need, 64),
      clip(body.note, 1000),
      clip(body.cook_id, 64),
      gloveAttested,
      loc,
    );
    return Response.json({ ok: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error('POST /api/checks failed:', err);
    return Response.json({ error: 'Failed to save check entry' }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date');
    const station = url.searchParams.get('station');
    const loc = locationFromRequest(req);
    const db = getDb();
    let q = 'SELECT * FROM line_check_entries WHERE location_id = ?';
    const args = [loc];
    if (date) {
      q += ' AND shift_date = ?';
      args.push(date);
    }
    if (station) {
      q += ' AND station_id = ?';
      args.push(station);
    }
    q += ' ORDER BY id DESC LIMIT 500';
    return Response.json(db.prepare(q).all(...args));
  } catch (err) {
    console.error('GET /api/checks failed:', err);
    return Response.json({ error: 'Failed to load checks' }, { status: 500 });
  }
}
