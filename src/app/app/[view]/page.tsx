import { redirect, notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { dataFor } from '@/lib/service';
import { Terminal } from '@/components/terminal';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<{ portfolio?: string }>;
}) {
  const { view } = await params;
  if (
    !['portfolio', 'markets', 'watchlists', 'risk', 'rebalance', 'activity', 'settings'].includes(
      view,
    )
  )
    notFound();
  const s = await requireSession().catch(() => null);
  if (!s) redirect('/sign-in');
  return (
    <Terminal initial={await dataFor(s.workspaceId, (await searchParams).portfolio)} view={view} />
  );
}
