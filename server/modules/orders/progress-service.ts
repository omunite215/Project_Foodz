import 'server-only';
import type { UserActor } from '@/server/auth/session';
import type { ReorderResult } from './progress-schema';

/*
 * The customer's live order and "Order again" (F5). Contract stage: signatures only; the
 * bodies arrive with the implementation (docs: features/F5/contract.md). After the F4 merge,
 * the progress builder fills `OrderView.progress` and `OrderSummary.arrival`.
 */

function notImplemented(name: string): never {
  throw new Error(`${name} is not implemented yet.`);
}

/**
 * "Order again" (S7.5, B23): the lines of the caller's own delivered or cancelled order at
 * today's menu, and what was left out and why. Another person's order or an unknown id answers
 * "Order not found." Reads only; the browser adds the lines through the cart (F3 rules).
 */
export async function reorder(
  _actor: UserActor,
  _input: unknown,
  _now = new Date(),
): Promise<ReorderResult> {
  return notImplemented('reorder');
}
