// @ts-check
// One sheet from the line book. The server resolves the slug and hands the
// sheet to the board; everything the cook ticks or writes is client-side
// and device-local (see SheetBoard).
//
// No database access anywhere in this route — the sheets are reference
// paper and must still open when SQLite is down.

import { notFound } from 'next/navigation';
import { getSheet, serviceDateISO } from '../../../lib/boh/index.ts';
import SheetBoard from './SheetBoard.jsx';

export const dynamic = 'force-dynamic';

/**
 * @param {{ params: Promise<{ sheet: string }> | { sheet: string } }} props
 */
export default async function BohSheetPage({ params }) {
  const { sheet: slug } = await params;
  const sheet = getSheet(slug);
  if (!sheet) notFound();

  return <SheetBoard sheet={sheet} serviceDate={serviceDateISO()} />;
}
