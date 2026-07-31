'use client';

import Link from 'next/link';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import type { OnboardingProfile } from '@/server/onboarding';
import { completeOnboarding } from '@/app/(app)/onboarding/actions';
import { Button } from '@/components/ui/button';

/**
 * First-login onboarding tour. Mounted from the app layout when
 * Person.onboardingCompletedAt is null. Role-scoped content is built
 * server-side (see server/onboarding.ts).
 *
 * Each slide can name a live UI element via `spotlight` (a CSS
 * selector). When that element is on screen the wizard behaves like a
 * product coach-mark: it dims the page, cuts a highlight ring around
 * the real element, and anchors the card beside it — so the tour points
 * at the thing it is describing instead of only naming it. When the
 * target is absent (e.g. the collapsed sidebar on a phone, or a slide
 * with no `spotlight`) it falls back to a centred modal card.
 *
 * UX contract:
 *   - Backdrop / overlay click does NOT close (avoids accidental
 *     first-render dismiss). Only Finish / Skip persist the state.
 *   - Escape = Skip. Left / Right arrows move between slides.
 *   - Motion: a short fade in, and a 180ms ease as the ring moves
 *     between targets (disabled under prefers-reduced-motion).
 */

type Rect = { top: number; left: number; width: number; height: number };

export function OnboardingWizard({ profile }: { profile: OnboardingProfile }) {
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const total = profile.slides.length;
  const slide = profile.slides[index]!;
  const isLast = index === total - 1;

  const cardRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [side, setSide] = useState('');
  const [reduceMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  );

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

  // Locate + measure the slide's spotlight target. Re-measures on scroll
  // and resize so the ring tracks the element. Clears to null (centred
  // fallback) when there's no selector or the element isn't visible.
  useLayoutEffect(() => {
    const sel = slide.spotlight;
    if (!sel) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        setRect(null);
        return;
      }
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [slide.spotlight, index]);

  // Place the card beside the target: opposite the side the target sits
  // on, vertically centred to it, clamped into the viewport.
  useLayoutEffect(() => {
    if (!rect || !cardRef.current) {
      setPos(null);
      return;
    }
    const gap = 16;
    const pad = 12;
    const cw = cardRef.current.offsetWidth;
    const ch = cardRef.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const targetOnLeftHalf = rect.left + rect.width / 2 < vw / 2;
    let left = targetOnLeftHalf ? rect.left + rect.width + gap : rect.left - gap - cw;
    left = Math.max(pad, Math.min(left, vw - cw - pad));
    let top = rect.top + rect.height / 2 - ch / 2;
    top = Math.max(pad, Math.min(top, vh - ch - pad));
    setPos({ top, left });

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const h = cx < vw / 2 ? 'left' : 'right';
    setSide(cy > vh * 0.66 ? `bottom-${h}` : h);
  }, [rect, index]);

  function dismiss(reason: 'finished' | 'skipped') {
    startTransition(async () => {
      await completeOnboarding(reason);
      setVisible(false);
    });
  }

  const spotlighting = rect !== null;

  const cardBody = (
    <>
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
      <div className="px-6 py-6">
        <h2
          id="onboarding-title"
          className="text-xl font-semibold text-ink"
          style={{ fontFamily: 'Times New Roman, Times, serif' }}
        >
          {slide.title}
        </h2>
        <p className="mt-3 text-sm leading-6 text-ink-2">{slide.body}</p>
        {spotlighting && side && (
          <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-brand">
            Highlighted at the {side} of your screen
          </p>
        )}
        {slide.links && slide.links.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {slide.links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => dismiss('finished')}
                className="inline-flex items-center rounded-md border border-line px-3 py-1 text-xs text-ink hover:border-brand hover:text-brand"
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
    </>
  );

  const motion = reduceMotion
    ? undefined
    : 'top 180ms ease, left 180ms ease, width 180ms ease, height 180ms ease';

  // Spotlight mode: dim the page with a cut-out ring over the target and
  // anchor the card beside it.
  if (spotlighting && rect) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="fixed inset-0 z-50 transition-opacity duration-200"
        style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' }}
      >
        {/* Transparent layer captures clicks so the app stays inert
            during the tour; the dimming comes from the ring's shadow. */}
        <div className="absolute inset-0" aria-hidden />
        <div
          aria-hidden
          className="pointer-events-none"
          style={{
            position: 'fixed',
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            borderRadius: 8,
            boxShadow: '0 0 0 9999px rgba(15,20,25,0.55)',
            outline: '2px solid var(--brand)',
            outlineOffset: 2,
            transition: motion,
          }}
        />
        <div
          ref={cardRef}
          className="fixed w-[min(26rem,calc(100vw-1.5rem))] max-h-[calc(100vh-1.5rem)] overflow-y-auto rounded-lg border border-line bg-surface shadow-lg"
          style={{
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            visibility: pos ? 'visible' : 'hidden',
            transition: motion,
          }}
        >
          {cardBody}
        </div>
      </div>
    );
  }

  // Fallback: centred modal (no target on screen, or slide has none).
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 transition-opacity duration-200"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div
        ref={cardRef}
        className="w-full max-w-xl overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
      >
        {cardBody}
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
