import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Breadcrumb } from '@/components/shell/breadcrumb';
import { CommandPaletteTrigger } from '@/components/shell/command-palette-trigger';

export function Topbar({
  initials,
  displayName,
  email,
}: {
  initials: string;
  displayName: string;
  email: string;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface-elev px-6">
      <Breadcrumb />

      <div className="flex items-center gap-3">
        <CommandPaletteTrigger />

        <div className="flex items-center gap-2">
          <div className="hidden text-right sm:block">
            <div className="text-sm font-medium leading-tight text-ink">{displayName}</div>
            <div className="font-mono text-[11px] leading-tight text-ink-3">{email}</div>
          </div>
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
}
