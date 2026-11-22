import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The Figma Text Field: 44 px tall, 12 px corners, 16 px text (iPhone never zooms into it).
 * Read-only and disabled fields stay readable (no faded opacity).
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-11 w-full min-w-0 rounded-xl border border-input bg-white px-5 text-body-4 text-neutral-2 transition-colors outline-none placeholder:text-muted-foreground autofill:shadow-[inset_0_0_0_1000px_white] hover:border-neutral-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 read-only:border-neutral-6 read-only:bg-neutral-7 read-only:text-neutral-3 disabled:cursor-not-allowed disabled:border-neutral-6 disabled:bg-neutral-7 disabled:text-neutral-3',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
