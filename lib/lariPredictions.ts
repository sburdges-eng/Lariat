// LaRi predictions — pure rule module for the ambient strip's data layer.
//
// V5 ships a deterministic stub (no ML, no learned model): scan
// operational tables, produce 1–5 hand-rolled predictions per surface
// keyed by severity. The contract here — { surface, severity, text,
// action?, source } — is what every future ML/heuristic upgrade plugs
// into; the strip component stays unchanged.
//
// Naming: the AI is "LaRi" (front-end + this module). "LaRiOS" is the
// design-system label, never surfaces here.

export type LariSeverity = 'ok' | 'warn' | 'alert';

export interface LariPrediction {
  id: string;                  // stable per-request id, used as React key
  surface: string;             // 'beo' | 'shows' | 'foh' | 'boh' | ...
  severity: LariSeverity;
  text: string;                // short, line-cook readable
  action?: string;             // optional follow-up hint, e.g. "open BEO"
  source?: string;             // free-form provenance, e.g. 'beo_events:3'
  for_role?: string;           // optional role filter, e.g. 'pic'
}

const SEVERITY_RANK: Record<LariSeverity, number> = { alert: 0, warn: 1, ok: 2 };

const MAX_TEXT_LENGTH = 240;
const MAX_ACTION_LENGTH = 80;

export function isValidSeverity(s: unknown): s is LariSeverity {
  return s === 'ok' || s === 'warn' || s === 'alert';
}

/**
 * Coerce a loose input into a {@link LariPrediction}, or return null
 * if required fields are missing/malformed. Used at the API boundary
 * so consumers never see half-parsed rows.
 */
export function normalizePrediction(raw: unknown): LariPrediction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : null;
  if (!id) return null;

  const surface = typeof r.surface === 'string' && r.surface.trim() ? r.surface.trim() : null;
  if (!surface) return null;

  const severity = isValidSeverity(r.severity) ? r.severity : null;
  if (severity == null) return null;

  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (!text) return null;

  const out: LariPrediction = {
    id,
    surface,
    severity,
    text: text.slice(0, MAX_TEXT_LENGTH),
  };
  if (typeof r.action === 'string' && r.action.trim()) {
    out.action = r.action.trim().slice(0, MAX_ACTION_LENGTH);
  }
  if (typeof r.source === 'string' && r.source.trim()) {
    out.source = r.source.trim();
  }
  if (typeof r.for_role === 'string' && r.for_role.trim()) {
    out.for_role = r.for_role.trim();
  }
  return out;
}

/**
 * Sort predictions for display: alert → warn → ok, then by text length
 * (longer/more-specific predictions first within a tier — pragmatic
 * proxy for "more information density"). Stable: equal-key rows keep
 * input order.
 */
export function sortBySeverity(list: readonly LariPrediction[]): LariPrediction[] {
  if (!Array.isArray(list)) return [];
  const arr = list as readonly LariPrediction[];
  return [...arr].sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity];
    const sb = SEVERITY_RANK[b.severity];
    if (sa !== sb) return sa - sb;
    return b.text.length - a.text.length;
  });
}

/**
 * Cap list to N highest-severity predictions. N defaults to 5, matching
 * the ambient strip's max visible slots (3 inline + 2 in the overflow
 * panel a future PR may add).
 */
export function trimPredictions(list: readonly LariPrediction[], n = 5): LariPrediction[] {
  return sortBySeverity(list).slice(0, Math.max(0, n));
}

// ── BEO prediction builder ──────────────────────────────────────

export interface BeoEventRow {
  id: number;
  title: string;
  event_date: string | null;
  event_time: string | null;
  contact_name: string | null;
  guest_count: number | null;
  notes: string | null;
}

export interface BeoLineItemRow {
  id: number;
  event_id: number;
  item_name: string;
  quantity: number | null;
}

export interface BeoPrepTaskRow {
  id: number;
  event_id: number;
  task: string;
  due_date: string | null;
  done: number;
}

export interface BeoPredictionInputs {
  events: readonly BeoEventRow[];
  lineItems: readonly BeoLineItemRow[];
  prepTasks: readonly BeoPrepTaskRow[];
  today: string;                 // ISO YYYY-MM-DD
}

/**
 * Deterministic V5 stub. Walks the supplied seed rows and emits up to
 * 5 predictions ranked by severity. Every prediction's id is stable
 * for the (input → output) pair so client-side React keys don't churn
 * across polls.
 *
 * Heuristics:
 *   alert  · event tonight with no contact set
 *   alert  · prep_task overdue (due_date < today, done = 0)
 *   warn   · event tonight with <3 line items and >20 guests
 *   warn   · event in next 7 days with no line items
 *   ok     · "N BEOs in next 7 days" rollup
 */
export function buildBeoPredictions(inputs: BeoPredictionInputs): LariPrediction[] {
  const { events, lineItems, prepTasks, today } = inputs;
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  const todayEvents = events.filter((e) => e.event_date === today);
  const upcomingEvents = events.filter(
    (e) => e.event_date && e.event_date > today && daysUntil(today, e.event_date) <= 7,
  );

  const lineCounts = new Map<number, number>();
  for (const l of lineItems || []) {
    lineCounts.set(l.event_id, (lineCounts.get(l.event_id) || 0) + 1);
  }

  const out: LariPrediction[] = [];

  // alert: event tonight missing contact_name
  for (const e of todayEvents) {
    if (!e.contact_name || !e.contact_name.trim()) {
      out.push({
        id: `beo-missing-contact-${e.id}`,
        surface: 'beo',
        severity: 'alert',
        text: `Tonight: "${e.title}" has no host contact saved — confirm before service.`,
        action: 'open BEO',
        source: `beo_events:${e.id}`,
      });
    }
  }

  // alert: overdue prep_task
  for (const t of prepTasks || []) {
    if (t.done) continue;
    if (!t.due_date) continue;
    if (t.due_date < today) {
      const event = events.find((e) => e.id === t.event_id);
      const eventLabel = event ? `"${event.title}"` : `event #${t.event_id}`;
      out.push({
        id: `beo-overdue-task-${t.id}`,
        surface: 'beo',
        severity: 'alert',
        text: `Overdue prep for ${eventLabel}: "${t.task}" was due ${t.due_date}.`,
        action: 'mark done',
        source: `beo_prep_tasks:${t.id}`,
      });
    }
  }

  // warn: today's event with <3 line items + >20 guests
  for (const e of todayEvents) {
    const count = lineCounts.get(e.id) || 0;
    const guests = Number(e.guest_count) || 0;
    if (count < 3 && guests > 20) {
      out.push({
        id: `beo-thin-menu-${e.id}`,
        surface: 'beo',
        severity: 'warn',
        text: `Tonight: "${e.title}" has only ${count} line item${count === 1 ? '' : 's'} for ${guests} guests.`,
        action: 'review menu',
        source: `beo_events:${e.id}`,
      });
    }
  }

  // warn: upcoming event with no line items at all
  for (const e of upcomingEvents) {
    const count = lineCounts.get(e.id) || 0;
    if (count === 0) {
      out.push({
        id: `beo-empty-menu-${e.id}`,
        surface: 'beo',
        severity: 'warn',
        text: `${e.event_date}: "${e.title}" has no menu yet — ${daysUntil(today, e.event_date!)} day${daysUntil(today, e.event_date!) === 1 ? '' : 's'} out.`,
        action: 'open BEO',
        source: `beo_events:${e.id}`,
      });
    }
  }

  // ok: rollup of upcoming count
  if (upcomingEvents.length > 0) {
    out.push({
      id: `beo-upcoming-rollup-${today}`,
      surface: 'beo',
      severity: 'ok',
      text: `${upcomingEvents.length} BEO${upcomingEvents.length === 1 ? '' : 's'} in the next 7 days.`,
      source: 'beo_events:rollup',
    });
  }

  return trimPredictions(out);
}

// ── Sound-engineer prediction builder ─────────────────────────────

export interface SoundScenesInput {
  id: number;
  scene_name: string;
  spl_limit_db: number | null;
  plot: { channels?: unknown[]; monitors?: unknown[] } | null;
  saved_at: string;
}

export interface SplSummaryInput {
  count: number;
  latest: number | null;
  peak: number | null;
  over_limit_count: number;
  limit_db: number | null;
}

export interface SoundPredictionInputs {
  show_id: number;
  band_name: string | null;
  scenes: readonly SoundScenesInput[];
  spl_summary: SplSummaryInput | null;
  today: string;
}

/**
 * Deterministic V6 sound-surface stub. Walks the supplied scene list +
 * SPL summary and emits up to 5 predictions ranked by severity. Uses
 * the same contract as buildBeoPredictions — same trimPredictions cap,
 * same shape, same naming. The strip component renders both surfaces
 * identically.
 *
 * Heuristics (severity rank, alert first):
 *   alert  · last reading exceeded scene SPL limit (`over_limit_count`>0)
 *   alert  · current peak ≥ limit AND no scene saved (running blind)
 *   warn   · no sound scene saved for this show
 *   warn   · scene saved but spl_limit_db is null (no ceiling set)
 *   warn   · scene saved but plot has no channels (stage plot empty)
 *   ok     · in-band rollup: "N readings tonight, peak X dB"
 */
export function buildSoundPredictions(inputs: SoundPredictionInputs): LariPrediction[] {
  const { show_id, band_name, scenes, spl_summary } = inputs;
  if (!Array.isArray(scenes)) return [];

  const out: LariPrediction[] = [];
  const showLabel = band_name ? `"${band_name}"` : `show #${show_id}`;

  // alert · over-limit readings
  if (spl_summary && spl_summary.over_limit_count > 0 && spl_summary.limit_db != null) {
    out.push({
      id: `sound-over-limit-${show_id}`,
      surface: 'sound',
      severity: 'alert',
      text: `SPL exceeded ${spl_summary.limit_db} dB on ${spl_summary.over_limit_count} reading${spl_summary.over_limit_count === 1 ? '' : 's'} — pull the mains.`,
      action: 'open SPL log',
      source: `spl_readings:${show_id}`,
    });
  }

  // alert · running blind (peak hot, no scene saved)
  if (
    spl_summary &&
    spl_summary.peak != null &&
    spl_summary.peak >= 100 &&
    scenes.length === 0
  ) {
    out.push({
      id: `sound-running-blind-${show_id}`,
      surface: 'sound',
      severity: 'alert',
      text: `Peak ${spl_summary.peak} dB tonight and no scene saved for ${showLabel}.`,
      action: 'save scene',
      source: `sound_scenes:${show_id}`,
    });
  }

  // warn · no scene saved at all
  if (scenes.length === 0 && !(spl_summary && spl_summary.peak != null && spl_summary.peak >= 100)) {
    out.push({
      id: `sound-no-scene-${show_id}`,
      surface: 'sound',
      severity: 'warn',
      text: `No sound scene saved yet for ${showLabel}.`,
      action: 'save scene',
      source: `sound_scenes:${show_id}`,
    });
  }

  // warn · scene saved but spl_limit_db is null
  if (scenes.length > 0 && !scenes.some((s) => s.spl_limit_db != null)) {
    out.push({
      id: `sound-no-limit-${show_id}`,
      surface: 'sound',
      severity: 'warn',
      text: `Scene saved but no SPL ceiling set — ${showLabel} is running uncapped.`,
      action: 'set limit',
      source: `sound_scenes:${show_id}`,
    });
  }

  // warn · plot empty (no channels on most-recent scene)
  if (scenes.length > 0) {
    const latest = scenes[0];
    const channels = Array.isArray(latest.plot?.channels) ? latest.plot.channels : [];
    if (channels.length === 0) {
      out.push({
        id: `sound-empty-plot-${show_id}`,
        surface: 'sound',
        severity: 'warn',
        text: `Stage plot for "${latest.scene_name}" has no channels listed.`,
        action: 'open plot',
        source: `sound_scenes:${latest.id}`,
      });
    }
  }

  // ok · in-band rollup
  if (
    spl_summary &&
    spl_summary.count > 0 &&
    spl_summary.over_limit_count === 0 &&
    spl_summary.peak != null
  ) {
    out.push({
      id: `sound-rollup-${show_id}`,
      surface: 'sound',
      severity: 'ok',
      text: `${spl_summary.count} reading${spl_summary.count === 1 ? '' : 's'} tonight · peak ${spl_summary.peak} dB · in band.`,
      source: `spl_readings:${show_id}:rollup`,
    });
  }

  return trimPredictions(out);
}

/**
 * Calendar-day distance between two ISO YYYY-MM-DD strings. Returns 0
 * for identical dates, a positive integer for end > start, -1 for any
 * unparseable input (callers can treat as "skip"). Uses noon-UTC
 * anchoring to dodge DST off-by-ones.
 */
export function daysUntil(start: string, end: string): number {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  if (a == null || b == null) return -1;
  return Math.round((b - a) / 86_400_000);
}

function parseIsoDate(iso: string): number | null {
  if (typeof iso !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T12:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}
