// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

// UnmappedCallout — shared warning band for both EventOrderGuidePanel and
// EventPrepPanel (T9). Renders when unmapped items exist OR when the cascade
// engine returned an error string. Always visible alongside row data — never
// swaps in as an alternative state.
//
// Props:
//   unmapped          — array of { menu_item, reason } objects (may be empty)
//   error             — optional engine error string (may be undefined/null)
//   manifestWarnings  — array of { recipe, issue } — a declared sub-recipe no
//                       BOM row references (may under-order); event-scoped

export default function UnmappedCallout({ unmapped = [], error, manifestWarnings = [] }) {
  const hasUnmapped = Array.isArray(unmapped) && unmapped.length > 0;
  const hasError = Boolean(error);
  const hasManifestWarnings = Array.isArray(manifestWarnings) && manifestWarnings.length > 0;

  if (!hasUnmapped && !hasError && !hasManifestWarnings) return null;

  return (
    <div data-testid="event-cascade-unmapped" className="beo-unmapped-callout">
      {hasError && (
        <div className="beo-unmapped-error">
          <strong>Engine error:</strong> {error}
        </div>
      )}
      {hasManifestWarnings && (
        <>
          <div className="beo-unmapped-heading">
            Recipe data gaps — a declared sub-recipe is never referenced (may under-order):
          </div>
          <ul className="beo-unmapped-list" data-testid="event-cascade-manifest-warnings">
            {manifestWarnings.map((w, i) => (
              <li key={`${w.recipe}-${i}`} className="beo-unmapped-item">
                <strong>{w.recipe}</strong>
                {w.issue ? <span className="beo-unmapped-reason"> — {w.issue}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {hasUnmapped && (
        <>
          <div className="beo-unmapped-heading">
            Unmapped items — not included in cascade output:
          </div>
          <ul className="beo-unmapped-list">
            {unmapped.map((item, i) => (
              <li key={`${item.menu_item}-${i}`} className="beo-unmapped-item">
                <strong>{item.menu_item}</strong>
                {item.reason ? <span className="beo-unmapped-reason"> — {item.reason}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
