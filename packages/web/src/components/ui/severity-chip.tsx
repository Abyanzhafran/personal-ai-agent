import type { CheckStatus, Kind, Severity } from '@cc/shared';
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';
import { Chip } from './chip';

/**
 * Nilai yang punya chip, memakai kosakata domain (`@cc/shared`) supaya pemanggil bisa
 * meneruskan `severity` finding atau `status` check langsung. Teks tampilannya ("Bersih",
 * "Dibatalkan", "Gagal", "3 break", ...) datang dari `children`.
 */
export type ChipSeverity =
  Severity | Extract<CheckStatus, 'clean' | 'failed' | 'cancelled'> | Extract<Kind, 'spec_stale'>;

// Warna dan ikon dari Checks.dc.html dan ReportStale.dc.html (mockup v2).
const STYLES: Record<ChipSeverity, { className: string; Icon?: LucideIcon }> = {
  break: { className: 'bg-error-container text-on-error-container', Icon: CircleAlert },
  warn: { className: 'bg-warning-container text-on-warning-container', Icon: TriangleAlert },
  info: { className: 'bg-info-container text-on-info-container', Icon: Info },
  clean: { className: 'bg-success-container text-on-success-container', Icon: CircleCheck },
  spec_stale: {
    className: 'bg-warning-container font-mono text-on-warning-container',
    Icon: TriangleAlert,
  },
  cancelled: { className: 'bg-neutral-container text-on-surface-variant' },
  failed: { className: 'bg-error-container text-on-error-container' },
};

export function SeverityChip({
  severity,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Chip>, 'tone'> & { severity: ChipSeverity }) {
  const { className: tone, Icon } = STYLES[severity];
  return (
    <Chip className={cn(tone, className)} data-severity={severity} {...props}>
      {Icon ? <Icon aria-hidden /> : null}
      {children}
    </Chip>
  );
}
