import { buildGroundedContext } from '../../../lib/kitchenAssistantContext';
import {
  assistantEnabled,
  getOllamaConfig,
  CREATIVE_SYSTEM,
  ollamaChat,
} from '../../../lib/ollama';
import { locationFromBody, locationFromRequest } from '../../../lib/location';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_MESSAGE = 2000;

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

  const userContent = `CURRENT COCKPIT STATUS (For grounding 86s or inventory availability limits):\n\n${contextText}\n\n---\nCHEF QUESTION / SANDBOX PROMPT:\n${message}`;

  try {
    const { content, model } = await ollamaChat({
      messages: [
        { role: 'system', content: CREATIVE_SYSTEM },
        { role: 'user', content: userContent },
      ],
    });
    const latencyMs = Date.now() - started;
    return Response.json({
      answer: content,
      model,
      location_id: locationId,
      sources,
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
