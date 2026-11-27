import { Star } from 'lucide-react';
import { starsCount, starsLabel } from '@/lib/rating-text';
import { cn } from '@/lib/utils';

/*
 * Five read-only stars at 16 px (design 2.8, 3.10, 3.16), in the customer input's colours: a
 * filled star is amber with a dark amber edge (3:1 against white), an empty one a grey outline.
 * The stars are hidden from screen readers; the words beside them say it.
 */

export function StarsDisplay({
  stars,
  withWord = false,
  className,
}: {
  stars: number;
  /** The spoken text adds the star word: "3 stars, OK" rather than "3 stars". */
  withWord?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          aria-hidden
          strokeWidth={1.75}
          className={cn(
            'size-4 shrink-0',
            value <= stars ? 'fill-tag-6 text-warning-strong' : 'fill-transparent text-neutral-4',
          )}
        />
      ))}
      <span className="sr-only">{withWord ? starsLabel(stars) : starsCount(stars)}</span>
    </span>
  );
}
