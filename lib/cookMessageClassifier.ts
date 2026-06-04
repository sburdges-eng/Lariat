/**
 * Classify a cook message as imperative command (state-change) or question
 * (information request) before it reaches the LLM.
 *
 * Background: cooks use "86" as both a verb ("86 the salmon") and a noun
 * ("what's 86?", "is salmon 86 today?"). When the LLM does the Q-vs-C
 * routing inside its prompt, models often misread sentences with "86" as
 * commands and echo the input back. This module runs that decision in
 * deterministic code so the LLM only sees the action-schemas directive
 * when the message is genuinely imperative.
 *
 * Bias: ambiguous → question. Cooks who want to change kitchen state
 * should lead with an imperative verb. This matches the in-prompt
 * examples already shown to operators (e.g. "86 the salmon", "log 5 lb
 * of carrots received", "mark the walk-in broken", "give Jenny a gold
 * star").
 */

/** Regex for English question-words and copulas at the start of a message. */
const QUESTION_LEAD_RE =
  /^(what|when|where|how|why|who|which|is|are|am|was|were|do|does|did|can|could|should|would|will|may|might|have|has|had)\b/i;

/**
 * Regex for imperative verbs that map to one of the action schemas in
 * `app/api/kitchen-assistant/route.js`. Keep in sync when adding actions.
 *
 * `eighty[\s-]?six` covers the spelled-out form ("eighty-six the salmon"),
 * which is rare on the line but does appear in management surfaces.
 */
const IMPERATIVE_LEAD_RE =
  /^(86|eighty[\s-]?six|log|mark|add|give|set|update|record|note|reject|receive|reorder|order|adjust|scale|prep|generate)\b/i;

const PIN_REQUIRED_LEAD_RE =
  /^(86|eighty[\s-]?six|log|mark|add|give|set|record|note|reject|receive|reorder|order|adjust|scale|prep)\b/i;

const PIN_REQUIRED_UPDATE_RE =
  /^update\s+(inventory|order(?:\s+guide)?|par|prep|line|station|count|counts|quantity|qty)\b/i;

const PIN_REQUIRED_GENERATE_RE =
  /^generate\s+(?:a\s+)?(?:dynamic\s+)?prep(?:\s+list|\s+for|\b)/i;

export function isImperativeCommand(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  const m = message.trim();
  if (!m) return false;
  if (/\?/.test(m)) return false;
  if (QUESTION_LEAD_RE.test(m)) return false;
  if (IMPERATIVE_LEAD_RE.test(m)) return true;
  return false;
}

export function requiresPinBeforeLlm(message: unknown): boolean {
  if (!isImperativeCommand(message)) return false;
  const m = (message as string).trim();
  return PIN_REQUIRED_LEAD_RE.test(m)
    || PIN_REQUIRED_UPDATE_RE.test(m)
    || PIN_REQUIRED_GENERATE_RE.test(m);
}
