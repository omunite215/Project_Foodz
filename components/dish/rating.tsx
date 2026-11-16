import { Star, StarHalf } from 'lucide-react';
import { ratingLabel, ratingText, starKinds } from '@/lib/format';
import { cn } from '@/lib/utils';

const STAR_POSITIONS = ['first', 'second', 'third', 'fourth', 'fifth'] as const;

export interface RatingProps {
  average: number;
  reviews: number;
  /** Star size: 16 or 24 px, or classes for a responsive size. */
  starClassName?: string;
  textClassName?: string;
  className?: string;
  /**
   * In a card whose link already names the rating, the stars and text are hidden from screen
   * readers so the card is read once.
   */
  decorative?: boolean;
}

/**
 * Five amber stars and "4.6 · 120 reviews". Screen readers hear "rated 4.6 out of 5, 120
 * reviews". With no reviews there are no stars, just "No reviews yet".
 */
export function Rating({
  average,
  reviews,
  starClassName = 'size-4',
  textClassName = 'text-body-5 font-medium text-neutral-3',
  className,
  decorative = false,
}: RatingProps) {
  if (reviews === 0) {
    return (
      <p
        className={cn('flex items-center', textClassName, className)}
        aria-hidden={decorative || undefined}
      >
        No reviews yet
      </p>
    );
  }

  const kinds = starKinds(average);
  return (
    <p
      className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', className)}
      aria-hidden={decorative || undefined}
    >
      <span className="flex items-center gap-0.5" aria-hidden>
        {STAR_POSITIONS.map((position, index) => {
          const kind = kinds[index] ?? 'empty';
          if (kind === 'half') {
            return (
              <span key={position} className={cn('relative inline-flex', starClassName)}>
                <Star
                  className={cn('absolute inset-0 fill-neutral-6 text-neutral-6', starClassName)}
                />
                <StarHalf className={cn('absolute inset-0 fill-tag-6 text-tag-6', starClassName)} />
              </span>
            );
          }
          return (
            <Star
              key={position}
              className={cn(
                starClassName,
                kind === 'full' ? 'fill-tag-6 text-tag-6' : 'fill-neutral-6 text-neutral-6',
              )}
            />
          );
        })}
      </span>
      <span className={cn('tabular-nums', textClassName)} aria-hidden>
        {ratingText(average, reviews)}
      </span>
      {decorative ? null : <span className="sr-only">{ratingLabel(average, reviews)}</span>}
    </p>
  );
}
