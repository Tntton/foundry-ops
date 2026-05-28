'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Soft auto-refresh at the next Sunday → Monday boundary so calendar /
 * date-driven views (availability, resource planning, dashboard, time
 * sheet) roll forward to the new period without the user manually
 * reloading. AU convention is Mon-Sun weeks, so the cut is local
 * Monday 00:00 — i.e. the moment Sunday ends.
 *
 * Mounted once in the app layout. Sets a single timeout to the next
 * Monday 00:01 (one minute past midnight to dodge timezone edge cases)
 * and triggers `router.refresh()` — a server re-render rather than a
 * full reload, so client state on the page is preserved.
 */
export function PeriodAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 Sun .. 6 Sat
    // Days until next Monday: if today is Mon (1), 7; otherwise (8 - dow) % 7,
    // mapped so Sunday → 1, Saturday → 2, Friday → 3, etc.
    let daysToMonday = (8 - dayOfWeek) % 7;
    if (daysToMonday === 0) daysToMonday = 7;
    const target = new Date(now);
    target.setDate(now.getDate() + daysToMonday);
    target.setHours(0, 1, 0, 0);
    const ms = target.getTime() - now.getTime();
    if (ms <= 0) return;
    const handle = window.setTimeout(() => {
      router.refresh();
    }, ms);
    return () => window.clearTimeout(handle);
  }, [router]);
  return null;
}
