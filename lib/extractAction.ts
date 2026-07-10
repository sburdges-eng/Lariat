/**
 * Shared LLM action-JSON parser used by both /api/kitchen-assistant and
 * /api/specials. See docs/PATTERNS.md §10 ("LLM action JSON") for the
 * end-to-end contract: when the LLM needs a number it can't reliably
 * compute, it emits `{ "action": "...", ... }` and the backend
 * intercepts via `extractAction()`, runs the deterministic computation,
 * strips the JSON, and appends rendered output.
 *
 * Previously this lived as byte-identical duplicates inside both routes.
 * Centralizing it means future fixes (nested-brace edge cases,
 * escaped-quote handling, JSON.parse error mode tweaks) land in one
 * place. See docs/audit/2026-05-08-codebase-audit.md §5.
 */

export interface ExtractActionResult {
  payload: { action: string; [k: string]: unknown } | null;
  stripped: string;
}

/**
 * Strip Markdown code fences (```json … ```) from an LLM response and
 * trim the result. Tolerates either ```json or plain ``` openers.
 */
export function stripFences(s: string): string {
  return s.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
}

/**
 * Scan ALL balanced top-level JSON objects in `content` and return:
 *   - `payload`: the FIRST object that parses and has `action: string`, or
 *     null if none is present.
 *   - `stripped`: `content` with EVERY balanced top-level object removed and
 *     code fences stripped — ready to present to the user as prose.
 *
 * Stripping every object (not just the payload) is a hard safety guarantee:
 * a model that emits the action JSON more than once (KA v3 rollout found a
 * fine-tune that double-emitted `scale_recipe`) must never leak a raw
 * `{"action":…}` block into the cook-facing answer. The first action-bearing
 * object stays the payload so handler semantics are unchanged; any additional
 * objects — duplicate actions, debug blobs, stray braces the model produced —
 * are removed from the prose regardless.
 *
 * The brace scanner is string-aware (skips `{`/`}` inside `"…"` literals) and
 * escape-aware (skips characters following `\`). Used by both the Kitchen
 * Assistant and the Specials sandbox.
 */
export function extractAction(content: string): ExtractActionResult {
  // Collect every balanced top-level {…} span (start, end-exclusive, parsed).
  const spans: Array<{ start: number; end: number; value: unknown }> = [];
  let i = 0;
  while (i < content.length) {
    if (content[i] !== '{') { i++; continue; }
    const start = i;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = start; j < content.length; j++) {
      const ch = content[j];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) break; // unbalanced tail — leave the rest untouched
    let value: unknown = null;
    try { value = JSON.parse(content.slice(start, end + 1)); }
    catch { value = undefined; } // not JSON (e.g. prose braces) — keep it in prose
    if (value !== undefined) spans.push({ start, end: end + 1, value });
    i = end + 1;
  }

  const isObj = (v: unknown): v is { [k: string]: unknown } =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const actionSpans = spans.filter((s) => isObj(s.value) && typeof (s.value as { action?: unknown }).action === 'string');
  const payloadSpan = actionSpans[0] ?? null;

  // Remove EVERY successfully-parsed top-level object from the prose. Prose
  // braces that failed JSON.parse were never recorded as spans, so they stay.
  let stripped = content;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) {
    stripped = stripped.slice(0, s.start) + stripped.slice(s.end);
  }
  stripped = stripFences(stripped);

  if (!payloadSpan) return { payload: null, stripped };
  return {
    payload: payloadSpan.value as { action: string; [k: string]: unknown },
    stripped,
  };
}

/**
 * Final belt-and-suspenders guard applied to the assistant answer JUST before
 * it is rendered to the cook. Removes any ```json/``` fence and any balanced
 * top-level JSON object that parses AND carries a string `action` field — i.e.
 * exactly the shape that leaked in the KA v3 rollout when a fine-tune emitted
 * the action JSON twice. It deliberately does NOT touch arbitrary prose braces
 * or non-action JSON (rendered db_query tables, prose), so it is safe to run on
 * the fully-assembled answer. Independent of which model or code path built the
 * text, so a raw action block can never reach the UI.
 */
export function sanitizeRenderedAnswer(text: string): string {
  if (!text) return text;
  // extractAction removes EVERY parsed top-level JSON object + all fences in one
  // pass. An empty result means the text was ENTIRELY JSON/fences — returning ''
  // (blank) is the safe outcome; never fall back to the raw text (that would be
  // the very leak this guards against). The route always prepends prose (the
  // "⚡ ACTION EXECUTED" line or a grounded answer), so blank does not occur in
  // practice — this only ever trims a stray residual block.
  return extractAction(text).stripped;
}
