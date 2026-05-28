import { redirect } from 'next/navigation';

/**
 * Team management was consolidated into the Team tab on the project
 * page on 2026-05-07. This file remains as a permanent redirect so old
 * bookmarks / links don't 404.
 */
export default function TeamEditRedirect({
  params,
}: {
  params: { code: string };
}) {
  redirect(`/projects/${params.code}`);
}
