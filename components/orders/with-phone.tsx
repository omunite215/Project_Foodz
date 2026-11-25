'use client';

import { telOf } from '@/lib/order-text';
import { cn } from '@/lib/utils';

/**
 * A phone number inside a sentence, as a 44 px target (S8.5): padding grows the link's box to
 * 44 px tall and the same negative margin gives the space back, so the line doesn't move.
 */
export const PHONE_LINK_TARGET = 'inline-block py-3 -my-3';

/** A sentence with "{phone}" turned into a tap-to-call link (inline, underlined). */
export function WithPhone({ text, phone }: { text: string; phone: string }) {
  const [before, after] = text.split('{phone}');
  if (after === undefined) return <>{text}</>;
  return (
    <>
      {before}
      <a
        href={`tel:${telOf(phone)}`}
        className={cn('font-medium text-neutral-1 underline underline-offset-4', PHONE_LINK_TARGET)}
      >
        {phone}
      </a>
      {after}
    </>
  );
}
