import { buildGroundedContext } from '../../../lib/kitchenAssistantContext';
import { getDb, todayISO } from '../../../lib/db';
import {
  assistantEnabled,
  getOllamaConfig,
  GROUNDED_SYSTEM,
  ollamaChat,
} from '../../../lib/ollama';
import { locationFromBody, locationFromRequest } from '../../../lib/location';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_MESSAGE = 2000;
const MAX_ITEM = 300;
const MAX_NOTE = 500;

function clip(s, max) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
}

function stripFences(s) {
  return s.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
}

function extractAction(content) {
  const braceStart = content.indexOf('{');
  if (braceStart < 0) return { payload: null, stripped: stripFences(content) };

  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = braceStart; i < content.length; i++) {
    const ch = content[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return { payload: null, stripped: stripFences(content) };

  let payload = null;
  try { payload = JSON.parse(content.slice(braceStart, end + 1)); }
  catch { return { payload: null, stripped: stripFences(content) }; }

  if (!payload || typeof payload !== 'object' || typeof payload.action !== 'string') {
    return { payload: null, stripped: stripFences(content) };
  }
  const stripped = stripFences(content.slice(0, braceStart) + content.slice(end + 1));
  return { payload, stripped };
}

/** GET — feature flag + safe config for UI (no secrets). */
export async function GET(req) {
  const u = new URL(req.url);
  const ping = u.searchParams.get('ping') === '1';
  const cfg = getOllamaConfig();
  if (!assistantEnabled()) {
    return Response.json({ enabled: false, ...cfg });
  }
  if (!ping) {
    return Response.json({ enabled: true, ...cfg });
  }
  try {
    const base = cfg.baseUrl.replace(/\/$/, '');
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    const r = await fetch(`${base}/api/tags`, { signal: controller.signal });
    clearTimeout(t);
    const ok = r.ok;
    return Response.json({ enabled: true, ...cfg, ollamaReachable: ok });
  } catch {
    return Response.json({ enabled: true, ...cfg, ollamaReachable: false });
  }
}

export async function POST(req) {
  if (!assistantEnabled()) {
    return Response.json(
      { error: 'Kitchen assistant is disabled. Set LARIAT_ASSISTANT_ENABLED=1 and run Ollama.' },
      { status: 503 }
    );
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return Response.json({ error: 'message is required' }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE) {
    return Response.json({ error: `message too long (max ${MAX_MESSAGE} chars)` }, { status: 400 });
  }

  const locFromBody = locationFromBody(body);
  const locFromReq = locationFromRequest(req);
  const locationId = locFromBody !== 'default' ? locFromBody : locFromReq;

  const started = Date.now();
  let contextText;
  let sources;
  try {
    const built = buildGroundedContext(locationId, message);
    contextText = built.contextText;
    sources = built.sources;
  } catch (e) {
    console.error(e);
    return Response.json({ error: 'Failed to load kitchen context' }, { status: 500 });
  }

  let userContent = `CONTEXT (authoritative — only use these facts for operational claims):\n\n${contextText}\n\n---\nCOOK QUESTION:\n${message}`;
  
  if (body.language && body.language !== 'English') {
    userContent += `\n\nTRANSLATION DIRECTIVE: You MUST answer the cook's question entirely in ${body.language}. Ensure you use accurate culinary terms and maintain the requested formatting.`;
  }
  
  userContent += `\n\nACTION ENGINE DIRECTIVE:

QUESTIONS vs COMMANDS — read this first:
- If the cook is ASKING something (how many, what is, is there, where, when, why, do we have, can I…) → answer with plain prose ONLY. Do NOT emit any JSON block.
- Only emit a JSON action block when the cook issues an IMPERATIVE COMMAND to change state (e.g. "86 the salmon", "log 5 lb of carrots received", "mark the walk-in broken", "give Jenny a gold star").
- When in doubt whether it's a question or a command, treat it as a question.

If and only if it is a command, begin your response with a single fenced JSON block using exactly this format:
\`\`\`json
{ ... }
\`\`\`
Then AFTER the closing fence, on a new line, write a short human confirmation. Never put prose inside the JSON fence.

Schemas (use exactly one):
- 86 Item: { "action": "eighty_six", "item": "Name", "reason": "Optional" }
- Inventory Update: { "action": "update_inventory", "item": "Name", "delta": "+/- Amount", "direction": "in" | "out" | "waste" }
- Line Check: { "action": "line_check", "station": "Name", "item": "Name", "status": "pass" | "fail" | "na", "note": "Optional details/temps" }
- Maintenance: { "action": "maintenance", "equipment": "Name/Description", "issue": "String" }
- Scale Recipe: { "action": "scale_recipe", "recipe": "Name", "multiplier": Number }
- Order Guide Update: { "action": "update_order_guide", "item": "Name", "qty": Number, "unit": "String" }
- Add BEO Prep: { "action": "beo_add_prep", "event_id": Number, "tasks": ["Task 1", "Task 2"] } — mathematically scale side-prep yields to the BEO's guest count; inject exact quantities into each task string.
- Give Gold Star: { "action": "give_gold_star", "cook_name": "Exact Roster match", "reason": "String", "stars": 1 | 2 | 3 }
- HACCP Receive: { "action": "haccp_receive", "item": "Name", "status": "pass" | "fail", "note": "Temps/Details" }
- Generate Prep: { "action": "generate_prep", "station": "Station Name", "tasks": [{ "item": "Name", "need": "Calculated amount based on velocity" }] }`;

  try {
    const { content, model } = await ollamaChat({
      messages: [
        { role: 'system', content: GROUNDED_SYSTEM },
        { role: 'user', content: userContent },
      ],
    });
    
    let actionExecuted = false;
    let actionMsg = '';

    const { payload, stripped } = extractAction(content);
    let finalAnswer = stripped || content;

    if (payload) {
      try {
        const db = getDb();

        const pin = req.headers.get('x-lariat-pin');
        const expectedPin = process.env.LARIAT_PIN;
        const hasPin = expectedPin && pin === expectedPin;
        const pinRequired = ['update_inventory', 'maintenance', 'update_order_guide', 'beo_add_prep', 'line_check'];
        if (pinRequired.includes(payload.action) && !hasPin) {
          actionMsg = 'Action blocked — manager PIN required. Show a manager and ask them to confirm.';
          actionExecuted = true;
        } else if (payload.action === 'eighty_six' && payload.item) {
          const itemName = clip(payload.item, MAX_ITEM);
          const invRow = db.prepare(
            `SELECT ingredient, base_qty, unit FROM order_guide_items WHERE ingredient LIKE ? AND location_id = ? LIMIT 1`
          ).get(`%${itemName}%`, locationId);
          const depletedToday = invRow ? db.prepare(
            `SELECT COUNT(*) as cnt FROM inventory_updates WHERE item LIKE ? AND location_id = ? AND shift_date = ? AND direction IN ('out','waste')`
          ).get(`%${itemName}%`, locationId, todayISO()) : null;
          const stockDepleted = depletedToday && depletedToday.cnt > 0;
          if (invRow && invRow.base_qty > 0 && !stockDepleted && !hasPin) {
            actionMsg = `Hold on — order guide shows ${invRow.base_qty} ${invRow.unit || ''} of ${invRow.ingredient} on hand. Look again, then ask a manager if it's really gone.`;
            actionExecuted = true;
            console.error(`\n🔍 [86 BLOCKED]: ${payload.item} — inventory shows ${invRow.base_qty} ${invRow.unit || ''}\n`);
          } else {
            const stmt = db.prepare('INSERT INTO eighty_six (location_id, item, shift_date, created_at, reason) VALUES (?, ?, ?, ?, ?)');
            stmt.run(locationId, itemName, todayISO(), new Date().toISOString(), clip(payload.reason, MAX_NOTE) || 'AI Update');
            actionMsg = `Marked ${payload.item} as 86'd.`;
            actionExecuted = true;
            console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - 86'd ${payload.item} ⚠️\n`);
          }
        } else if (payload.action === 'update_inventory' && payload.item) {
          const stmt = db.prepare('INSERT INTO inventory_updates (location_id, item, shift_date, created_at, delta, direction) VALUES (?, ?, ?, ?, ?, ?)');
          stmt.run(locationId, clip(payload.item, MAX_ITEM), todayISO(), new Date().toISOString(), clip(payload.delta, 64) || null, clip(payload.direction, 16) || null);
          actionMsg = `Logged inventory update for ${payload.item}.`;
          actionExecuted = true;
          console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - Inventory Update ${payload.item} ⚠️\n`);
        } else if (payload.action === 'line_check' && payload.item && payload.station) {
          const stmt = db.prepare('INSERT INTO line_check_entries (location_id, shift_date, station_id, item, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
          stmt.run(locationId, todayISO(), clip(payload.station, 64), clip(payload.item, MAX_ITEM), clip(payload.status, 16) || 'na', clip(payload.note, MAX_NOTE) || null, new Date().toISOString());
          actionMsg = `Logged line check for ${payload.item}.`;
          actionExecuted = true;
          console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - HACCP Line Check: ${payload.item} (${payload.status}) ⚠️\n`);
        } else if (payload.action === 'maintenance' && payload.equipment) {
          const equipName = clip(payload.equipment, MAX_ITEM);
          const row = db.prepare('SELECT id FROM equipment WHERE name LIKE ? AND location_id = ?').get(equipName, locationId);
          const equipId = row ? row.id : null;
          if (!equipId) {
            actionMsg = `Could not find equipment "${equipName}" — ask a manager to add it first.`;
            actionExecuted = true;
          } else {
            const issueString = clip(`Broken: ${payload.equipment}. Issue: ${payload.issue || 'n/a'}`, MAX_NOTE);
            const stmt = db.prepare('INSERT INTO equipment_maintenance (location_id, equipment_id, service_date, type, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)');
            stmt.run(locationId, equipId, todayISO(), 'repair_request', issueString, new Date().toISOString());
            actionMsg = `Submitted maintenance ticket for ${payload.equipment}.`;
            actionExecuted = true;
            console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - Maintenance Ticket: ${payload.equipment} ⚠️\n`);
          }
        } else if (payload.action === 'scale_recipe' && payload.recipe) {
          actionMsg = `RECIPE MATHEMATICALLY SCALED`;
          actionExecuted = true;
        } else if (payload.action === 'update_order_guide' && payload.item) {
          const stmt = db.prepare('INSERT INTO order_guide_items (location_id, ingredient, base_qty, unit, imported_at) VALUES (?, ?, ?, ?, ?)');
          stmt.run(locationId, clip(payload.item, MAX_ITEM), payload.qty || 1, clip(payload.unit, 16) || 'ea', new Date().toISOString());
          actionMsg = `Added ${payload.qty || 1} ${payload.unit || ''} of ${payload.item} to the Order Guide.`;
          actionExecuted = true;
          console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - Order Guide Updated: ${payload.item} ⚠️\n`);
        } else if (payload.action === 'beo_add_prep' && payload.event_id && Array.isArray(payload.tasks)) {
          const stmt = db.prepare('INSERT INTO beo_prep_tasks (location_id, event_id, task, done, sort_order) VALUES (?, ?, ?, 0, 0)');
          for (const t of payload.tasks) {
            stmt.run(locationId, payload.event_id, clip(t, MAX_NOTE));
          }
          actionMsg = `Added ${payload.tasks.length} scaled side-prep tasks to BEO ID ${payload.event_id}.`;
          actionExecuted = true;
          console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - Added ${payload.tasks.length} prep tasks to BEO ${payload.event_id} ⚠️\n`);
        } else if (payload.action === 'give_gold_star' && payload.cook_name) {
          const stmt = db.prepare('INSERT INTO gold_stars (location_id, cook_name, reason, stars) VALUES (?, ?, ?, ?)');
          const starVal = Math.min(Math.max(Number(payload.stars) || 1, 1), 3);
          stmt.run(locationId, clip(payload.cook_name, 64), clip(payload.reason || 'Exceptional performance', MAX_NOTE), starVal);
          actionMsg = `Awarded ${starVal} Gold Star(s) to ${payload.cook_name} for HR recognition.`;
          actionExecuted = true;
          console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - HR RECOGNITION: ${starVal} Gold Star(s) awarded to ${payload.cook_name} ⚠️\n`);
        } else if (payload.action === 'haccp_receive' && payload.item) {
          const stmt = db.prepare('INSERT INTO line_check_entries (location_id, shift_date, station_id, item, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
          stmt.run(locationId, todayISO(), 'haccp_receiving', clip(payload.item, MAX_ITEM), clip(payload.status, 16) || 'pass', clip(payload.note, MAX_NOTE) || null, new Date().toISOString());
          actionMsg = `Logged HACCP receiving for ${payload.item}.`;
          actionExecuted = true;
          console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - HACCP Receiving: ${payload.item} (${payload.status}) ⚠️\n`);
        } else if (payload.action === 'generate_prep' && payload.station && Array.isArray(payload.tasks)) {
          const stmt = db.prepare('INSERT INTO line_check_entries (location_id, shift_date, station_id, item, status, need, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
          for (const t of payload.tasks) {
            stmt.run(locationId, todayISO(), clip(payload.station, 64), clip(t.item, MAX_ITEM), 'needs_prep', clip(t.need, 64) || null, new Date().toISOString());
          }
          actionMsg = `Generated ${payload.tasks.length} dynamic prep tasks for ${payload.station}.`;
          actionExecuted = true;
          console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - Dynamic Prep List for ${payload.station} (${payload.tasks.length} items) ⚠️\n`);
        }
      } catch (e) {
        console.error("Action Engine Execution Error:", e);
      }
    }

    if (actionExecuted) {
      finalAnswer = `⚡ ACTION EXECUTED: ${actionMsg}\n\n${finalAnswer}`;
    }

    const latencyMs = Date.now() - started;
    return Response.json({
      answer: finalAnswer,
      model,
      location_id: locationId,
      sources,
      latencyMs,
      disclaimer:
        'Check tags with a manager. Do not trust AI for allergies.',
    });
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'Inference timed out — try a shorter question or a smaller model.' : String(e.message || e);
    console.error(e);
    return Response.json({ error: msg }, { status: 502 });
  }
}
