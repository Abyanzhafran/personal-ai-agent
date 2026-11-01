import type { ReactNode } from 'react';

interface FieldProps {
  /** id kontrol di dalamnya; teks pendukung memakai `${id}-supporting`. */
  id: string;
  label: ReactNode;
  supporting?: ReactNode;
  children: ReactNode;
}

/** Kelas bersama untuk kontrol outlined (input, textarea, select): radius 4, border `outline`. */
export const fieldControl =
  'box-border w-full rounded-[4px] border border-outline bg-transparent px-4 font-sans text-title text-on-surface placeholder:text-on-surface-variant';

/**
 * Bingkai field outlined dari mockup: label duduk di garis atas border dengan latar yang
 * menutup garis, teks pendukung di bawah. Latar label mengikuti `--field-bg` (default putih,
 * dialog menggantinya jadi `surface-container`) supaya cocok dengan permukaan di belakang field.
 */
export function Field({ id, label, supporting, children }: FieldProps) {
  return (
    <div className="min-w-0">
      <div className="relative">
        <label
          htmlFor={id}
          className="absolute -top-2 left-3 bg-[color:var(--field-bg,var(--color-surface-container-lowest))] px-1 text-label text-on-surface-variant"
        >
          {label}
        </label>
        {children}
      </div>
      {supporting ? (
        <div id={`${id}-supporting`} className="px-4 pt-1 text-label text-on-surface-variant">
          {supporting}
        </div>
      ) : null}
    </div>
  );
}
