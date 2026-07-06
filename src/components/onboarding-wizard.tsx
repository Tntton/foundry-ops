'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import type { OnboardingProfile } from '@/server/onboarding';
import { completeOnboarding } from '@/app/(app)/onboarding/actions';
import { Button } from '@/components/ui/button';

/**
 * First-login onboarding tour. Modal-style overlay mounted from the
 * app layout when Person.onboardingCompletedAt is null. Role-scoped
 * content built server-side (see server/onboarding.ts) — this
 * component is purely presentational.
 *
 * UX contract:
 *   - Backdrop click does NOT close (would look like an accidental
 *     dismiss on new-user first render). Only Finish / Skip persist
 *     the "dismissed" state.
 *   - Escape key = Skip (accessible dismissal).
 *   - Motion: 180ms fade on mount, no other animation. Institutional
 *     tool, not a consumer app.
 *   - Density: moderate. Single slide visible at a time, with 4 or 5
 *     slides in total per role.
 */
export function OnboardingWizard({ profile }: { profile: OnboardingProfile }) {
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const total = profile.slides.length;
  const slide = profile.slides[index]!;
  const isLast = index === total - 1;

  useEffect(() => {
    // Fade in on mount rather than pop.
    const t = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') dismiss('skipped');
      if (e.key === 'ArrowLeft' && index > 0) setIndex((i) => i - 1);
      if (e.key === 'ArrowRight' && !isLast) setIndex((i) => i + 1);
      if (e.key === 'ArrowRight' && isLast) dismiss('finished');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, isLast]);

  function dismiss(reason: 'finished' | 'skipped') {
    startTransition(async () => {
      await completeOnboarding(reason);
      setVisible(false);
    });
  }

  if (!visible) {
    return (
      <div
        aria-hidden
        className="fixed inset-0 z-50 bg-black/40 opacity-0"
      />
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 transition-opacity duration-200"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div className="w-full max-w-xl overflow-hidden border border-line bg-surface shadow-lg">
        {/* Header: role badge + skip. Left-aligned per taste rules. */}
        <div className="flex items-center justify-between border-b border-line px-6 py-3">
          <span className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
            Getting started · {formatRole(profile.role)}
          </span>
          <button
            type="button"
            onClick={() => dismiss('skipped')}
            disabled={pending}
            className="text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline"
          >
            Skip
          </button>
        </div>

        {/* Body */}
        <div className="min-h-[220px] px-6 py-6">
          <h2
            id="onboarding-title"
            className="text-xl font-semibold text-ink"
            style={{ fontFamily: 'Times New Roman, Times, serif' }}
          >
            {slide.title}
          </h2>
          <p className="mt-3 text-sm leading-6 text-ink-2">{slide.body}</p>
          {slide.links && slide.links.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {slide.links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => dismiss('finished')}
                  className="inline-flex items-center border border-line px-3 py-1 text-xs text-ink hover:border-brand hover:text-brand"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Footer: progress dots + Back / Next. */}
        <div className="flex items-center justify-between border-t border-line bg-surface-elev px-6 py-3">
          <div className="flex items-center gap-1.5" aria-hidden>
            {profile.slides.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  i === index ? 'bg-brand' : 'bg-line'
                }`}
              />
            ))}
            <span className="ml-2 text-[10px] text-ink-3 tabular-nums">
              {index + 1} / {total}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIndex((i) => i - 1)}
                disabled={pending}
              >
                Back
              </Button>
            )}
            {!isLast ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setIndex((i) => i + 1)}
                disabled={pending}
              >
                Next
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => dismiss('finished')}
                disabled={pending}
              >
                {pending ? 'Saving' : 'Finish'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatRole(role: string): string {
  switch (role) {
    case 'super_admin':
      return 'Super admin';
    case 'associate_partner':
      return 'Associate partner';
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}
