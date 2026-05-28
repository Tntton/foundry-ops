import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/**
 * Single source of truth for rendering a person's avatar across the
 * app. When `headshotUrl` is set, Radix's primitive uses it; if the
 * image fails to load or the URL is null/undefined/empty, the
 * `initials` fallback renders. One component to swap into every
 * `<Avatar><AvatarFallback>` site so headshots propagate uniformly
 * once they're imported / uploaded.
 *
 * The fallback colour stays brand-soft to match the existing initials
 * look — bg only shows when the headshot isn't set.
 */
export function PersonAvatar({
  initials,
  headshotUrl,
  className,
  fallbackClassName,
  alt,
  title,
}: {
  initials: string;
  headshotUrl?: string | null;
  className?: string;
  fallbackClassName?: string;
  alt?: string;
  /** Native `title` tooltip — useful on stacked team avatars where
   *  the surrounding label doesn't already name the person. */
  title?: string;
}) {
  return (
    <Avatar className={className} title={title}>
      {headshotUrl && (
        <AvatarImage
          src={headshotUrl}
          alt={alt ?? initials}
        />
      )}
      <AvatarFallback className={cn(fallbackClassName)}>
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
