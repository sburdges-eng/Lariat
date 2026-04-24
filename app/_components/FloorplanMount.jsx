'use client';

/**
 * Opener + mounter for the Floorplan spatial navigator.
 *
 * Keeps the heavy SVG component unmounted until the user actually presses
 * "M" (or Ctrl/Cmd+M) or clicks the rib button. We render a small FAB-style
 * trigger in the corner — consistent with the cockpit's paper aesthetic,
 * not a "floating AI button".
 */

import { useCallback, useEffect, useState } from 'react';
import Floorplan from './Floorplan.jsx';

export default function FloorplanMount() {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (e) => {
      // Ignore modifier-laden shortcuts that belong to the browser/OS.
      if (e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.target && e.target.isContentEditable) return;

      // Ctrl/Cmd+M or a bare "M" outside inputs toggles the floorplan.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggle();
        return;
      }
      if (!e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return (
    <>
      <button
        type="button"
        className="floorplan-trigger"
        onClick={toggle}
        aria-label="Open kitchen floorplan navigator"
        aria-expanded={open}
        title="Kitchen floorplan — press M"
      >
        <svg viewBox="0 0 28 28" aria-hidden>
          {/* A minimal floor-plan glyph: rooms + an ember dot */}
          <rect x="3.5" y="3.5" width="21" height="21" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <line x1="14" y1="3.5" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2" />
          <line x1="14" y1="14" x2="24.5" y2="14" stroke="currentColor" strokeWidth="1.2" />
          <line x1="3.5" y1="19" x2="14" y2="19" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="19" cy="19" r="2" fill="var(--ember)" />
        </svg>
        <span className="floorplan-trigger-lbl">Floor · <kbd>M</kbd></span>
      </button>
      <Floorplan open={open} onClose={close} />
    </>
  );
}
