// @ts-check
'use client';
import { useState } from 'react';

/**
 * @param {{ url?: string | null }} props
 */
export default function CopyLinkButton({ url }) {
  const [done, setDone] = useState(false);
  if (!url) return null;
  return (
    <button type="button" className="btn" data-print="false" onClick={async () => {
      try { const abs = new URL(url, window.location.origin).href; await navigator.clipboard.writeText(abs); setDone(true); setTimeout(() => setDone(false), 2000); } catch {}
    }}>{done ? 'Copied' : 'Copy client link'}</button>
  );
}
