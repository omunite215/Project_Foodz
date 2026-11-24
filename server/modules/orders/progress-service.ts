import 'server-only';
import type { UserActor } from '@/server/auth/session';
import { runAs } from '@/server/db/context';
import { AppError } from '@/server/errors';
import { getStoreStatus } from '@/server/modules/menu/service';
import {
  type ReorderLeftOut,
  type ReorderLine,
  reorderInput,
  type ReorderResult,
} from './progress-schema';
import { findReorderSource } from './repo';

/*
 * "Order again" (F5 S7.5, B23): the lines of the caller's own delivered or cancelled order at
 * today's menu, and what was left out and why. It reads only; the browser adds the lines through
 * the cart, which applies F3's merge rules, limits and messages. Never the old prices, the code,
 * the tip, the kitchen note, the address or the payment method.
 */

/** The store's calendar day of an instant, for U24's "the same day". */
const storeDay = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);

export interface ReorderSource {
  id: string;
  number: string;
  cancelCode: string | null;
  cancelLineIds: string[];
  cancelledAt: Date | null;
  items: {
    id: string;
    title: string;
    quantity: number;
    flavors: string[];
    note: string | null;
    menuItem: { id: string; title: string; isAvailable: boolean; flavors: string[] } | null;
  }[];
}

/** Pure, for the tests: the lines to add and what was left out (design 8). */
export function reorderOf(source: ReorderSource, now: Date, timeZone: string): ReorderResult {
  const ranOut =
    source.cancelCode === 'dish-unavailable' &&
    source.cancelledAt !== null &&
    storeDay(source.cancelledAt, timeZone) === storeDay(now, timeZone)
      ? new Set(source.cancelLineIds)
      : new Set<string>();
  const lines: ReorderLine[] = [];
  const leftOut: ReorderLeftOut[] = [];
  const named = new Set<string>();
  const leaveOut = (kind: ReorderLeftOut['kind'], dish: string) => {
    if (named.has(`${kind}:${dish}`)) return;
    named.add(`${kind}:${dish}`);
    leftOut.push({ kind, dish });
  };
  for (const item of source.items) {
    const dish = item.menuItem;
    if (!dish) {
      leaveOut('offMenu', item.title);
      continue;
    }
    // U24: a dish the kitchen ran out of today wins over "sold out".
    if (ranOut.has(item.id)) {
      leaveOut('kitchenRanOut', dish.title);
      continue;
    }
    if (!dish.isAvailable) {
      leaveOut('soldOut', dish.title);
      continue;
    }
    const offered = new Set(dish.flavors);
    const flavors = item.flavors.filter((flavor) => offered.has(flavor));
    for (const extra of item.flavors.filter((flavor) => !offered.has(flavor))) {
      leftOut.push({ kind: 'extraDropped', dish: dish.title, extra });
    }
    lines.push({
      menuItemId: dish.id,
      title: dish.title,
      quantity: item.quantity,
      flavors,
      ...(item.note && { note: item.note }),
    });
  }
  return {
    orderId: source.id,
    number: source.number,
    lines,
    addedQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    leftOut,
  };
}

/**
 * "Order again" (S7.5, B23): the lines of the caller's own delivered or cancelled order at
 * today's menu, and what was left out and why. Another person's order or an unknown id answers
 * "Order not found." Reads only; the browser adds the lines through the cart (F3 rules).
 */
export async function reorder(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<ReorderResult> {
  const { orderId } = reorderInput.parse(input);
  const source = await runAs(actor, (ctx) => findReorderSource(ctx, orderId, actor.userId));
  if (!source) throw new AppError('NOT_FOUND', 'Order not found.', 404);
  const { timeZone } = await getStoreStatus(now);
  return reorderOf(source, now, timeZone);
}
