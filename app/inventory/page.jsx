import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function InventoryPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const loc = typeof sp?.location === 'string' && sp.location.trim() ? sp.location.trim() : null;
  redirect(loc ? `/inventory/counts?location=${encodeURIComponent(loc)}` : '/inventory/counts');
}
