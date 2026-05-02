import { buildGroundedContext } from '../../../lib/kitchenAssistantContext';
import {
  getOllamaConfig,
  CREATIVE_SYSTEM,
  ollamaChat,
} from '../../../lib/ollama';
import { locationFromBodyOrRequest } from '../../../lib/location';
import { computeSandboxCost } from '../../../lib/computeEngine/sandboxCosting';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_MESSAGE = 2000;

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

  const userContent = `CURRENT COCKPIT STATUS (For grounding 86s or inventory availability limits):\n\n${contextText}\n\n---\nCHEF QUESTION / SANDBOX PROMPT:\n${message}`;

  try {
    const { content, model } = await ollamaChat({
      messages: [
        { role: 'system', content: CREATIVE_SYSTEM },
        { role: 'user', content: userContent },
      ],
    });
    
    let finalAnswer = content;
    let costResult = null;
    const { payload, stripped } = extractAction(content);
    if (payload && payload.action === 'cost_special' && Array.isArray(payload.ingredients)) {
      finalAnswer = stripped || '';
      try {
        costResult = computeSandboxCost(locationId, payload.ingredients);

        const totalLabel = costResult.partial
          ? `PARTIAL RECIPE COST: $${costResult.totalCost.toFixed(2)} (some ingredients skipped — see table)`
          : `COMPUTED RECIPE COST: $${costResult.totalCost.toFixed(2)}`;
        let costMarkdown = `\n\n> [!NOTE]\n> **⚡ ${totalLabel}**\n`;
        if (costResult.breakdown.length > 0) {
          costMarkdown += `>\n> | Ingredient | Requested | Vendor Match | Pack Price | Cost |\n`;
          costMarkdown += `> |---|---|---|---|---|\n`;
          for (const row of costResult.breakdown) {
            if (row.cost !== null) {
              costMarkdown += `> | ${row.item} | ${row.req_qty} ${row.req_unit} | ${row.match} (${row.pack_size} ${row.pack_unit}) | $${row.pack_price.toFixed(2)} | $${row.cost.toFixed(2)} |\n`;
            } else {
              costMarkdown += `> | ${row.item} | ${row.req_qty || '?'} ${row.req_unit || ''} | — | — | *${row.note}* |\n`;
            }
          }
        }
        finalAnswer += costMarkdown;
      } catch (err) {
        console.error("Sandbox costing error:", err);
        finalAnswer += `\n\n> [!WARNING]\n> Could not compute deterministic cost: ${err.message}`;
      }
    }

    const latencyMs = Date.now() - started;
    return Response.json({
      answer: finalAnswer,
      model,
      location_id: locationId,
      sources,
      cost_breakdown: costResult ? costResult.breakdown : null,
      cost_total: costResult ? costResult.totalCost : null,
      latencyMs,
      disclaimer:
        'Answers use only the context snapshot above. Allergen tags are not legal allergen advice. Verify critical items on the floor and with a manager.',
    });
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'Inference timed out — try a shorter question or a smaller model.' : String(e.message || e);
    console.error(e);
    return Response.json({ error: msg }, { status: 502 });
  }
}
