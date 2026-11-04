import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useRef, type ComponentProps } from 'react';
import { cn } from '../../lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

// Permukaan `surface-container`, lebar 560 (artboard Project baru). Tidak ada tombol tutup
// bawaan: Esc dan klik di luar ditangani Radix, tombol "Batal" dipasang pemanggil lewat DialogClose.
export function DialogContent({
  className,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  // Radix hanya mengembalikan fokus ke DialogTrigger. Dialog yang dibuka dari tombol biasa
  // (state `open` di pemanggil) tidak punya trigger, jadi elemen yang berfokus saat dibuka diingat.
  const opener = useRef<Element | null>(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 bg-on-surface/32" />
      <DialogPrimitive.Content
        onOpenAutoFocus={(event) => {
          opener.current = document.activeElement;
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          const target = opener.current;
          if (
            !event.defaultPrevented &&
            target instanceof HTMLElement &&
            target !== document.body
          ) {
            event.preventDefault();
            target.focus();
          }
        }}
        className={cn(
          'fixed top-1/2 left-1/2 w-[560px] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface-container p-6 text-on-surface [--field-bg:var(--color-surface-container)]',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('m-0 mb-6 text-[24px] leading-8 font-normal', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-label text-on-surface-variant', className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mt-7 flex justify-end gap-2', className)} {...props} />;
}
