import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Field, fieldControl } from './field';

type TextareaProps = Omit<ComponentProps<'textarea'>, 'id'> & {
  label: ReactNode;
  supporting?: ReactNode;
};

/** Textarea outlined tinggi 88, tidak bisa di-resize (mockup v2). */
export function Textarea({ label, supporting, className, ...props }: TextareaProps) {
  const id = useId();
  return (
    <Field id={id} label={label} supporting={supporting}>
      <textarea
        id={id}
        aria-describedby={supporting ? `${id}-supporting` : undefined}
        className={cn(fieldControl, 'h-22 resize-none py-3 leading-6', className)}
        {...props}
      />
    </Field>
  );
}
