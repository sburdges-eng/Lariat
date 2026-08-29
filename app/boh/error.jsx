// @ts-check
'use client';

// Anything that throws while a sheet renders stops here.
//
// The line book is reference paper. A cook mid-service must never get a
// blank screen out of it — they get a plain sentence, a way to retry, and a
// way back to the book, plus the one instruction that actually helps on a
// line: go get the paper packet.

import Link from 'next/link';
import { useEffect } from 'react';
import { BOH_BASE } from '../../lib/boh/helpers.ts';
import { useT } from '../_components/I18nProvider.jsx';

/**
 * @param {{ error: Error & { digest?: string }, reset: () => void }} props
 */
export default function BohError({ error, reset }) {
  const tt = useT();

  useEffect(() => {
    // Surfaced in the browser console and the server log for whoever picks
    // this up later; the cook never sees it.
    console.error('[boh] sheet failed to render', error);
  }, [error]);

  return (
    <div className="boh-sheet">
      <div className="boh-sheet-top">
        <Link href={BOH_BASE} className="boh-back">
          ← {tt('boh.backToBook')}
        </Link>
        <h1>{tt('boh.sheetBroke')}</h1>
        <p className="boh-sheet-date">{tt('boh.sheetBrokeHelp')}</p>
      </div>
      <div className="boh-actions">
        <button type="button" className="btn primary" onClick={reset}>
          {tt('boh.tryAgain')}
        </button>
        <Link href={BOH_BASE} className="btn">
          {tt('boh.title')}
        </Link>
      </div>
    </div>
  );
}
