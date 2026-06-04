import { NextResponse } from 'next/server';
import { getSession } from '@/server/session';
import { resetActiveThread } from '@/server/agents/assistant/threads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/assistant/thread/reset — archive the user's current
 * active thread and open a fresh one. Used by the widget's reset
 * button.
 */
export async function POST(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const fresh = await resetActiveThread(session.person.id);
  return NextResponse.json({ threadId: fresh.id });
}
