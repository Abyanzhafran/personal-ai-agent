import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** Rel navigasi 80 px di kiri. Logo, spacer, dan pengalih bahasa dirangkai app shell. */
export function NavRail({ className, ...props }: ComponentProps<'nav'>) {
  return (
    <nav
      className={cn('flex w-20 flex-none flex-col items-center gap-3 pt-5 pb-6', className)}
      {...props}
    />
  );
}

type NavRailItemProps = ComponentProps<'a'> & {
  /** Tujuan aktif: pil `secondary-container` di belakang ikon, label tebal, `aria-current="page"`. */
  active?: boolean;
  icon: ReactNode;
};

export function NavRailItem({ active, icon, children, className, ...props }: NavRailItemProps) {
  return (
    <a
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-20 flex-col items-center gap-1 py-1.5',
        active ? 'text-on-surface' : 'text-on-surface-variant',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'flex h-8 w-14 items-center justify-center rounded-full [&_svg]:size-6',
          active && 'bg-secondary-container text-on-secondary-container',
        )}
      >
        {icon}
      </span>
      <span className={cn('text-label', active ? 'font-bold' : 'font-medium')}>{children}</span>
    </a>
  );
}
