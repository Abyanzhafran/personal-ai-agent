import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

// Tabel semantik. Header latar `surface-container`, baris tinggi minimal 56 dengan garis
// `divider` (kolom Checks di mockup v2). Pembungkus kartu (border, radius) milik pemanggil.
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-left text-body', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead className={cn('bg-surface-container text-on-surface-variant', className)} {...props} />
  );
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr]:border-t [&_tr]:border-divider', className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('hover:bg-surface-container', className)} {...props} />;
}

export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return <th className={cn('h-12 px-5 text-label font-medium', className)} {...props} />;
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('h-14 px-5 text-on-surface', className)} {...props} />;
}
