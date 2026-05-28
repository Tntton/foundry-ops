import { redirect } from 'next/navigation';

/**
 * Budget watch was consolidated into the dashboard on 2026-05-07. This
 * file remains as a permanent redirect so old bookmarks / dashboard
 * links don't 404.
 */
export default function BudgetWatchRedirect() {
  redirect('/');
}
