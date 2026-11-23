import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/*
 * One message for a whole form (errors, results, notices). Not a live region: the text is read
 * once through the site's announcer (lib/announce), so it is never read twice.
 */
const alertVariants = cva(
  'flex w-full items-start gap-3 rounded-xl p-4 text-left text-body-5 text-neutral-1 md:text-body-4 [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        error: 'bg-tag-4-bg [&>svg]:text-destructive',
        success: 'bg-brand-soft [&>svg]:text-brand-strong',
        info: 'bg-neutral-7 [&>svg]:text-neutral-3',
        warning: 'bg-tag-6-bg [&>svg]:text-warning-strong',
      },
    },
    defaultVariants: {
      variant: 'info',
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'min-w-0 flex-1 [overflow-wrap:anywhere] [&_a]:font-medium [&_a]:text-inherit [&_a]:underline [&_a]:underline-offset-4',
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertDescription, alertVariants };
