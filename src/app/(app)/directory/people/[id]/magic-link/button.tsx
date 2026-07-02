'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  generateMagicLinkForPerson,
  type MagicLinkGenState,
} from './actions';

/**
 * Super-admin only. On click: mints a magic-link URL for the person,
 * emails it to them via Resend, AND surfaces the URL in the UI for
 * copy/paste (super-admin escape hatch — the link is single-use,
 * expires in 15 min, and every issuance is audited).
 */
export function MagicLinkButton({ personId, personEmail }: { personId: string; personEmail: string }) {
  const bound = generateMagicLinkForPerson.bind(null, personId);
  const [state, action] = useFormState<MagicLinkGenState, FormData>(bound, { status: 'idle' });
  const [copied, setCopied] = useState(false);

  const url = state.status === 'success' ? state.url : null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (unsecured context / user gesture policy)
      // — fallback to selecting the visible text. Non-blocking.
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <form action={action}>
        <SubmitBtn hasResult={state.status === 'success'} />
      </form>

      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}

      {state.status === 'success' && (
        <div className="w-full max-w-2xl space-y-2 rounded-md border border-status-amber bg-status-amber-soft/40 px-3 py-3 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <strong className="text-status-amber">Sign-in link — shown once</strong>
            <span className="text-[11px] text-ink-3">
              expires {new Date(state.expiresAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code
              className="min-w-0 flex-1 truncate rounded border border-line bg-white px-2 py-1 font-mono text-[11px] text-ink"
              title={url ?? undefined}
            >
              {url}
            </code>
            <Button type="button" size="sm" variant="outline" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-[11px] text-ink-2">
            Also emailed to <span className="font-mono">{personEmail}</span>
            {state.emailStatus === 'failed' && (
              <>
                {' '}
                — <strong className="text-status-red">delivery failed</strong>
                {state.emailError ? ` (${state.emailError})` : ''}. Copy the link and share it via another channel.
              </>
            )}
            . Single-use · 15-minute TTL · refreshing this page hides the link.
          </p>
        </div>
      )}
    </div>
  );
}

function SubmitBtn({ hasResult }: { hasResult: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending
        ? 'Generating…'
        : hasResult
        ? 'Generate new link'
        : 'Send magic link'}
    </Button>
  );
}
