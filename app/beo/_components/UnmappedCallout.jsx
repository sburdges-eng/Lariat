// @ts-check
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
//   warnings          — array of plain strings — a recipe was skipped (bad unit
//                       / unknown sub / cycle), so order + prep may be short

/** @typedef {import('../../../lib/beoCascade').UnmappedRow} UnmappedRow */
/** @typedef {import('../../../lib/beoCascade').ManifestWarningRow} ManifestWarningRow */

/**
 * @param {{
 *   unmapped?: UnmappedRow[],
 *   error?: string | null,
 *   manifestWarnings?: ManifestWarningRow[],
 *   warnings?: string[],
 * }} props
 */
export default function UnmappedCallout({ unmapped = [], error, manifestWarnings = [], warnings = [] }) {
  const hasUnmapped = Array.isArray(unmapped) && unmapped.length > 0;
  const hasError = Boolean(error);
  const hasManifestWarnings = Array.isArray(manifestWarnings) && manifestWarnings.length > 0;
  const hasWarnings = Array.isArray(warnings) && warnings.length > 0;

  if (!hasUnmapped && !hasError && !hasManifestWarnings && !hasWarnings) return null;

  return (
    <div data-testid="event-cascade-unmapped" className="beo-unmapped-callout">
      {hasError && (
        <div className="beo-unmapped-error">
          <strong>Engine error:</strong> {error}
        </div>
      )}
      {hasWarnings && (
        <>
          <div className="beo-unmapped-heading">
            Some recipes were skipped — order and prep may be short:
          </div>
          <ul className="beo-unmapped-list" data-testid="event-cascade-warnings">
            {warnings.map((w, i) => (
              <li key={`warn-${i}`} className="beo-unmapped-item">{w}</li>
            ))}
          </ul>
        </>
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
