import * as ProgressPrimitive from '@radix-ui/react-progress';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

/**
 * Bilah 4 px (mockup v2). Radix memberi `role="progressbar"` dan `aria-valuenow`; nama
 * aksesibelnya (`aria-label`) diberikan pemanggil.
 */
export function Progress({
  className,
  value,
  max = 100,
  ...props
}: ComponentProps<typeof ProgressPrimitive.Root>) {
  const percent = value == null ? 0 : (value / max) * 100;
  return (
    <ProgressPrimitive.Root
      value={value}
      max={max}
      className={cn('h-1 overflow-hidden rounded-[2px] bg-secondary-container', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full bg-primary transition-transform"
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
