import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Field, fieldControl } from './field';

type TextFieldProps = Omit<ComponentProps<'input'>, 'id'> & {
  label: ReactNode;
  supporting?: ReactNode;
};

/** Input outlined tinggi 56 dengan label di garis atas (mockup v2). */
export function TextField({ label, supporting, className, ...props }: TextFieldProps) {
  const id = useId();
  return (
    <Field id={id} label={label} supporting={supporting}>
      <input
        id={id}
        aria-describedby={supporting ? `${id}-supporting` : undefined}
        className={cn(fieldControl, 'h-14', className)}
        {...props}
      />
    </Field>
  );
}
