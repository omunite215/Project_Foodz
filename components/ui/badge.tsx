import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/** A status chip: the words carry the meaning, the tint and icon only support them. */
const badgeVariants = cva(
  'inline-flex h-7 w-fit shrink-0 items-center gap-1.5 rounded-md px-2.5 text-body-5 font-medium whitespace-nowrap text-neutral-1 [&>svg]:pointer-events-none [&>svg]:size-3.5 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        success: 'bg-brand-soft [&>svg]:text-brand-strong',
        pending: 'bg-tag-6-bg [&>svg]:text-tag-6',
        neutral: 'bg-neutral-7 [&>svg]:text-neutral-3',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
);

function Badge({
  className,
  variant = 'neutral',
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
