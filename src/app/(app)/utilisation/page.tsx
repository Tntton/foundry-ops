import { redirect } from 'next/navigation';

/**
 * Utilisation report was consolidated into /resource-planning on
 * 2026-05-07. This file remains as a permanent redirect so old
 * bookmarks / cross-links don't 404.
 */
export default function UtilisationRedirect() {
  redirect('/resource-planning');
}
