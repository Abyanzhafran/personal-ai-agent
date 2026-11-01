import { ChevronDown } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Field, fieldControl } from './field';

type SelectProps = Omit<ComponentProps<'select'>, 'id'> & {
  label: ReactNode;
  supporting?: ReactNode;
};

// `<select>` native, seperti di mockup: keyboard, pembaca layar, dan daftar opsi disediakan
// browser. Opsi diberikan sebagai anak (`<option>`).
export function Select({ label, supporting, className, children, ...props }: SelectProps) {
  const id = useId();
  return (
    <Field id={id} label={label} supporting={supporting}>
      <select
        id={id}
        aria-describedby={supporting ? `${id}-supporting` : undefined}
        className={cn(fieldControl, 'h-14 appearance-none pr-11', className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-4 right-3 size-6 text-on-surface-variant"
      />
    </Field>
  );
}
