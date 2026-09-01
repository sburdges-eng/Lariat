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
interface JsonSpan { start: number; end: number; value: unknown }

// Collect every balanced top-level {…} span (start, end-exclusive, parsed).
// String-aware (skips `{`/`}` inside `"…"` literals) and escape-aware.
function scanTopLevelJsonObjects(content: string): JsonSpan[] {
  const spans: JsonSpan[] = [];
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
  return spans;
}

const isActionSpan = (s: JsonSpan): boolean =>
  !!s.value && typeof s.value === 'object' && !Array.isArray(s.value) &&
  typeof (s.value as { action?: unknown }).action === 'string';

function removeSpans(content: string, spans: JsonSpan[]): string {
  let out = content;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, s.start) + out.slice(s.end);
  }
  return out;
}

export function extractAction(content: string): ExtractActionResult {
  const spans = scanTopLevelJsonObjects(content);
  const payloadSpan = spans.find(isActionSpan) ?? null;

  // Remove EVERY successfully-parsed top-level object from the prose. Prose
  // braces that failed JSON.parse were never recorded as spans, so they stay.
  const stripped = stripFences(removeSpans(content, spans));

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
  // Unlike extractAction (mid-pipeline, strips EVERY parsed object), this runs
  // on the fully-assembled answer, which may legitimately embed non-action JSON
  // — e.g. a payload_json cell in a rendered db_query table. Remove only the
  // spans that parse AND carry a string `action` field (the leak shape), plus
  // fences. An empty result means the text was ENTIRELY action JSON/fences —
  // returning '' (blank) is the safe outcome; never fall back to the raw text.
  const spans = scanTopLevelJsonObjects(text).filter(isActionSpan);
  return stripFences(removeSpans(text, spans));
}

/**
 * 2026-08-31 venue find: asked about "pico", the KA v3 model mimicked the
 * CONTEXT's XML shape and looped (`<ingredient name="diced shallot" />` ×12)
 * until the token cap, fabricating ingredients along the way. Deterministic
 * hygiene in the same spirit as the double-JSON strip above: degenerate
 * output must never reach a cook.
 *
 * Two signals, either one disqualifies. Both were re-derived from measurement
 * on 2026-08-31 after the first cut destroyed truthful answers:
 *
 *  - MARKUP is the signal that actually caught the incident (48 tags against a
 *    threshold of 5) — the CONTEXT is rendered as XML, so a model echoing its
 *    own grounding is the observed failure. The tag name must be a bare
 *    identifier, so vendor contacts (`<orders@shamrockfoods.com>`) and bare
 *    URLs (`<https://fda.gov/haccp>`) are not mistaken for markup.
 *
 *  - REPETITION needs two clauses, because neither alone is honest. A
 *    CONSECUTIVE run catches a loop appended to an otherwise good answer, which
 *    a share-of-answer test misses. DOMINANCE catches a loop interleaved with
 *    filler, which a run test misses. Counting a bare repeat anywhere — the
 *    first cut — flagged 7 of 13 realistic answers: 23 of 79 real recipes are
 *    untagged and emit an identical "Tags: none listed" line, so listing four
 *    of them was enough to wipe the answer.
 *
 * The run resets on any line too short to score, which is deliberate: it is
 * what keeps "Not logged yet." under four station headers (a truthful line
 * check) out of the guard, because the station names break the run. A loop
 * punctuated by short lines is left to the dominance clause.
 */
const MARKUP_TAG_RE = /<\/?[a-z][a-z0-9]*(?:[-:_][a-z0-9]+)*(?:\s[^<>]{0,80})?\/?>/gi;
const MARKUP_TAG_MIN = 5;
const REPEAT_LINE_MIN_LEN = 8;
const REPEAT_RUN_MIN = 4;
const REPEAT_DOMINANCE_MIN = 0.5;

/** A markdown table row — real data repeats these legitimately. */
function isTableRow(line: string): boolean {
  return line.length > 1 && line.startsWith('|') && line.endsWith('|');
}

export function isDegenerateAnswer(text: string): boolean {
  if (!text) return false;

  const tagCount = (text.match(MARKUP_TAG_RE) || []).length;
  if (tagCount >= MARKUP_TAG_MIN) return true;

  // Split on every newline flavor: a CRLF answer must score the same as an LF
  // one. (The Swift twin collapsed CRLF input to a single line and could never
  // trip — see AssistantActionExtractor.swift.)
  const lines = text.split(/\r\n|\r|\n/).map((raw) => raw.trim());

  let prev: string | null = null;
  let run = 0;
  const counts = new Map<string, number>();
  let nonEmpty = 0;
  for (const line of lines) {
    if (line.length > 0) nonEmpty += 1;
    if (line.length < REPEAT_LINE_MIN_LEN || isTableRow(line)) {
      prev = null;
      run = 0;
      continue;
    }
    run = line === prev ? run + 1 : 1;
    prev = line;
    if (run >= REPEAT_RUN_MIN) return true;
    counts.set(line, (counts.get(line) || 0) + 1);
  }

  // Dominance is measured against every non-empty line, not just the scored
  // ones. Short lines are content a cook reads — station names, headers — so
  // they count toward "how much of this answer is the loop".
  let repeated = 0;
  for (const n of counts.values()) if (n >= REPEAT_RUN_MIN) repeated += n;
  return nonEmpty > 0 && repeated / nonEmpty >= REPEAT_DOMINANCE_MIN;
}
