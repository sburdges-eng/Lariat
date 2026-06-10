'use client';
// First-run setup wizard (roadmap 3.4).
//
// Each step is DETECTED from live state via /api/setup/status — there
// is no wizard-progress table. Refresh-safe, resumable, and steps
// flip complete on their own when data arrives via CLI ingest or a
// Data Pack drop. Reachable pre-PIN (the status API is not behind the
// middleware matcher) so a brand-new install can see step 1.
import { useCallback, useEffect, useState } from 'react';

/**
 * @typedef {{ id: string, label: string, complete: boolean, optional: boolean,
 *             detail: Record<string, unknown> }} SetupStepJson
 * @typedef {{ location_id: string, steps: SetupStepJson[], ready: boolean }} SetupStatusJson
 */

/** @param {{ command: string }} props */
function CommandBlock({ command }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try {
      navigator.clipboard.writeText(command).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    } catch {
      /* clipboard unavailable — the command is still selectable */
    }
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
      <code
        style={{
          background: 'rgba(0,0,0,0.35)',
          padding: '6px 10px',
          borderRadius: 6,
          fontFamily: 'monospace',
        }}
      >
        {command}
      </code>
      <button type="button" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** @param {{ complete: boolean, optional?: boolean }} props */
function StepBadge({ complete, optional }) {
  if (complete) return <span aria-label="complete">✓</span>;
  if (optional) return <span aria-label="optional">○</span>;
  return <span aria-label="incomplete">●</span>;
}

/** @param {{ currentName?: unknown, onSaved: () => void }} props */
function LocationForm({ currentName, onSaved }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  /** @param {import('react').FormEvent<HTMLFormElement>} e */
  const submit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter your venue name.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || 'Could not save the venue name.');
      } else {
        onSaved();
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={
          typeof currentName === 'string' && currentName
            ? currentName
            : 'Venue name (e.g. The Lariat — Uptown)'
        }
        maxLength={120}
        aria-label="Venue name"
      />
      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save venue'}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </form>
  );
}

export default function SetupPage() {
  const [status, setStatus] = useState(/** @type {SetupStatusJson | null} */ (null));
  const [loadError, setLoadError] = useState('');
  const [toastSkipped, setToastSkipped] = useState(false);

  const refresh = useCallback(() => {
    fetch('/api/setup/status', { cache: 'no-store' })
      .then((res) => res.json())
      .then((body) => {
        if (body && Array.isArray(body.steps)) {
          setStatus(body);
          setLoadError('');
        } else {
          setLoadError(body?.error || 'Unexpected status response.');
        }
      })
      .catch(() => setLoadError('Could not load setup status.'));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loadError) {
    return (
      <main style={{ padding: 24, maxWidth: 720 }}>
        <h1>Set up Lariat</h1>
        <p role="alert">{loadError}</p>
        <button type="button" onClick={refresh}>Retry</button>
      </main>
    );
  }

  if (!status) {
    return (
      <main style={{ padding: 24, maxWidth: 720 }}>
        <h1>Set up Lariat</h1>
        <p>Checking your install…</p>
      </main>
    );
  }

  /** @param {string} id */
  const step = (id) => {
    const found = status.steps.find((s) => s.id === id);
    if (!found) {
      return { id, label: id, complete: false, optional: false, detail: {} };
    }
    return found;
  };
  const pin = step('pin');
  const location = step('location');
  const vendor = step('vendor_prices');
  const recipes = step('recipes');
  const toast = step('toast');
  const live = status.ready;

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>Set up Lariat</h1>
      <p>
        Walk through these once. Steps check themselves off as soon as the data
        exists — you can leave and come back any time.
      </p>

      <ol style={{ display: 'grid', gap: 20, paddingLeft: 20 }}>
        <li>
          <StepBadge complete={pin.complete} optional={false} />{' '}
          <strong>Manager PIN</strong>
          {pin.complete ? (
            <p>A manager PIN is configured.</p>
          ) : (
            <p>
              Protect costing, analytics, and management pages.{' '}
              <a href="/login-pin?setup=1">Set the manager PIN</a>
            </p>
          )}
        </li>

        <li>
          <StepBadge complete={location.complete} optional={false} />{' '}
          <strong>Name your venue</strong>
          {location.complete ? (
            <p>
              Venue: <strong>{String(location.detail?.venue_name || '')}</strong>
            </p>
          ) : (
            <>
              <p>Give this install your restaurant&apos;s name.</p>
              <LocationForm
                currentName={location.detail?.venue_name}
                onSaved={refresh}
              />
            </>
          )}
        </li>

        <li>
          <StepBadge complete={vendor.complete} optional={false} />{' '}
          <strong>Import vendor prices</strong>
          {vendor.complete ? (
            <p>{Number(vendor.detail?.count || 0)} vendor price rows loaded.</p>
          ) : (
            <>
              <p>
                Drop your vendor order-guide files into the costing input folder,
                then run this from the install directory on the Mac:
              </p>
              <CommandBlock command="npm run ingest:costing" />
            </>
          )}
        </li>

        <li>
          <StepBadge complete={recipes.complete} optional={false} />{' '}
          <strong>Import recipes</strong>
          {recipes.complete ? (
            <p>{Number(recipes.detail?.count || 0)} recipes loaded.</p>
          ) : (
            <>
              <p>
                Load your recipe Data Pack, then run this from the install
                directory on the Mac:
              </p>
              <CommandBlock command="npm run ingest" />
            </>
          )}
        </li>

        <li>
          <StepBadge complete={toast.complete} optional />{' '}
          <strong>Connect Toast POS</strong> <em>(optional — requires Toast credentials)</em>
          {toast.complete ? (
            <p>Toast sales data detected.</p>
          ) : toastSkipped ? (
            <p>
              Skipped. You can connect Toast later once you have API
              credentials — sales-driven features stay dormant until then.
            </p>
          ) : (
            <>
              <p>
                Needs Toast API keys from your Toast account. Without them,
                skip this step — everything else works offline.
              </p>
              <button type="button" onClick={() => setToastSkipped(true)}>
                Skip for now
              </button>
            </>
          )}
        </li>

        <li>
          <StepBadge complete={live} optional={false} /> <strong>You&apos;re live</strong>
          {live ? (
            <p>
              All set. Open <a href="/today">Today</a> to run your first shift,
              and visit <a href="/install">Connect</a> to add this app to your
              iPads&apos; home screens.
            </p>
          ) : (
            <p>Finish the steps above and this flips on its own.</p>
          )}
        </li>
      </ol>

      <p style={{ marginTop: 24 }}>
        <button type="button" onClick={refresh}>Re-check status</button>
      </p>
    </main>
  );
}
