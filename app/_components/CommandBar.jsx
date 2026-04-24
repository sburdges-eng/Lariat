'use client';
import { useEffect, useState } from 'react';

/* Footer strip with the always-visible keyboard hints. Pure UI — the
   actual ⌘K binding lives in CommandPalette, and 1-6/8/0 bindings
   live in Sidebar. This is just the reminder. */

function isMac() {
  if (typeof navigator === 'undefined') return true;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
}

export default function CommandBar() {
  const [mod, setMod] = useState('⌘');
  useEffect(() => {
    setMod(isMac() ? '⌘' : 'Ctrl');
  }, []);

  return (
    <footer className="command" role="contentinfo">
      <div className="left">
        <span className="slot">
          <kbd>{mod}</kbd>
          <kbd>K</kbd>
          <span>Jump</span>
        </span>
        <span className="slot">
          <kbd>/</kbd>
          <span>Search</span>
        </span>
        <span className="slot">
          <kbd>1</kbd>–<kbd>6</kbd>
          <span>Stations</span>
        </span>
        <span className="slot">
          <kbd>8</kbd>
          <span className="accent">86</span>
        </span>
        <span className="slot">
          <kbd>M</kbd>
          <span>Map</span>
        </span>
      </div>
      <div className="right">
        <span className="slot">
          <span>The Lariat</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>v2</span>
        </span>
      </div>
    </footer>
  );
}
