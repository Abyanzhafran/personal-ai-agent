import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

// Ukuran dari mockup v2: tombol biasa tinggi 40 radius 20; tombol utama form tinggi 56 radius 28.
// Ikon (svg anak langsung) menggeser padding kiri, seperti `padding: 0 24px 0 16px` di mockup.
export const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap font-sans text-body font-medium transition-[filter] hover:brightness-[0.94] disabled:pointer-events-none disabled:opacity-[0.38] [&_svg]:size-[18px] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        filled: 'bg-primary text-on-primary',
        tonal: 'bg-secondary-container text-on-secondary-container',
        outlined: 'border border-outline bg-transparent text-primary',
        text: 'bg-transparent text-primary',
      },
      size: {
        default: 'h-10 rounded-lg px-6 has-[>svg]:pl-4',
        large: 'h-14 rounded-xl px-7 has-[>svg]:pl-5',
      },
    },
    compoundVariants: [
      // Tombol teks (mis. "Batal" di dialog) lebih sempit: `padding: 0 12px`.
      { variant: 'text', size: 'default', class: 'px-3 has-[>svg]:pl-3' },
    ],
    defaultVariants: { variant: 'filled', size: 'default' },
  },
);

export function Button({
  variant,
  size,
  className,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
