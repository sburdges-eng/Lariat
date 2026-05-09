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
 * Find the first balanced JSON object in `content` and return:
 *   - `payload`: the parsed object (must have `action: string`), or null
 *     if no valid action JSON is present.
 *   - `stripped`: `content` with the JSON block removed and code fences
 *     stripped, ready to be presented to the user as prose.
 *
 * The brace scanner is string-aware (skips `{`/`}` inside `"…"` literals)
 * and escape-aware (skips characters following `\`). Used by both the
 * Kitchen Assistant and the Specials sandbox.
 */
export function extractAction(content: string): ExtractActionResult {
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

  let payload: unknown = null;
  try { payload = JSON.parse(content.slice(braceStart, end + 1)); }
  catch { return { payload: null, stripped: stripFences(content) }; }

  if (!payload || typeof payload !== 'object' || typeof (payload as { action?: unknown }).action !== 'string') {
    return { payload: null, stripped: stripFences(content) };
  }
  const stripped = stripFences(content.slice(0, braceStart) + content.slice(end + 1));
  return { payload: payload as { action: string; [k: string]: unknown }, stripped };
}
