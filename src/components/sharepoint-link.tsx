/**
 * OpenIn365 (TASK-069d) — a direct link into a SharePoint / OneDrive
 * file or folder, wherever the app holds a pointer. Opens in a new tab
 * under the user's own 365 session (no proxy). Renders **nothing** when
 * the url is absent, so callers can drop it in unconditionally without
 * leaving dead links. It only ever renders where the surrounding surface
 * has already authorised the user to see the underlying record, so it
 * adds no new exposure.
 *
 * Server-compatible (no client hooks) — safe to render in RSC.
 */
export function OpenIn365({
  url,
  label = 'Open in SharePoint',
  className,
}: {
  url: string | null | undefined;
  label?: string;
  className?: string;
}) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        'inline-flex items-center gap-1 text-sm text-brand underline hover:text-brand/80'
      }
    >
      {label} ↗
    </a>
  );
}
