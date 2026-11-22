import { Clock } from 'lucide-react';
import type { Quote } from '@/server/modules/cart/schema';
import { ARRIVAL_UNAVAILABLE, arrivalWords } from '@/lib/checkout-text';
import { orderingOpensText } from '@/lib/cart-text';
import { cn } from '@/lib/utils';

/*
 * "Arrival" (F4 design 2.10, S3.1): the window from the quote and the clock time it ends. Saved
 * with the order and shown there as clock times.
 */

function Bar({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'block rounded-sm bg-neutral-7 animate-skeleton motion-reduce:animate-none',
        className,
      )}
    />
  );
}

export function ArrivalBox({
  quote,
  failed,
  dim,
}: {
  quote: Quote | null;
  /** The quote failed or the browser is offline. */
  failed: boolean;
  dim: boolean;
}) {
  let body;
  if (failed) {
    body = (
      <>
        <p className="text-body-3 font-semibold text-neutral-1">
          <span aria-hidden>—</span>
          <span className="sr-only">Arrival time not available</span>
        </p>
        <p className="text-body-5 text-neutral-3">{ARRIVAL_UNAVAILABLE}</p>
      </>
    );
  } else if (!quote) {
    body = (
      <>
        <Bar className="h-6 w-52 max-w-full" />
        <Bar className="mt-1 h-5 w-24" />
        <span className="sr-only">Working out the arrival time</span>
      </>
    );
  } else {
    const words = arrivalWords(
      quote.arrival,
      quote.store.timeZone,
      quote.arrival.status === 'closed' ? orderingOpensText(quote.store.opensAt) : null,
    );
    body = (
      <div className={cn('transition-opacity duration-150', dim && 'opacity-75')}>
        <p
          className={cn(
            'text-neutral-1 tabular-nums',
            words.quiet
              ? 'text-body-4 font-normal text-neutral-3'
              : quote.arrival.status === 'closed'
                ? 'text-body-4 font-medium'
                : 'text-body-3 font-semibold',
          )}
        >
          <span aria-hidden>{words.line1}</span>
          <span className="sr-only">{words.spoken}</span>
        </p>
        {words.line2 ? (
          <p
            aria-hidden={quote.arrival.status === 'ok' || undefined}
            className="text-body-5 text-neutral-3 tabular-nums"
          >
            {words.line2}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section aria-labelledby="arrival-title">
      <h2 id="arrival-title" className="text-body-2 font-semibold text-neutral-1">
        Arrival
      </h2>
      <div className="mt-4 flex items-center gap-4 rounded-xl border border-neutral-6 bg-white p-4">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-soft"
        >
          <Clock className="size-6 text-brand-strong" />
        </span>
        <div className="min-w-0">{body}</div>
      </div>
    </section>
  );
}
