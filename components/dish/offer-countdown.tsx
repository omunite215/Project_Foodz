'use client';

import { Flame } from 'lucide-react';
import { offerTimeLeft } from '@/lib/format';
import { useMinuteClock } from '@/lib/use-minute-clock';
import { cn } from '@/lib/utils';

/**
 * Time left on a running offer, from its real end time: "Ends in 29 days". Updated once a
 * minute and never a live region, so screen readers hear it only when they reach it. Gone once
 * the offer has ended.
 */
export function OfferCountdown({
  endsAt,
  variant = 'outline',
  size = 'responsive',
  className,
}: {
  endsAt: string;
  /** `outline` on white; `white` on tinted panels such as the campaign banner. */
  variant?: 'outline' | 'white';
  /** `responsive` grows at `xl` (cards, banners); `compact` keeps the small size (the cart). */
  size?: 'responsive' | 'compact';
  className?: string;
}) {
  const now = useMinuteClock();
  const text = offerTimeLeft(endsAt, now);
  if (!text) return null;
  const compact = size === 'compact';

  return (
    <p
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-white px-2 text-body-5 font-semibold whitespace-nowrap text-brand-strong',
        compact ? 'h-7' : 'h-8 xl:text-body-4',
        variant === 'outline' ? 'border-brand-strong' : 'border-white',
        className,
      )}
    >
      <Flame className={cn('size-4', !compact && 'xl:size-5')} aria-hidden />
      <span className="sr-only">Offer </span>
      {/* The server's and the browser's clocks can straddle a minute. */}
      <span suppressHydrationWarning>{text}</span>
    </p>
  );
}
