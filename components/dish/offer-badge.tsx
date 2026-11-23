'use client';

import { Flame } from 'lucide-react';
import { offerTimeLeft } from '@/lib/format';
import { useMinuteClock } from '@/lib/use-minute-clock';

/**
 * The dish page's offer (F3 S4.12, design 3.3): the F1 countdown look grown to name what ends,
 * "KBBQ5 · $5 off Korean dishes over $25 · Ends in 29 days". Updated once a minute, never a live
 * region; it wraps rather than truncating, and is gone once the offer has ended.
 */
export function OfferBadge({
  code,
  description,
  endsAt,
}: {
  code: string;
  description: string | null;
  endsAt: string;
}) {
  const now = useMinuteClock();
  const left = offerTimeLeft(endsAt, now);
  if (!left) return null;
  const spoken = [`Offer: ${code}`, description, left.replace(/^Ends/, 'ends')]
    .filter(Boolean)
    .join(', ');

  return (
    <p className="inline-flex min-h-8 max-w-full items-start gap-1.5 rounded-md border border-brand-strong bg-white px-2 py-1 text-body-5 font-semibold text-brand-strong xl:text-body-4">
      {/* Beside the first line, with the text wrapping next to it (never alone on a line). */}
      <Flame className="mt-0.5 size-4 shrink-0 xl:size-5" aria-hidden />
      {/* The server's and the browser's clocks can straddle a minute. */}
      <span aria-hidden suppressHydrationWarning>
        <span className="tracking-wider">{code}</span>
        {description ? ` · ${description}` : ''} · {left}
      </span>
      <span className="sr-only" suppressHydrationWarning>
        {spoken}
      </span>
    </p>
  );
}
