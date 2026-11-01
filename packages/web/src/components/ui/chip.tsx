import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

// Chip 24 px, radius 8, teks 12/16 medium (mockup v2). Ikon (svg anak langsung) 14 px.
export const chipVariants = cva(
  'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-sm px-2 text-label font-medium [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'bg-neutral-container text-on-surface-variant',
        tonal: 'bg-secondary-container text-on-secondary-container',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Chip({
  tone,
  className,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof chipVariants>) {
  return <span className={cn(chipVariants({ tone }), className)} {...props} />;
}
