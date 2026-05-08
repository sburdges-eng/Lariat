import { buildGroundedContext } from '../../../lib/kitchenAssistantContext';
import { getDb, todayISO } from '../../../lib/db';
import {
  getOllamaConfig,
  GROUNDED_SYSTEM,
  ollamaChat,
} from '../../../lib/ollama';
import { locationFromBodyOrRequest } from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';
import { hasPinCookie } from '../../../lib/pin';
import {
  CalculatorError,
  expandForBEO,
  formatLeafRowsAsTasks,
  scaleRecipe,
} from '../../../lib/recipeCalculator';
import { validateReceivingReading, dbStatusFor } from '../../../lib/receiving';
import { validateTempReading, getTempPoint } from '../../../lib/tempLog';
import { normalizeUnit } from '../../../lib/unitConvert.mjs';
import { isImperativeCommand } from '../../../lib/cookMessageClassifier';

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

/** GET — Ollama reachability + safe config for UI (no secrets). */
export async function GET(req) {
  const u = new URL(req.url);
  const ping = u.searchParams.get('ping') === '1';
  const cfg = getOllamaConfig();
  if (!ping) {
    return Response.json(cfg);
  }
  try {
    const base = cfg.baseUrl.replace(/\/$/, '');
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    const r = await fetch(`${base}/api/tags`, { signal: controller.signal });
    clearTimeout(t);
    return Response.json({ ...cfg, ollamaReachable: r.ok });
  } catch {
    return Response.json({ ...cfg, ollamaReachable: false });
  }
}

export async function POST(req) {
  return withIdempotency(req, () => kitchenAssistantPostHandler(req));
}

async function kitchenAssistantPostHandler(req) {
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

  const locationId = locationFromBodyOrRequest(body, req);

  const started = Date.now();
  let contextText;
  let sources;
  try {
    const built = await buildGroundedContext(locationId, message);
    contextText = built.contextText;
    sources = built.sources;
  } catch (e) {
    console.error(e);
    return Response.json({ error: 'Failed to load kitchen context' }, { status: 500 });
  }

  // Q-vs-C routing happens here in deterministic code, not in the LLM.
  // Models can misread sentences containing "86" as commands when they do
  // the routing in-prompt — see lib/cookMessageClassifier.ts.
  const isCommand = isImperativeCommand(message);

  let userContent = `CONTEXT (authoritative — only use these facts for operational claims):\n\n${contextText}\n\n---\nCOOK MESSAGE:\n${message}`;

  if (body.language && body.language !== 'English') {
    userContent += `\n\nTRANSLATION DIRECTIVE: You MUST answer the cook entirely in ${body.language}. Ensure you use accurate culinary terms and maintain the requested formatting.`;
  }

  if (isCommand) {
    userContent += `\n\nACTION ENGINE DIRECTIVE:

The cook has issued an imperative command to change kitchen state. Begin your response with a single fenced JSON block using exactly this format:
\`\`\`json
{ ... }
\`\`\`
Then AFTER the closing fence, on a new line, write a short human confirmation. Never put prose inside the JSON fence.

Schemas (use exactly one):
- 86 Item: { "action": "eighty_six", "item": "Name", "reason": "Optional" }
- Inventory Update: { "action": "update_inventory", "item": "Name", "delta": Number, "unit": "String", "direction": "in" | "out" | "waste" }
- Line Check: { "action": "line_check", "station": "Name", "item": "Name", "reading_f": Number | null, "temp_point_id": "cook_poultry" | "cook_ground_beef" | "cook_fish" | "reach_in_cooler" | "walk_in_cooler" | "receiving_cold" | "receiving_frozen" | "freezer" | null, "status": "pass" | "fail" | "na", "note": "Optional details" } — NOTE: If a temperature is provided, DO NOT provide a status. Output "reading_f" and "temp_point_id" only. The server will compute pass/fail. If it is a binary non-temp check, output the status.
- Maintenance: { "action": "maintenance", "equipment": "Name/Description", "issue": "String" }
- Scale Recipe: { "action": "scale_recipe", "recipe": "recipe_slug_or_name", "multiplier": Number }
- Order Guide Update: { "action": "update_order_guide", "item": "Name", "qty": Number, "unit": "String" }
- Add BEO Prep: { "action": "beo_add_prep", "event_id": Number, "tasks": ["Task 1", "Task 2"], "recipes": [{ "recipe_slug": "slug", "portions_per_guest": Number }] } — list the recipes and portions-per-guest; the SERVER multiplies by the BEO guest count using the deterministic calculator. DO NOT compute ingredient quantities yourself.
- Give Gold Star: { "action": "give_gold_star", "cook_name": "Exact Roster match", "reason": "String", "stars": 1 | 2 | 3 }
- HACCP Receive: { "action": "haccp_receive", "item": "Name", "category": "refrigerated" | "frozen" | "shell_eggs" | "hot_held" | "dry_goods" | "produce" | "shellfish", "reading_f": Number | null, "package_ok": Boolean, "note": "Details" } — DO NOT output pass/fail. The server validates temperatures.
- Generate Prep: { "action": "generate_prep", "station": "Station Name", "tasks": [{ "item": "Name", "need": "short velocity rationale", "recipe_slug": "slug", "multiplier": Number }] } — when a task maps to a recipe, supply recipe_slug + multiplier; the server expands leaves via the calculator. The "need" field is optional context, NOT a computed quantity.

ARITHMETIC & VALIDATION RULE: The server runs a deterministic calculator and FDA rules engine. NEVER compute ingredient totals in-token, and NEVER compute if a temperature passes or fails FDA rules. Your job is to extract the raw numbers (multiplier, reading_f, delta) for the server to process.`;
  } else {
    userContent += `\n\nANSWER FORMAT:

This is a question, not a command. Answer with plain prose only — bullets are fine. NEVER emit a JSON action block.

In this kitchen "86" is also a noun meaning "out-of-stock". Treat questions like "what's 86?", "is X 86 today?", or "anything 86?" as inventory inquiries — not commands. Cite what the CONTEXT shows on the 86 board, or say nothing is 86 if it's empty.`;
  }

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

    // Hard-block action execution on the question path. The classifier
    // already told the LLM not to emit JSON, but if it does anyway
    // (hallucination, locale drift), we must not write to regulated
    // state — strip the JSON to plain text and continue as prose. If
    // the LLM emitted *only* a JSON block (stripped is empty), fall
    // back to a neutral apology rather than leaking the raw JSON.
    if (payload && !isCommand) {
      finalAnswer = stripped
        ? stripped
        : "Sorry — I couldn't put that together as an answer. Could you rephrase?";
    }
    if (payload && isCommand) {
      try {
        const db = getDb();

        // Auth ticket: the HMAC-signed `lariat_pin_ok` cookie issued by
        // POST /api/auth/pin. Replaces the prior `x-lariat-pin` header
        // path which was timing-attackable (naked `===`), un-rate-limited,
        // and leaked the plaintext PIN through any proxy/log — and also
        // bypassed the cookie scheme from PR #182 entirely. Every other
        // regulated mutation route uses this same gate; the chat path
        // above remains unauthenticated for line-cook ergonomics.
        const hasPin = await hasPinCookie(req);
        // Every write action that mutates regulated or operator-visible state
        // must be PIN-gated. `eighty_six` keeps its additional inventory-based
        // soft-block below, but now also fails closed without a PIN.
        const pinRequired = [
          'update_inventory',
          'maintenance',
          'update_order_guide',
          'beo_add_prep',
          'line_check',
          'eighty_six',
          'give_gold_star',
          'haccp_receive',
          'generate_prep',
        ];
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
            const reasonClip = clip(payload.reason, MAX_NOTE) || 'AI Update';
            db.transaction(() => {
              const info = db.prepare('INSERT INTO eighty_six (location_id, item, shift_date, created_at, reason) VALUES (?, ?, ?, ?, ?)')
                .run(locationId, itemName, todayISO(), new Date().toISOString(), reasonClip);
              postAuditEvent({
                entity: 'eighty_six', entity_id: Number(info.lastInsertRowid), action: 'insert',
                actor_cook_id: null, actor_source: 'kitchen_assistant',
                location_id: locationId, payload: { item: itemName, reason: reasonClip },
              });
            })();
            actionMsg = `Marked ${payload.item} as 86'd.`;
            actionExecuted = true;
            console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - 86'd ${payload.item} ⚠️\n`);
          }
        } else if (payload.action === 'update_inventory' && payload.item) {
          const rawDelta = Number(payload.delta);
          // Strict numeric guard — pre-2026-05-08 a non-finite payload.delta
          // (e.g. "5 lbs", "a", null) silently fell through to clip()
          // and stored a junk string in inventory_updates.delta. Soft-reject
          // here so the LLM can retry with a clean number.
          if (!Number.isFinite(rawDelta)) {
            actionMsg = `Inventory update blocked — delta "${payload.delta}" is not a number. Try again with just the count.`;
            actionExecuted = true;
            console.error(`\n[KA BLOCKED]: update_inventory rejected — non-finite delta=${payload.delta}\n`);
          } else {
          const rawUnit = payload.unit ? normalizeUnit(payload.unit) : null;
          const deltaStr = rawUnit ? `${rawDelta} ${rawUnit}` : `${rawDelta}`;
          const itemClip = clip(payload.item, MAX_ITEM);
          const direction = clip(payload.direction, 16) || null;
          db.transaction(() => {
            const info = db.prepare('INSERT INTO inventory_updates (location_id, item, shift_date, created_at, delta, direction) VALUES (?, ?, ?, ?, ?, ?)')
              .run(locationId, itemClip, todayISO(), new Date().toISOString(), deltaStr, direction);
            postAuditEvent({
              entity: 'inventory_updates', entity_id: Number(info.lastInsertRowid), action: 'insert',
              actor_cook_id: null, actor_source: 'kitchen_assistant',
              location_id: locationId, payload: { item: itemClip, delta: deltaStr, direction },
            });
          })();
          actionMsg = `Logged inventory update for ${payload.item}.`;
          actionExecuted = true;
          console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - Inventory Update ${payload.item} ⚠️\n`);
          }
        } else if (payload.action === 'line_check' && payload.item && payload.station) {
          let status = clip(payload.status, 16) || 'na';
          let note = clip(payload.note, MAX_NOTE) || null;
          let readingF = Number(payload.reading_f);

          if (payload.temp_point_id && Number.isFinite(readingF)) {
            const pt = getTempPoint(payload.temp_point_id);
            if (pt) {
              const val = validateTempReading(pt, readingF, note);
              if (!val.ok) {
                status = 'fail';
                note = val.reason;
              } else {
                status = 'pass';
              }
            } else {
              status = 'na';
              note = `[Unvalidated Temp: ${readingF}°F] ${note || ''}`;
            }
          }

          const stationClip = clip(payload.station, 64);
          const itemClip = clip(payload.item, MAX_ITEM);
          db.transaction(() => {
            const info = db.prepare('INSERT INTO line_check_entries (location_id, shift_date, station_id, item, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(locationId, todayISO(), stationClip, itemClip, status, note, new Date().toISOString());
            postAuditEvent({
              entity: 'line_check_entries', entity_id: Number(info.lastInsertRowid), action: 'insert',
              actor_cook_id: null, actor_source: 'kitchen_assistant',
              location_id: locationId, payload: { station: stationClip, item: itemClip, status, reading_f: Number.isFinite(readingF) ? readingF : null },
            });
          })();
          actionMsg = `Logged line check for ${payload.item}${Number.isFinite(readingF) ? ` at ${readingF}°F` : ''} (${status}).`;
          actionExecuted = true;
          console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - HACCP Line Check: ${payload.item} (${status}) ⚠️\n`);
        } else if (payload.action === 'maintenance' && payload.equipment) {
          const equipName = clip(payload.equipment, MAX_ITEM);
          // Wrap in % wildcards for partial matching, consistent with the
          // eighty_six lookup pattern earlier in this file. Pre-fix the
          // raw `equipName` only matched on exact equality, defeating the
          // LIKE — the LLM had to know the exact stored name to resolve.
          const row = db.prepare('SELECT id FROM equipment WHERE name LIKE ? AND location_id = ?').get(`%${equipName}%`, locationId);
          const equipId = row ? row.id : null;
          if (!equipId) {
            actionMsg = `Could not find equipment "${equipName}" — ask a manager to add it first.`;
            actionExecuted = true;
          } else {
            const issueClip = clip(payload.issue, MAX_NOTE) || 'n/a';
            const issueString = clip(`Broken: ${equipName}. Issue: ${issueClip}`, MAX_NOTE);
            db.transaction(() => {
              const info = db.prepare('INSERT INTO equipment_maintenance (location_id, equipment_id, service_date, type, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
                .run(locationId, equipId, todayISO(), 'repair_request', issueString, new Date().toISOString());
              postAuditEvent({
                entity: 'equipment_maintenance', entity_id: Number(info.lastInsertRowid), action: 'insert',
                actor_cook_id: null, actor_source: 'kitchen_assistant',
                location_id: locationId, payload: { equipment: equipName, issue: issueClip, equipment_id: equipId },
              });
            })();
            actionMsg = `Submitted maintenance ticket for ${payload.equipment}.`;
            actionExecuted = true;
            console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - Maintenance Ticket: ${payload.equipment} ⚠️\n`);
          }
        } else if (payload.action === 'scale_recipe' && payload.recipe) {
          const rawMult = Number(payload.multiplier);
          if (!Number.isFinite(rawMult) || rawMult <= 0) {
            actionMsg = `Scale Recipe blocked — multiplier ${payload.multiplier} is not a positive number.`;
            actionExecuted = true;
          } else {
            try {
              // Model's numeric fields are DISCARDED — calculator is authoritative.
              const result = await scaleRecipe(String(payload.recipe), rawMult);
              const tasks = formatLeafRowsAsTasks(result.leafRows);
              const insert = db.prepare(
                'INSERT INTO line_check_entries (location_id, shift_date, station_id, item, status, need, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
              );
              // ACID-A: all leaf rows land or none do.
              db.transaction(() => {
                for (const leaf of result.leafRows) {
                  insert.run(
                    locationId,
                    todayISO(),
                    `scaled:${result.recipeSlug}`,
                    clip(leaf.ingredient, MAX_ITEM),
                    'na',
                    clip(`${leaf.qty} ${leaf.unit}`, 64),
                    new Date().toISOString()
                  );
                }
                postAuditEvent({
                  entity: 'line_check_entries', entity_id: null, action: 'insert',
                  actor_cook_id: null, actor_source: 'kitchen_assistant',
                  location_id: locationId,
                  payload: { recipe: result.recipeSlug, scaleFactor: result.scaleFactor, leafCount: result.leafRows.length },
                  note: `scale_recipe: ${result.leafRows.length} leaf rows`,
                });
              })();
              actionMsg = `Scaled ${result.recipeSlug} to ${result.targetQty} ${result.targetUnit} (×${result.scaleFactor}). ${tasks.length} ingredient line${tasks.length === 1 ? '' : 's'} — values from deterministic calculator.`;
              actionExecuted = true;
              console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - Scale Recipe ${result.recipeSlug} ×${result.scaleFactor} ⚠️\n`);
            } catch (e) {
              const code = e instanceof CalculatorError ? e.code : 'unknown';
              actionMsg = `Scale Recipe failed (${code}): ${e.message}`;
              actionExecuted = true;
              console.error('Calculator scale_recipe error:', e);
            }
          }
        } else if (payload.action === 'update_order_guide' && payload.item) {
          const rawUnit = payload.unit ? normalizeUnit(payload.unit) : 'ea';
          const itemClip = clip(payload.item, MAX_ITEM);
          // Strict numeric guard on qty. Pre-2026-05-08 the route did
          // `qty = payload.qty || 1`, so an LLM emitting "5 lbs" or
          // null wrote a string/falsy-coerced value into base_qty. Now
          // we soft-reject so the LLM can retry with a clean number.
          const rawQty = Number(payload.qty);
          if (!Number.isFinite(rawQty) || rawQty <= 0) {
            actionMsg = `Order Guide update blocked — qty "${payload.qty}" is not a positive number. Try again with just the count.`;
            actionExecuted = true;
            console.error(`\n[KA BLOCKED]: update_order_guide rejected — non-finite qty=${payload.qty}\n`);
          } else {
          const qty = rawQty;
          db.transaction(() => {
            const info = db.prepare('INSERT INTO order_guide_items (location_id, ingredient, base_qty, unit, imported_at) VALUES (?, ?, ?, ?, ?)')
              .run(locationId, itemClip, qty, clip(rawUnit, 16), new Date().toISOString());
            postAuditEvent({
              entity: 'order_guide_items', entity_id: Number(info.lastInsertRowid), action: 'insert',
              actor_cook_id: null, actor_source: 'kitchen_assistant',
              location_id: locationId, payload: { item: itemClip, qty, unit: rawUnit },
            });
          })();
          actionMsg = `Added ${qty} ${rawUnit} of ${payload.item} to the Order Guide.`;
          actionExecuted = true;
          console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - Order Guide Updated: ${payload.item} ⚠️\n`);
          }
        } else if (payload.action === 'beo_add_prep' && Number.isInteger(Number(payload.event_id)) && Array.isArray(payload.tasks)) {
          const eventIdNum = Number(payload.event_id);
          // Cross-location guard: the LLM is free to emit any event_id, so
          // before touching beo_prep_tasks we MUST confirm the parent
          // beo_events row exists AND belongs to the requesting locationId.
          // Without this an attacker (or a hallucinating model) at location A
          // could inject a prep task whose parent event lives at location B —
          // surfacing location-B operational state inside location A's
          // worksheets and mutating location-B planning data.
          //
          // HACCP rule (CLAUDE.md): never weaken validations or silently
          // auto-correct. We surface the rejection in actionMsg using the
          // same soft-reject pattern as `maintenance` ("Could not find
          // equipment …") and DO NOT fall back to a default location_id.
          const beoEvent = db
            .prepare('SELECT location_id, guest_count FROM beo_events WHERE id = ?')
            .get(eventIdNum);
          if (!beoEvent) {
            actionMsg = `Add BEO Prep blocked — event ${eventIdNum} does not exist. Ask a manager to create the BEO first.`;
            actionExecuted = true;
            console.error(`\n🔍 [BEO PREP BLOCKED]: event_id=${eventIdNum} not found (location=${locationId})\n`);
          } else if (beoEvent.location_id !== locationId) {
            actionMsg = `Add BEO Prep blocked — event ${eventIdNum} belongs to a different location. Cross-location prep injection is not allowed.`;
            actionExecuted = true;
            console.error(`\n🔍 [BEO PREP BLOCKED]: event_id=${eventIdNum} belongs to location=${beoEvent.location_id}, requester=${locationId} (cross-location attempt)\n`);
          } else {
            const stmt = db.prepare('INSERT INTO beo_prep_tasks (location_id, event_id, task, done, sort_order) VALUES (?, ?, ?, 0, 0)');
            let calcNotes = [];
            // Optional `recipes` array: [{recipe|recipe_slug, portions_per_guest}].
            // If present AND the BEO row has a guest_count, compute authoritative quantities
            // via the calculator and append those task strings instead of trusting the model's math.
            const beoRecipes = Array.isArray(payload.recipes) ? payload.recipes : [];
            let calcTasks = [];
            if (beoRecipes.length > 0) {
              const guests = Number(beoEvent.guest_count);
              if (Number.isFinite(guests) && guests > 0) {
                try {
                  const results = await expandForBEO(
                    beoRecipes
                      .map((r) => ({
                        slug: String(r.recipe_slug || r.recipe || ''),
                        portionsPerGuest: Number(r.portions_per_guest ?? 1),
                      }))
                      .filter((r) => r.slug),
                    guests
                  );
                  for (const res of results) {
                    for (const task of formatLeafRowsAsTasks(res.leafRows)) {
                      calcTasks.push(`[${res.recipeSlug}] ${task}`);
                    }
                  }
                  calcNotes.push(`Calculator produced ${calcTasks.length} scaled prep lines for ${guests} guests.`);
                } catch (e) {
                  const code = e instanceof CalculatorError ? e.code : 'unknown';
                  calcNotes.push(`Calculator error (${code}): ${e.message}. Falling back to model-provided tasks.`);
                }
              }
            }
            const finalTasks = calcTasks.length > 0 ? calcTasks : payload.tasks;
            // ACID-A: all prep tasks land or none do.
            db.transaction(() => {
              for (const t of finalTasks) {
                stmt.run(locationId, eventIdNum, clip(typeof t === 'string' ? t : String(t ?? ''), MAX_NOTE));
              }
              postAuditEvent({
                entity: 'beo_prep_tasks', entity_id: null, action: 'insert',
                actor_cook_id: null, actor_source: 'kitchen_assistant',
                location_id: locationId,
                payload: { event_id: eventIdNum, taskCount: finalTasks.length, calcScaled: calcTasks.length > 0 },
                note: `beo_add_prep: ${finalTasks.length} tasks`,
              });
            })();
            actionMsg = `Added ${finalTasks.length} ${calcTasks.length > 0 ? 'calculator-scaled' : 'scaled'} side-prep tasks to BEO ID ${eventIdNum}.${calcNotes.length ? ' ' + calcNotes.join(' ') : ''}`;
            actionExecuted = true;
            console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - Added ${finalTasks.length} prep tasks to BEO ${eventIdNum} (calc=${calcTasks.length > 0}) ⚠️\n`);
          } // close cross-location guard else-branch (event exists + matches locationId)
        } else if (payload.action === 'give_gold_star' && payload.cook_name) {
          const starVal = Math.min(Math.max(Number(payload.stars) || 1, 1), 3);
          const cookName = clip(payload.cook_name, 64);
          const reasonClip = clip(payload.reason || 'Exceptional performance', MAX_NOTE);
          // Roster validation. Pre-2026-05-08 there was none — the LLM
          // could invent a cook name (or hallucinate one from its
          // training data) and a recognition row would land for a
          // non-existent person. The system prompt claimed "Exact
          // Roster match" but the backend didn't enforce it.
          //
          // Soft-reject pattern: if the name doesn't match a known
          // active employee on entities_employees (case-insensitive
          // exact match on display_name), surface a "couldn't find"
          // message so the LLM can retry. Skip the gate when the
          // entities_employees table is empty (fresh DB / not yet
          // populated) — better to allow recognition than block on
          // missing seed data.
          let rosterOk = true;
          let rosterEmpty = false;
          try {
            const totalRow = db
              .prepare('SELECT COUNT(*) AS n FROM entities_employees WHERE active = 1')
              .get();
            rosterEmpty = !totalRow || (totalRow.n ?? 0) === 0;
            if (!rosterEmpty) {
              const match = db
                .prepare(
                  'SELECT uuid FROM entities_employees WHERE active = 1 AND LOWER(display_name) = LOWER(?) LIMIT 1',
                )
                .get(cookName);
              rosterOk = !!match;
            }
          } catch {
            // entities_employees missing on a legacy / partially-migrated
            // DB — fall back to allowing the action so the recognition
            // surface keeps working.
            rosterOk = true;
          }
          if (!rosterOk) {
            actionMsg = `Gold Star blocked — "${payload.cook_name}" is not on the active roster. Ask a manager to confirm the name or add the cook first.`;
            actionExecuted = true;
            console.error(`\n[KA BLOCKED]: give_gold_star rejected — unknown cook ${payload.cook_name} (location=${locationId})\n`);
          } else {
          db.transaction(() => {
            const info = db.prepare('INSERT INTO gold_stars (location_id, cook_name, reason, stars) VALUES (?, ?, ?, ?)')
              .run(locationId, cookName, reasonClip, starVal);
            postAuditEvent({
              entity: 'gold_stars', entity_id: Number(info.lastInsertRowid), action: 'insert',
              actor_cook_id: null, actor_source: 'kitchen_assistant',
              location_id: locationId, payload: { cook_name: cookName, reason: reasonClip, stars: starVal },
            });
          })();
          actionMsg = `Awarded ${starVal} Gold Star(s) to ${payload.cook_name} for HR recognition.`;
          actionExecuted = true;
          console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - HR RECOGNITION: ${starVal} Gold Star(s) awarded to ${payload.cook_name} ⚠️\n`);
          }
        } else if (payload.action === 'haccp_receive' && payload.item) {
          let status = 'pass';
          let note = clip(payload.note, MAX_NOTE) || null;
          let readingF = Number(payload.reading_f);

          if (payload.category) {
            try {
              const val = validateReceivingReading({
                category: payload.category,
                reading_f: Number.isFinite(readingF) ? readingF : undefined,
                package_ok: typeof payload.package_ok === 'boolean' ? payload.package_ok : undefined,
              });
              status = dbStatusFor(val.status) === 'rejected' ? 'fail' : 'pass';
              if (val.reason) {
                note = `[${val.reason}] ${note || ''}`;
              }
            } catch (err) {
              // Validator threw — surface as 'fail' (regulated red marker
              // on the cook's board) rather than 'na' (no signal). 'na'
              // is reserved for items that genuinely don't apply at this
              // station/shift. A thrown validator is a HACCP signal a
              // manager must see, not a quiet skip.
              status = 'fail';
              note = `[Validation Error: ${err.message}] ${note || ''}`;
            }
          }

          const itemClip = clip(payload.item, MAX_ITEM);
          const categoryClip = clip(payload.category, 64);
          db.transaction(() => {
            const info = db.prepare('INSERT INTO line_check_entries (location_id, shift_date, station_id, item, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(locationId, todayISO(), 'haccp_receiving', itemClip, status, note, new Date().toISOString());
            postAuditEvent({
              entity: 'line_check_entries', entity_id: Number(info.lastInsertRowid), action: 'insert',
              actor_cook_id: null, actor_source: 'kitchen_assistant',
              location_id: locationId, payload: { item: itemClip, category: categoryClip, status, reading_f: Number.isFinite(readingF) ? readingF : null },
            });
          })();
          actionMsg = `Logged HACCP receiving for ${payload.item} (${status}).`;
          actionExecuted = true;
          console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - HACCP Receiving: ${payload.item} (${status}) ⚠️\n`);
        } else if (payload.action === 'generate_prep' && payload.station && Array.isArray(payload.tasks)) {
          const stmt = db.prepare('INSERT INTO line_check_entries (location_id, shift_date, station_id, item, status, need, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
          let calcReplacements = 0;
          let calcFailures = 0;
          // For each task, if the model supplies a `recipe`/`recipe_slug` and `multiplier`,
          // discard its `need` string and let the calculator produce the authoritative
          // quantity list. Otherwise fall through to the task as provided.
          // Collect all rows first (some branches are async), then insert atomically.
          const prepRows = [];
          for (const t of payload.tasks) {
            const slug = t && (t.recipe_slug || t.recipe);
            const mult = Number(t && t.multiplier);
            if (slug && Number.isFinite(mult) && mult > 0) {
              try {
                const result = await scaleRecipe(String(slug), mult);
                for (const leaf of result.leafRows) {
                  prepRows.push([
                    locationId,
                    todayISO(),
                    clip(payload.station, 64),
                    clip(leaf.ingredient, MAX_ITEM),
                    'na',
                    clip(`${leaf.qty} ${leaf.unit}`, 64),
                    new Date().toISOString()
                  ]);
                }
                calcReplacements += 1;
                continue;
              } catch (e) {
                calcFailures += 1;
                console.error(`generate_prep calculator error for ${slug}:`, e);
                // fall through and store the model's task as-is
              }
            }
            prepRows.push([
              locationId,
              todayISO(),
              clip(payload.station, 64),
              clip(t.item, MAX_ITEM),
              'na',
              clip(t.need, 64) || null,
              new Date().toISOString()
            ]);
          }
          const stationClip = clip(payload.station, 64);
          // ACID-A: all prep rows land or none do.
          db.transaction(() => {
            for (const row of prepRows) {
              stmt.run(...row);
            }
            postAuditEvent({
              entity: 'line_check_entries', entity_id: null, action: 'insert',
              actor_cook_id: null, actor_source: 'kitchen_assistant',
              location_id: locationId,
              payload: { station: stationClip, taskCount: prepRows.length, calcReplacements, calcFailures },
              note: `generate_prep: ${prepRows.length} rows`,
            });
          })();
          const calcSuffix =
            calcReplacements > 0
              ? ` (${calcReplacements} scaled by calculator${calcFailures ? `, ${calcFailures} fallback` : ''})`
              : '';
          actionMsg = `Generated ${payload.tasks.length} dynamic prep tasks for ${payload.station}${calcSuffix}.`;
          actionExecuted = true;
          console.error(`\n⚠️ [MGMNT ALERT]: AI ACTION EXECUTED - Dynamic Prep List for ${payload.station} (${payload.tasks.length} items, calc=${calcReplacements}) ⚠️\n`);
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
