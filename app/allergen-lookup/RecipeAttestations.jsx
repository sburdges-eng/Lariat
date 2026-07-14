// @ts-check
'use client';

// House-recipe allergen attestation panel — roadmap 3.3.
//
// The product lookup above answers "does this PRODUCT contain X?". This
// section answers the house-recipe version AND shows whether the answer
// carries manager signoff: every recipe's allergen list renders with a
// status chip —
//   - Verified <date> by <who>       (manager attested, recipe unchanged)
//   - From ingredients — not verified (guessed from ingredient names only)
//   - Stale — recipe changed          (attested, but composition edited since)
//
// The "Attest" affordance POSTs the current allergen list with a note.
// The endpoint is manager-PIN-gated server-side; a 401 here surfaces a
// "manager PIN required" message rather than hiding the button, matching
// the fail-loud posture of the product cards above.

import { useEffect, useState } from 'react';

/**
 * @typedef {Object} AttestationMeta
 * @property {number} id
 * @property {string[]} allergens
 * @property {string} attested_by
 * @property {string | null} note
 * @property {string} created_at
 */

/**
 * @typedef {Object} RecipeStatus
 * @property {string} recipe_slug
 * @property {string} name
 * @property {string[]} heuristic_allergens
 * @property {'unattested' | 'attested' | 'stale'} status
 * @property {AttestationMeta | null} latest
 */

/** @param {string} ts */
function fmtTs(ts) {
  return ts.replace('T', ' ').slice(0, 16);
}

/** @param {{ recipe: RecipeStatus }} props */
function StatusChip({ recipe }) {
  const base = {
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
  };
  if (recipe.status === 'attested' && recipe.latest) {
    return (
      <span
        aria-label={`Allergens verified ${fmtTs(recipe.latest.created_at)} by ${recipe.latest.attested_by}`}
        style={{
          ...base,
          background: 'var(--panel-2)',
          border: '1px solid var(--accent)',
          color: 'var(--accent)',
        }}
      >
        ✓ verified {fmtTs(recipe.latest.created_at)} by {recipe.latest.attested_by}
      </span>
    );
  }
  if (recipe.status === 'stale' && recipe.latest) {
    return (
      <span
        aria-label="Attestation stale — recipe changed since manager signoff"
        style={{
          ...base,
          background: 'transparent',
          border: '1px dashed var(--ember)',
          color: 'var(--ember-deep, var(--ember))',
        }}
      >
        ⚠ stale — recipe changed since {fmtTs(recipe.latest.created_at)} ({recipe.latest.attested_by})
      </span>
    );
  }
  return (
    <span
      aria-label="Allergen list guessed from ingredients, not manager-verified"
      style={{
        ...base,
        background: 'transparent',
        border: '1px dashed var(--muted)',
        color: 'var(--muted)',
      }}
    >
      from ingredients — not verified
    </span>
  );
}

/** @param {{ tag: string }} props */
function RecipeAllergenChip({ tag }) {
  return (
    <span
      aria-label={`Allergen: ${tag}`}
      style={{
        padding: '2px 8px',
        background: 'var(--ember)',
        border: '1px solid var(--ember)',
        borderRadius: 12,
        fontSize: 11,
        color: '#fff',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {tag}
    </span>
  );
}

export default function RecipeAttestations() {
  const [rows, setRows] = useState(/** @type {RecipeStatus[] | null} */ (null));
  const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
  const [filter, setFilter] = useState('');
  const [openSlug, setOpenSlug] = useState(/** @type {string | null} */ (null));
  const [attestBy, setAttestBy] = useState('');
  const [attestNote, setAttestNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));

  useEffect(() => {
    let alive = true;
    fetch('/api/allergens/attestations')
      .then(async (res) => {
        if (!alive) return;
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setLoadError((body && body.error) || `HTTP ${res.status}`);
          return;
        }
        setRows(Array.isArray(body?.recipes) ? body.recipes : []);
      })
      .catch((err) => {
        if (alive) setLoadError(`Network error: ${err?.message ?? String(err)}`);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** @param {RecipeStatus} recipe */
  async function submitAttestation(recipe) {
    setSubmitting(true);
    setSubmitError(null);
    let res;
    try {
      res = await fetch('/api/allergens/attestations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: recipe.recipe_slug,
          allergens: recipe.heuristic_allergens,
          attested_by: attestBy,
          note: attestNote || undefined,
        }),
      });
    } catch (err) {
      setSubmitting(false);
      setSubmitError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const body = await res.json().catch(() => null);
    setSubmitting(false);
    if (res.status === 401) {
      setSubmitError('Manager PIN required — sign in at /login-pin first.');
      return;
    }
    if (!res.ok) {
      setSubmitError((body && body.error) || `HTTP ${res.status}`);
      return;
    }
    const updated = body?.recipe;
    if (updated) {
      setRows((prev) =>
        prev
          ? prev.map((r) => (r.recipe_slug === updated.recipe_slug ? updated : r))
          : prev,
      );
    }
    setOpenSlug(null);
    setAttestNote('');
  }

  const visible =
    rows === null
      ? []
      : rows.filter((r) => {
          const q = filter.trim().toLowerCase();
          if (!q) return true;
          return (
            r.name.toLowerCase().includes(q) || r.recipe_slug.toLowerCase().includes(q)
          );
        });

  return (
    <div style={{ marginTop: 40 }}>
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>House recipe allergens</h2>
      <p className="subtitle" style={{ marginBottom: 16 }}>
        Allergen lists below are guessed from ingredients until a manager
        checks them. Stale means the recipe changed after the last check.
      </p>

      {loadError && (
        <div
          style={{
            padding: 16,
            background: 'var(--panel-2)',
            border: '1px solid var(--ember)',
            borderRadius: 6,
            color: 'var(--ember-deep, var(--ember))',
            fontSize: 13,
          }}
        >
          {loadError}
        </div>
      )}

      {!loadError && rows === null && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading recipes…</div>
      )}

      {rows !== null && rows.length === 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          No house recipes are ingested on this Mac.
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter recipes…"
            aria-label="Filter house recipes"
            autoComplete="off"
            style={{
              width: '100%',
              padding: '8px 12px',
              marginBottom: 12,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 13,
            }}
          />

          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {visible.map((recipe) => (
              <li
                key={recipe.recipe_slug}
                style={{
                  padding: 12,
                  marginBottom: 8,
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{recipe.name}</span>
                  <StatusChip recipe={recipe} />
                </div>

                <div
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}
                >
                  {recipe.heuristic_allergens.length === 0 ? (
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      no allergens flagged
                    </span>
                  ) : (
                    recipe.heuristic_allergens.map((tag) => (
                      <RecipeAllergenChip key={tag} tag={tag} />
                    ))
                  )}
                </div>

                {openSlug === recipe.recipe_slug ? (
                  <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                    <input
                      type="text"
                      value={attestBy}
                      onChange={(e) => setAttestBy(e.target.value)}
                      placeholder="Manager name (required)"
                      aria-label="Attesting manager name"
                      autoComplete="off"
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                        fontSize: 13,
                      }}
                    />
                    <input
                      type="text"
                      value={attestNote}
                      onChange={(e) => setAttestNote(e.target.value)}
                      placeholder="Note (optional)"
                      aria-label="Attestation note"
                      autoComplete="off"
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                        fontSize: 13,
                      }}
                    />
                    {submitError && (
                      <div style={{ fontSize: 12, color: 'var(--ember-deep, var(--ember))' }}>
                        {submitError}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        disabled={submitting || !attestBy.trim()}
                        onClick={() => submitAttestation(recipe)}
                        style={{
                          padding: '6px 14px',
                          background: 'var(--ember)',
                          border: '1px solid var(--ember)',
                          borderRadius: 6,
                          color: '#fff',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: submitting || !attestBy.trim() ? 'not-allowed' : 'pointer',
                          opacity: submitting || !attestBy.trim() ? 0.65 : 1,
                        }}
                      >
                        {submitting ? 'Saving…' : 'Confirm attestation'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenSlug(null);
                          setSubmitError(null);
                        }}
                        style={{
                          padding: '6px 14px',
                          background: 'var(--panel-2)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          color: 'var(--text)',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenSlug(recipe.recipe_slug);
                        setSubmitError(null);
                      }}
                      style={{
                        padding: '6px 14px',
                        background: 'var(--panel-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text)',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Attest allergen list (manager)
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
