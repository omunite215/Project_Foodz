'use client';

import { RefreshCw, Star } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { CustomerDispatchView } from '@/server/modules/delivery/schema';
import { announce } from '@/lib/announce';
import { courierChangedText, ratingWords, vehicleSpokenWords } from '@/lib/order-progress';
import { useMotion } from '@/lib/motion';

/*
 * "Your courier" inside the status card (F7 design 3.2, 3.3), between the stepper and the
 * arrival row, so who sits next to when: the first name, the photo (a 5-minute link, falling
 * back to the initial), the vehicle and plate, and the rating when there is one. Never a last
 * name, phone, position, distance or arrival time from the courier (S2.2). When another
 * courier takes over, a notice at its top says so, once.
 */

type Courier = NonNullable<CustomerDispatchView['courier']>;

function Avatar({ courier }: { courier: Courier }) {
  const [failed, setFailed] = useState<string | null>(null);
  const photo = courier.photoUrl && failed !== courier.photoUrl ? courier.photoUrl : null;
  const initial = Array.from(courier.firstName.trim())[0]?.toUpperCase() ?? '';
  return (
    <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft">
      {photo ? (
        // A 5-minute private link: drawn as is, never through the image optimizer. A broken or
        // expired link falls back to the initial; the next refresh brings a fresh one (S2.6).
        // oxlint-disable-next-line nextjs/no-img-element
        <img
          src={photo}
          alt={`${courier.firstName}, your courier`}
          referrerPolicy="no-referrer"
          onError={() => setFailed(photo)}
          className="size-full object-cover"
        />
      ) : (
        <span aria-hidden className="font-heading text-title-2 text-brand-strong">
          {initial}
        </span>
      )}
    </span>
  );
}

export function CourierBlock({
  courier,
  changed,
  animateIn = false,
}: {
  courier: Courier;
  changed: boolean;
  /** Rise in when it appears live; off when it is in the server's HTML. */
  animateIn?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  const rating = ratingWords(courier.rating);

  useMotion(
    (motion) => {
      if (!ref.current || !animateIn) return;
      motion.from(ref.current, {
        y: 8,
        opacity: 0,
        duration: motion.reduced ? 0.12 : 0.2,
        ease: 'power2.out',
      });
    },
    { scope: ref, dependencies: [courier.firstName] },
  );

  // The changed notice is read once, when it appears while the page is open.
  const notice = changed ? courierChangedText(courier.firstName) : null;
  const said = useRef<string | null>(notice);
  useEffect(() => {
    if (notice && said.current !== notice) announce(notice);
    said.current = notice;
  }, [notice]);

  return (
    <section ref={ref} aria-labelledby={titleId} className="mt-5 border-t border-neutral-6 pt-5">
      {notice ? (
        <p className="mb-4 flex gap-2 rounded-lg bg-tag-3-bg px-3 py-2 text-body-5 text-neutral-1">
          <RefreshCw className="mt-0.5 size-4 shrink-0 text-tag-3" aria-hidden />
          {notice}
        </p>
      ) : null}
      <h2 id={titleId} className="text-body-5 font-medium text-neutral-3">
        Your courier
      </h2>
      <div className="mt-3 flex items-center gap-4">
        <Avatar courier={courier} />
        <div className="min-w-0">
          <p className="text-body-2 font-semibold text-neutral-1 [overflow-wrap:anywhere]">
            {courier.firstName}
          </p>
          <p className="text-body-4 text-neutral-3">
            <span aria-hidden>{courier.vehicleWords}</span>
            <span className="sr-only">{vehicleSpokenWords(courier.vehicleWords)}</span>
          </p>
          {rating ? (
            <p className="mt-1 flex items-center gap-1 text-body-5 text-neutral-3">
              <Star className="size-3.5 fill-tag-6 text-tag-6" aria-hidden />
              <span aria-hidden>{rating.text}</span>
              <span className="sr-only">{rating.spoken}</span>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
