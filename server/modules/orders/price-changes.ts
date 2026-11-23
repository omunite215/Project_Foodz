import { formatPrice } from '@/lib/format';
import type { Quote } from '@/server/modules/cart/schema';
import type { PriceChange } from './schema';

/*
 * Why a total changed between the quote on the button and the one at the press (S8.2). The
 * browser says what it showed; the new quote says what is true now. Nothing here prices
 * anything. No server imports: checkout can explain a change it sees in its own quotes too.
 */

export interface ShownFigures {
  lines?: { key: string; unitPriceCents: number }[];
  deliveryFeeCents?: number | null;
  promoAmountCents?: number;
}

export function priceChanges(shown: ShownFigures | undefined, quote: Quote): PriceChange[] {
  const changes: PriceChange[] = [];
  const before = new Map((shown?.lines ?? []).map((line) => [line.key, line.unitPriceCents]));

  for (const line of quote.lines) {
    if (line.status !== 'ok' || !line.dish || line.unitPriceCents === null) continue;
    const was = before.get(line.key);
    if (was !== undefined && was !== line.unitPriceCents) {
      changes.push({
        kind: 'price',
        key: line.key,
        dish: line.dish.title,
        wasCents: was,
        nowCents: line.unitPriceCents,
      });
    }
    for (const extra of line.droppedFlavors) {
      changes.push({ kind: 'extraDropped', key: line.key, extra, dish: line.dish.title });
    }
  }

  if (shown?.deliveryFeeCents !== undefined && shown.deliveryFeeCents !== quote.delivery.feeCents) {
    changes.push({
      kind: 'deliveryFee',
      label: quote.delivery.address?.label ?? null,
      wasCents: shown.deliveryFeeCents,
      nowCents: quote.delivery.feeCents,
    });
  }

  if (
    quote.promo &&
    shown?.promoAmountCents !== undefined &&
    shown.promoAmountCents !== quote.promo.amountCents
  ) {
    changes.push({
      kind: 'promo',
      code: quote.promo.code,
      wasCents: shown.promoAmountCents,
      nowCents: quote.promo.amountCents,
    });
  }

  return changes.length > 0 ? changes : [{ kind: 'other' }];
}

/** The "because …" part of the S8.2 sentence for one change; null when there's nothing to say. */
export function changeReason(change: PriceChange): string | null {
  switch (change.kind) {
    case 'price':
      return `${change.dish} is now ${formatPrice(change.nowCents)} (was ${formatPrice(change.wasCents)})`;
    case 'deliveryFee': {
      const where = change.label ? `delivery to ${change.label}` : 'delivery';
      if (change.nowCents === null)
        return `we no longer deliver to ${change.label ?? 'that address'}`;
      return change.wasCents === null
        ? `${where} is ${formatPrice(change.nowCents)}`
        : `${where} is now ${formatPrice(change.nowCents)} (was ${formatPrice(change.wasCents)})`;
    }
    case 'extraDropped':
      return `${change.extra} isn't offered for ${change.dish} any more`;
    case 'promo':
      return `${change.code} now takes off ${formatPrice(change.nowCents)}${change.wasCents === null ? '' : ` (was ${formatPrice(change.wasCents)})`}`;
    case 'other':
    default:
      return null;
  }
}
