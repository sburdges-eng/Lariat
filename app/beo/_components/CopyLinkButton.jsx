// @ts-nocheck - pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import { useState } from 'react';
export default function CopyLinkButton({ url }) {
  const [done, setDone] = useState(false);
  if (!url) return null;
  return (
    <button type="button" className="btn" data-print="false" onClick={async () => {
      try { const abs = new URL(url, window.location.origin).href; await navigator.clipboard.writeText(abs); setDone(true); setTimeout(() => setDone(false), 2000); } catch {}
    }}>{done ? 'Copied' : 'Copy client link'}</button>
  );
}
