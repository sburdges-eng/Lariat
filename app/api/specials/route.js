// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { buildGroundedContext } from '../../../lib/kitchenAssistantContext';
import {
  getOllamaConfig,
  CREATIVE_SYSTEM,
  ollamaChat,
} from '../../../lib/ollama';
import { locationFromBodyOrRequest } from '../../../lib/location';
import { computeSandboxCost } from '../../../lib/computeEngine/sandboxCosting';
import { withIdempotency } from '../../../lib/idempotency';
import { extractAction } from '../../../lib/extractAction';
import { hasPinCookie } from '../../../lib/pin';
import { formatDollars } from '../../../lib/formatMoney';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_MESSAGE = 2000;
const AI_DOWN_COPY = "AI is down. Can't connect to Ollama on the office Mac. Ask a manager to start it.";

function specialsModelErrorCopy(e) {
  if (e?.name === 'AbortError') {
    return 'Inference timed out — try a shorter question or a smaller model.';
  }
  const raw = String(e?.message || e || '');
  if (/fetch failed|failed to fetch|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|Ollama/i.test(raw)) {
    return AI_DOWN_COPY;
  }
  return raw || "Couldn't generate. Try again.";
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
  return withIdempotency(req, () => specialsPostHandler(req));
}

async function specialsPostHandler(req) {
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

  // Thread the same PIN-aware context tier the kitchen-assistant route uses
  // (#247). The public Specials Sandbox isn't behind middleware (only
  // `/specials/saved` is), so an unauthenticated LAN client could otherwise
  // read labor / sales / perf-review data via this LLM prompt. The Sandbox
  // is creative R&D and doesn't need the manager-tier context anyway —
  // grounded on 86s + inventory limits is the documented use case.
  const hasPin = await hasPinCookie(req);

  const started = Date.now();
  let contextText;
  let sources;
  try {
    const built = await buildGroundedContext(locationId, message, { hasPin });
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
      // §6 P3 — guard payload.* field types before they flow into compute
      // code per docs/PATTERNS.md §10. Drop any ingredient whose item
      // isn't a non-empty string, whose unit isn't a string, or whose
      // qty isn't a finite number. The LLM sometimes emits Array unit
      // values or null item names; bad shapes silently round-trip
      // through computeSandboxCost as wrong-but-not-crashing rows.
      const cleaned = payload.ingredients.filter(
        (i) =>
          i &&
          typeof i.item === 'string' &&
          i.item.trim() &&
          typeof i.unit === 'string' &&
          Number.isFinite(Number(i.qty)),
      );
      try {
        costResult = computeSandboxCost(locationId, cleaned);

        const totalLabel = costResult.partial
          ? `PARTIAL RECIPE COST: ${formatDollars(costResult.totalCost)} (some ingredients skipped — see table)`
          : `COMPUTED RECIPE COST: ${formatDollars(costResult.totalCost)}`;
        let costMarkdown = `\n\n> [!NOTE]\n> **⚡ ${totalLabel}**\n`;
        if (costResult.breakdown.length > 0) {
          costMarkdown += `>\n> | Ingredient | Requested | Vendor Match | Pack Price | Cost |\n`;
          costMarkdown += `> |---|---|---|---|---|\n`;
          for (const row of costResult.breakdown) {
            if (row.cost !== null) {
              costMarkdown += `> | ${row.item} | ${row.req_qty} ${row.req_unit} | ${row.match} (${row.pack_size} ${row.pack_unit}) | ${formatDollars(row.pack_price)} | ${formatDollars(row.cost)} |\n`;
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
    const msg = specialsModelErrorCopy(e);
    console.error(e);
    return Response.json({ error: msg }, { status: 502 });
  }
}
