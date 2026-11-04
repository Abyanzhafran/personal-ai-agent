import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

// Warna dari ReportStale/ReportClean/Report (mockup v2): info netral, peringatan kuning, bersih hijau.
const TONE = {
  info: { box: 'bg-surface-container', icon: 'text-primary', body: 'text-on-surface-variant' },
  warning: {
    box: 'bg-warning-container text-on-warning-container',
    icon: 'text-on-warning-container',
    body: '',
  },
  success: {
    box: 'bg-success-container text-on-success-container',
    icon: 'text-on-success-container',
    body: '',
  },
  error: {
    box: 'bg-error-container text-on-error-container',
    icon: 'text-on-error-container',
    body: '',
  },
} as const;

/** Kotak catatan di atas daftar laporan: ikon, judul (+ tanda mono opsional), dan isi. */
export function Callout({
  tone,
  icon: Icon,
  title,
  tag,
  children,
}: {
  tone: keyof typeof TONE;
  icon: LucideIcon;
  title: string;
  tag?: string;
  children?: ReactNode;
}) {
  const style = TONE[tone];
  return (
    <aside
      aria-label={title}
      className={cn('mb-6 flex items-start gap-3 rounded-md px-6 py-4', style.box)}
    >
      <Icon aria-hidden className={cn('size-6 shrink-0', style.icon)} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 font-medium">
          {title}
          {tag && <span className="font-mono text-code font-normal">{tag}</span>}
        </div>
        {children && <div className={cn('space-y-2', style.body)}>{children}</div>}
      </div>
    </aside>
  );
}
