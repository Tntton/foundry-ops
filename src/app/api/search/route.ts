import { NextResponse } from 'next/server';
import { getSession } from '@/server/session';
import { globalSearch } from '@/server/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ results: [] });

  const results = await globalSearch(q, session);
  return NextResponse.json({ results });
}
