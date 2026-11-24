import type { DispatchTimings } from '@/server/modules/delivery/schema';

/*
 * The dispatch run's control flow (F7 §6), apart from Inngest so it can be tested with a fake
 * step. Every wait is a durable step (no timer lives in an app task), so the run behaves the same
 * on the local dev server and on AWS. Each turn re-reads the order and the delivery in the
 * database: an event missed between a turn and its wait only costs the wait's timeout, never a
 * second offer on an assigned order (lead decision on question 6).
 */

export type OpenResult = { deliveryId: string; readyAt: string; searchStartedAt: string } | null;

export type TurnResult =
  | { kind: 'offered'; offerId: string; expiresAt: string }
  | { kind: 'staffOfferOpen'; offerId: string; expiresAt: string }
  | { kind: 'nobody'; escalated: boolean }
  | { kind: 'stopped' }
  | { kind: 'done' };

export interface DispatchStep {
  open: (id: string, work: () => Promise<OpenResult>) => Promise<OpenResult>;
  turn: (id: string, work: () => Promise<TurnResult>) => Promise<TurnResult>;
  sleepUntil: (id: string, at: Date) => Promise<unknown>;
  waitForOfferEnd: (id: string, offerId: string, timeout: Date) => Promise<unknown>;
  waitForPartner: (id: string, timeoutSeconds: number) => Promise<unknown>;
}

export interface DispatchDeps {
  openSearch: (input: {
    orderId: string;
    readyEventId: string;
    restart: boolean;
  }) => Promise<OpenResult>;
  searchTurn: (deliveryId: string) => Promise<TurnResult>;
}

/** Far more turns than 60 minutes can hold; past it something is wrong and the run stops. */
export const MAX_TURNS = 300;
/** Extra time a wait gives the offer's end event beyond the end and the grace. */
const WAIT_SLACK_SECONDS = 5;

export type RunEnd = 'not-started' | 'done' | 'stopped' | 'turn-limit';

export async function runDispatch(
  step: DispatchStep,
  input: { orderId: string; eventId: string; at: string; restart: boolean },
  deps: DispatchDeps,
  timings: Pick<DispatchTimings, 'startDelaySeconds' | 'graceSeconds' | 'sweepSeconds'>,
): Promise<{ end: RunEnd; turns: number }> {
  if (!input.restart) {
    // W1.1: F5's undo window and its grace; an undo meanwhile cancels the run.
    await step.sleepUntil(
      'start',
      new Date(Date.parse(input.at) + timings.startDelaySeconds * 1000),
    );
  }
  const opened = await step.open('open', () =>
    deps.openSearch({
      orderId: input.orderId,
      readyEventId: input.eventId,
      restart: input.restart,
    }),
  );
  if (!opened) return { end: 'not-started', turns: 0 };

  const turn = async (n: number): Promise<{ end: RunEnd; turns: number }> => {
    if (n >= MAX_TURNS) return { end: 'turn-limit', turns: n };
    const result = await step.turn(`turn-${n}`, () => deps.searchTurn(opened.deliveryId));
    switch (result.kind) {
      case 'done':
        return { end: 'done', turns: n + 1 };
      case 'stopped':
        return { end: 'stopped', turns: n + 1 };
      case 'nobody':
        // W5.3: sweep again in 30 seconds, or as soon as a partner becomes available.
        await step.waitForPartner(`available-${n}`, timings.sweepSeconds);
        return turn(n + 1);
      default: {
        const timeout = new Date(
          Date.parse(result.expiresAt) + (timings.graceSeconds + WAIT_SLACK_SECONDS) * 1000,
        );
        await step.waitForOfferEnd(`ended-${n}`, result.offerId, timeout);
        // Whatever ended the wait (an answer, a withdrawal, the timeout), the next turn reads
        // the database before doing anything.
        return turn(n + 1);
      }
    }
  };
  return turn(0);
}
