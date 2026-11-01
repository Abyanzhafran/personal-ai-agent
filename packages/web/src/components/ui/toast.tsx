import { Toaster as Sonner, toast, type ToasterProps } from 'sonner';

export { toast };

// Toast memakai sonner (dipilih shadcn/ui). Sonner menaruh teks bawaan Inggris pada wadahnya
// ("Notifications alt+T"), jadi nama aksesibel wadah wajib diberikan pemanggil.
type Props = Omit<ToasterProps, 'containerAriaLabel'> & { containerAriaLabel: string };

/** Pasang satu kali di akar aplikasi; panggil `toast(...)` dari mana saja. */
export function Toaster(props: Props) {
  return (
    <Sonner
      theme="light"
      position="bottom-center"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-[356px] max-w-full items-center gap-3 rounded-md bg-on-surface px-4 py-3 font-sans text-body text-surface shadow-lg',
          title: 'font-medium',
          description: 'text-label',
        },
      }}
      {...props}
    />
  );
}
