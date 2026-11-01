import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Skala teks kita (`text-body`, `text-label`, ...) adalah ukuran font. Tanpa daftar ini
// tailwind-merge menganggapnya warna teks dan membuang `text-on-surface` di sebelahnya.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ['headline', 'title', 'body', 'label', 'code'] } },
});

/** Gabungkan kelas kondisional; kelas Tailwind yang bentrok dimenangkan yang terakhir. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
