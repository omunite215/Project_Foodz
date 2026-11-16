import { Award } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const TONES = {
  cuisine: 'bg-neutral-7 text-neutral-2',
  bestSeller: 'bg-tag-6-bg text-neutral-1',
  soldOut: 'bg-neutral-1 text-neutral-8',
} as const;

/** Small labels on the dish page: the cuisine, "Best seller", "Sold out today". */
export function DishChip({
  tone,
  children,
  className,
}: {
  tone: keyof typeof TONES;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-body-5 font-medium',
        TONES[tone],
        className,
      )}
    >
      {tone === 'bestSeller' ? <Award className="size-3.5 text-tag-6" aria-hidden /> : null}
      {children}
    </span>
  );
}
