import { z } from 'zod';

/*
 * Checkout's question to the server after a press went quiet (S7.3): what became of it? Asked
 * with a plain fetch to /api/checkout/attempt, not a Server Action, because Next runs a page's
 * actions one at a time and the press itself may still be one of them.
 */

const orderId = z.uuid();
const orderNumber = z.string().min(1).max(20);

export const attemptStatusResponse = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('notFound') }),
  z.object({ kind: z.literal('placed'), orderId, number: orderNumber }),
  z.object({
    kind: z.literal('awaitingPayment'),
    orderId,
    number: orderNumber,
    expiresAt: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('failed'),
    orderId,
    number: orderNumber,
    decline: z
      .object({ code: z.string().nullable(), declineCode: z.string().nullable() })
      .nullable(),
  }),
  z.object({
    kind: z.literal('cancelled'),
    orderId,
    number: orderNumber,
    reason: z.string().nullable(),
  }),
]);
export type AttemptStatusResponse = z.infer<typeof attemptStatusResponse>;

export const ATTEMPT_STATUS_PATH = '/api/checkout/attempt';

/** The press's fate, or null when the server couldn't be asked or answered something else. */
export async function fetchAttemptStatus(
  attemptKey: string,
  { timeoutMs = 10_000, fetcher = fetch }: { timeoutMs?: number; fetcher?: typeof fetch } = {},
): Promise<AttemptStatusResponse | null> {
  try {
    const response = await fetcher(`${ATTEMPT_STATUS_PATH}?key=${encodeURIComponent(attemptKey)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const parsed = attemptStatusResponse.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
