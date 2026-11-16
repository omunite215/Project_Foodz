import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** The page grid: 1440 px wide at most, with the design's side margins at each breakpoint. */
export function PageContainer({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('mx-auto w-full max-w-[1440px] px-6 md:px-12 xl:px-[72px]', className)}
      {...props}
    />
  );
}
