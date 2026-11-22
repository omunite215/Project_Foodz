import * as React from 'react';
import { CircleExclamationPoint } from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * The parts of one form field (design 2.1): a visible label, the control 8 px below, then a hint
 * and an error in words. Errors are not live regions; the control points at them through
 * aria-describedby, so they are read when it is focused.
 */

function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>) {
  return <fieldset data-slot="field-set" className={cn('min-w-0', className)} {...props} />;
}

function FieldLegend({ className, ...props }: React.ComponentProps<'legend'>) {
  return (
    <legend
      data-slot="field-legend"
      className={cn('text-body-4 font-normal text-neutral-3', className)}
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    // The control is associated through htmlFor, supplied by the caller.
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      data-slot="field-label"
      className={cn('block text-body-4 leading-6 font-normal text-neutral-3', className)}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn('mt-2 text-body-5 text-muted-foreground', className)}
      {...props}
    />
  );
}

function FieldError({ className, children, ...props }: React.ComponentProps<'p'>) {
  if (!children) return null;
  return (
    <p
      data-slot="field-error"
      className={cn(
        'mt-2 flex items-start gap-1.5 text-body-5 text-destructive motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150',
        className,
      )}
      {...props}
    >
      <CircleExclamationPoint className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export { FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet };
