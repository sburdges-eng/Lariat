// Employee health — FDA Food Code §2-201.11 / CO 6 CCR 1010-2.
//
// The FDA defines 5 reportable symptoms and 6 reportable diagnoses
// (Big-6). An employee exhibiting any of these MUST be excluded or
// restricted from food work. Return-to-work requires a documented
// clearance event.
//
// This module canonicalizes symptom/diagnosis keys so the DB never
// sees free-text descriptors — the inspector audit question is "show
// me every worker excluded for vomiting in Q1" and that query only
// works if symptoms are stored in a known vocabulary.

import type { SickWorkerReport } from './db.ts';

// ── FDA vocabulary ────────────────────────────────────────────────

// FDA §2-201.11(A)(3): the 5 reportable symptoms.
export const SYMPTOMS = [
  'vomiting',
  'diarrhea',
  'jaundice',
  'sore_throat_with_fever',
  'infected_lesion',
] as const;
export type Symptom = (typeof SYMPTOMS)[number];

// FDA §2-201.11(A)(1-2): "Big-6" notifiable diagnoses.
export const DIAGNOSES = [
  'norovirus',
  'salmonella_typhi',
  'salmonella_nontyphoidal',
  'shigella',
  'stec_ehec',
  'hepatitis_a',
] as const;
export type Diagnosis = (typeof DIAGNOSES)[number];

const SYMPTOM_SET = new Set<string>(SYMPTOMS);
const DIAGNOSIS_SET = new Set<string>(DIAGNOSES);

// ── FDA action rules ──────────────────────────────────────────────
//
// The required action depends on the symptom/diagnosis AND on whether
// the establishment serves a highly susceptible population (HSP).
// Lariat does not; keep HSP rules on the shelf for future multi-site.
//
// - Vomiting / diarrhea / jaundice / Big-6 diagnosis → EXCLUDE.
// - Sore throat with fever → RESTRICT (no exposed-food tasks) unless
//   HSP (then EXCLUDE).
// - Infected lesion → RESTRICT if covered, EXCLUDE if not covered /
//   actively draining. We conservatively RESTRICT and let the PIC
//   upgrade to EXCLUDE in the note if needed.
// - Multiple symptoms: the strictest wins.

export type Action = SickWorkerReport['action'];

function rankAction(a: Action): number {
  switch (a) {
    case 'excluded': return 3;
    case 'restricted': return 2;
    case 'monitor': return 1;
    case 'none': return 0;
  }
}

export function requiredActionFor(
  symptoms: Symptom[],
  diagnosis: Diagnosis | null,
): Action {
  let worst: Action = 'none';
  const bump = (a: Action) => {
    if (rankAction(a) > rankAction(worst)) worst = a;
  };

  if (diagnosis !== null) bump('excluded');

  for (const s of symptoms) {
    switch (s) {
      case 'vomiting':
      case 'diarrhea':
      case 'jaundice':
        bump('excluded');
        break;
      case 'sore_throat_with_fever':
      case 'infected_lesion':
        bump('restricted');
        break;
    }
  }
  return worst;
}

// ── Input validation / normalization ──────────────────────────────

export type ValidateResult = { ok: true } | { ok: false; reason: string };

export interface SickReportInput {
  cook_id: unknown;
  symptoms: unknown;            // string[] or comma-joined string
  diagnosed_illness?: unknown;  // one of DIAGNOSES or null
  action: unknown;              // override from PIC — must be ≥ requiredAction
  started_at: unknown;          // ISO 8601
  clearance_source?: unknown;
  note?: unknown;
}

/**
 * Parse `symptoms` which may be either a string[] or a comma-joined
 * string. Rejects unknown keys — the PIC UI supplies a fixed checkbox
 * list so unknown values signal either a stale UI or a curl payload.
 */
export function normalizeSymptoms(x: unknown): Symptom[] | null {
  let arr: string[];
  if (Array.isArray(x)) {
    arr = x.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
  } else if (typeof x === 'string') {
    arr = x.split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    return null;
  }
  const out: Symptom[] = [];
  for (const s of arr) {
    if (!SYMPTOM_SET.has(s)) return null;
    out.push(s as Symptom);
  }
  // dedupe, preserve first-seen order
  return [...new Set(out)];
}

export function normalizeDiagnosis(x: unknown): Diagnosis | null | 'invalid' {
  if (x === null || x === undefined || x === '') return null;
  if (typeof x !== 'string') return 'invalid';
  const t = x.trim();
  if (t === '' || t.toLowerCase() === 'none') return null;
  if (!DIAGNOSIS_SET.has(t)) return 'invalid';
  return t as Diagnosis;
}

export function validateSickReport(x: SickReportInput): ValidateResult {
  if (typeof x.cook_id !== 'string' || x.cook_id.trim().length === 0) {
    return { ok: false, reason: 'cook_id is required' };
  }
  if (typeof x.started_at !== 'string' || !Number.isFinite(Date.parse(x.started_at))) {
    return { ok: false, reason: 'started_at must be an ISO timestamp' };
  }

  const syms = normalizeSymptoms(x.symptoms);
  if (syms === null) {
    return { ok: false, reason: `Unknown symptom — expected keys in ${SYMPTOMS.join(', ')}` };
  }
  const dx = normalizeDiagnosis(x.diagnosed_illness);
  if (dx === 'invalid') {
    return { ok: false, reason: `Unknown diagnosis — expected one of ${DIAGNOSES.join(', ')} or null` };
  }

  if (syms.length === 0 && dx === null) {
    return { ok: false, reason: 'Need at least one symptom or a diagnosed illness' };
  }

  const required = requiredActionFor(syms, dx);
  const action = x.action;
  if (typeof action !== 'string' ||
      !['excluded', 'restricted', 'monitor', 'none'].includes(action)) {
    return { ok: false, reason: `action must be one of excluded|restricted|monitor|none` };
  }
  // PIC may RAISE severity beyond what the rules require (e.g. exclude
  // a cook with a covered lesion because the cook is on the raw-bar
  // station). PIC may NOT LOWER severity — the FDA minimum is a floor.
  if (rankAction(action as Action) < rankAction(required)) {
    return {
      ok: false,
      reason:
        `FDA requires at least "${required}" for these symptoms/diagnosis; got "${action}"`,
    };
  }

  return { ok: true };
}
