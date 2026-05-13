// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

/**
 * UX polish activator.
 *
 * Pulls in /styles/ux-polish.css (additive accessibility, motion,
 * safe-area, print, form-consistency, and mobile touch-target rules)
 * without modifying globals.css. Render this once in the root layout.
 *
 * Intentionally a minimal, standalone file so it stays out of the way
 * of other agents editing shared components.
 */

import '../../styles/ux-polish.css';

export default function UxPolishMount() {
  // Also injects a permanent skip-to-content link at the top of the DOM.
  // Uses the native anchor: no JS, no state, no dependencies.
  return (
    <a href="#main-content" className="skip-link">
      Skip to content
    </a>
  );
}
