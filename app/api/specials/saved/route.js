import { getDb } from '../../../../lib/db';
import { uuidv7 } from '../../../../lib/uuid';
import { logAuditAction } from '../../../../lib/auditLog.mjs';
import { locationFromBody, locationFromRequest } from '../../../../lib/location';
import {
  validateName,
  coerceJsonField,
} from '../../../../lib/specialsValidators';

export const dynamic = 'force-dynamic';

const SNIPPET_MAX = 120;

function snippet(s) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= SNIPPET_MAX ? t : t.slice(0, SNIPPET_MAX);
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const nameRes = validateName(body.name);
  if (!nameRes.ok) return Response.json({ error: nameRes.error }, { status: 400 });

  const pantry = typeof body.pantry_text === 'string' ? body.pantry_text : '';
  const prompt = typeof body.prompt_text === 'string' ? body.prompt_text : '';
  const answer = typeof body.ai_answer === 'string' ? body.ai_answer : '';
  const model = typeof body.ai_model === 'string' ? body.ai_model : '';

  if (pantry.trim() === '' && prompt.trim() === '' && answer.trim() === '') {
    return Response.json({ error: 'no session content to save' }, { status: 400 });
  }

  const cb = coerceJsonField(body.cost_breakdown);
  if (!cb.ok) return Response.json({ error: 'invalid cost_breakdown JSON' }, { status: 400 });

  const sources = coerceJsonField(body.sources);
  if (!sources.ok) return Response.json({ error: 'invalid sources JSON' }, { status: 400 });

  const costTotal =
    typeof body.cost_total === 'number' && Number.isFinite(body.cost_total) ? body.cost_total : null;
  const scratch = typeof body.scratch_notes === 'string' ? body.scratch_notes : '';

  const locFromBody = locationFromBody(body);
  const locFromReq = locationFromRequest(req);
  const locationId = locFromBody !== 'default' ? locFromBody : locFromReq;

  const id = uuidv7();
  const now = Date.now();

  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO specials
      (id, location_id, name, pantry_text, prompt_text, ai_answer, ai_model,
       cost_breakdown, cost_total, scratch_notes, sources,
       created_at, updated_at)
    VALUES
      (@id, @location_id, @name, @pantry_text, @prompt_text, @ai_answer, @ai_model,
       @cost_breakdown, @cost_total, @scratch_notes, @sources,
       @created_at, @updated_at)
  `);

  const txn = db.transaction((row) => {
    insert.run(row);
    logAuditAction({
      action: 'specials.create',
      special_id: row.id,
      name: row.name,
      location_id: row.location_id,
    });
  });

  txn({
    id,
    location_id: locationId,
    name: nameRes.value,
    pantry_text: pantry,
    prompt_text: prompt,
    ai_answer: answer,
    ai_model: model,
    cost_breakdown: cb.value,
    cost_total: costTotal,
    scratch_notes: scratch,
    sources: sources.value,
    created_at: now,
    updated_at: now,
  });

  return Response.json({ id }, { status: 200 });
}

export async function GET(req) {
  const url = new URL(req.url);
  const location = url.searchParams.get('location') || 'default';

  const db = getDb();
  const rows = db.prepare(`
    SELECT id, name, ai_answer, cost_total, last_exported_at, created_at
    FROM specials
    WHERE location_id = ? AND archived_at IS NULL
    ORDER BY created_at DESC
  `).all(location);

  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    cost_total: r.cost_total,
    last_exported_at: r.last_exported_at,
    created_at: r.created_at,
    snippet: snippet(r.ai_answer),
  }));

  return Response.json({ items }, { status: 200 });
}
