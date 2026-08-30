import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props */
export default async function InventoryPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const loc = typeof sp?.location === 'string' && sp.location.trim() ? sp.location.trim() : null;
  redirect(loc ? `/inventory/counts?location=${encodeURIComponent(loc)}` : '/inventory/counts');
}
