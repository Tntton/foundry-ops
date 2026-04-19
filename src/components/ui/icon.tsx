import type { LucideIcon, LucideProps } from 'lucide-react';
import { cn } from '@/lib/utils';

export type IconProps = LucideProps & {
  icon: LucideIcon;
};

export function Icon({ icon: IconComp, className, ...props }: IconProps) {
  return <IconComp className={cn('h-4 w-4', className)} {...props} />;
}
