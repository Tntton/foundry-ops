import { NextResponse } from 'next/server';
import { getSession } from '@/server/session';
import {
  getOrCreateActiveThread,
  listThreadMessages,
} from '@/server/agents/assistant/threads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/assistant/thread — return the user's active thread + its
 * messages so the widget can hydrate on mount / reload. Creates the
 * thread lazily so a brand-new user's first GET still returns a valid
 * (empty) shape.
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const thread = await getOrCreateActiveThread(session.person.id);
  const messages = await listThreadMessages(thread.id);
  return NextResponse.json({
    threadId: thread.id,
    createdAt: thread.createdAt.toISOString(),
    turnCount: thread.turnCount,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}
