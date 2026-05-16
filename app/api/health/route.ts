// app/api/health/route.ts — aggregated integration health for launch ops.
//
// Probes every external system Lariat talks to and returns a JSON
// status report. Used by:
//   - the launch-day operator (curl http://lariat.local:3001/api/health)
//   - the desktop wrapper's first-run wizard (post-install gate)
//   - external monitoring (a green endpoint = the kitchen is online)
//
// Intentionally NOT pin-gated — operators need to be able to hit it
// from any device on the LAN to triage a "is it up?" question without
// a manager being present. Returns no operator-sensitive data; just
// up/down + last-success timestamps.
//
// Each probe is best-effort and timeout-bounded so one slow integration
// can't stall the whole report. Failed probes degrade individually.

import { getDb } from '../../../lib/db';
import { getOllamaConfig } from '../../../lib/ollama';
import { resolveDataDir } from '../../../lib/dataDir';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const PROBE_TIMEOUT_MS = 2_500;

type ProbeOK = { ok: true; detail: string; ms: number };
type ProbeDown = { ok: false; error: string; ms: number };
type Probe = ProbeOK | ProbeDown;

async function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function probeOllama(): Promise<Probe> {
  const t0 = Date.now();
  try {
    const { baseUrl, model } = getOllamaConfig();
    const res = await timedFetch(`${baseUrl.replace(/\/$/, '')}/api/tags`);
    const ms = Date.now() - t0;
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, ms };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const hasModel = (data.models || []).some((m) => m.name.startsWith(model));
    if (!hasModel) {
      return { ok: false, error: `model "${model}" not loaded`, ms };
    }
    return { ok: true, detail: `model=${model} reachable`, ms };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    };
  }
}

function probeSqlite(): Probe {
  const t0 = Date.now();
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as n FROM line_check_entries').get() as { n: number };
    return { ok: true, detail: `${row.n} line_check_entries`, ms: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    };
  }
}

function probeCache(): Probe {
  const t0 = Date.now();
  const cachePath = path.join(resolveDataDir(), 'cache', 'recipes.json');
  if (!fs.existsSync(cachePath)) {
    return { ok: false, error: 'recipes.json missing', ms: Date.now() - t0 };
  }
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { ok: false, error: 'recipes.json malformed', ms: Date.now() - t0 };
    }
    return { ok: true, detail: `${parsed.length} recipes`, ms: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    };
  }
}

function probeCompliance(): Probe {
  const t0 = Date.now();
  const dbPath = path.join(resolveDataDir(), 'cache', 'compliance.db');
  if (!fs.existsSync(dbPath)) {
    return { ok: false, error: 'compliance.db missing', ms: Date.now() - t0 };
  }
  return { ok: true, detail: 'compliance.db present', ms: Date.now() - t0 };
}

function probeDatapack(): Probe {
  const t0 = Date.now();
  const symlink = path.join(resolveDataDir(), 'lariat-data');
  if (!fs.existsSync(symlink)) {
    return { ok: false, error: 'datapack symlink missing (optional)', ms: Date.now() - t0 };
  }
  try {
    fs.realpathSync(symlink);
    return { ok: true, detail: 'datapack reachable', ms: Date.now() - t0 };
  } catch {
    return { ok: false, error: 'datapack symlink broken', ms: Date.now() - t0 };
  }
}

function probeToastConfig(): Probe {
  const t0 = Date.now();
  // We don't actually hit Toast in a launch-day health probe (their API
  // is rate-limited and credential drift is rare). We just check that
  // the credentials are configured.
  const hasCreds = Boolean(
    process.env.LARIAT_TOAST_CLIENT_ID && process.env.LARIAT_TOAST_CLIENT_SECRET,
  );
  return hasCreds
    ? { ok: true, detail: 'credentials configured', ms: Date.now() - t0 }
    : { ok: false, error: 'TOAST credentials unset (optional)', ms: Date.now() - t0 };
}

function probeSevenShiftsConfig(): Probe {
  const t0 = Date.now();
  const hasCreds = Boolean(
    process.env.LARIAT_7SHIFTS_API_KEY || process.env.LARIAT_SEVENSHIFTS_API_KEY,
  );
  return hasCreds
    ? { ok: true, detail: 'API key configured', ms: Date.now() - t0 }
    : { ok: false, error: '7SHIFTS API key unset (optional)', ms: Date.now() - t0 };
}

function probePrismConfig(): Probe {
  const t0 = Date.now();
  const hasCreds = Boolean(process.env.LARIAT_PRISM_USERNAME && process.env.LARIAT_PRISM_PASSWORD);
  return hasCreds
    ? { ok: true, detail: 'credentials configured', ms: Date.now() - t0 }
    : { ok: false, error: 'PRISM credentials unset (optional)', ms: Date.now() - t0 };
}

function probePinGate(): Probe {
  const t0 = Date.now();
  const hasSecret = Boolean(process.env.LARIAT_PIN_SECRET && process.env.LARIAT_PIN);
  return hasSecret
    ? { ok: true, detail: 'PIN gate active', ms: Date.now() - t0 }
    : {
        ok: false,
        error: 'PIN unset — manager pages are publicly readable on this LAN',
        ms: Date.now() - t0,
      };
}

export async function GET() {
  // Parallel where I/O is involved, sync for the rest. Cap total wall
  // time at PROBE_TIMEOUT_MS + slack.
  const [ollama] = await Promise.all([probeOllama()]);

  const probes = {
    // Required for the kitchen to function:
    sqlite: probeSqlite(),
    cache: probeCache(),
    pin_gate: probePinGate(),
    // Required for the LaRi (kitchen assistant):
    ollama,
    compliance: probeCompliance(),
    // Optional / off-tree / per-deployment:
    datapack: probeDatapack(),
    toast: probeToastConfig(),
    sevenshifts: probeSevenShiftsConfig(),
    prism: probePrismConfig(),
  };

  // Status rolls up: down if any *required* probe failed; degraded if
  // any optional probe failed; ok otherwise. Operators only need to
  // act on "down."
  const required: Array<keyof typeof probes> = ['sqlite', 'cache', 'pin_gate'];
  const isDown = required.some((k) => !probes[k].ok);
  const isDegraded = !isDown && Object.values(probes).some((p) => !p.ok);
  const status = isDown ? 'down' : isDegraded ? 'degraded' : 'ok';

  return Response.json(
    {
      status,
      version: process.env.npm_package_version || 'unknown',
      timestamp: new Date().toISOString(),
      probes,
    },
    {
      status: isDown ? 503 : 200,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
