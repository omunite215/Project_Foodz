import { describe, expect, it } from 'vitest';
import {
  type DispatchDeps,
  type DispatchStep,
  MAX_TURNS,
  runDispatch,
  type TurnResult,
} from './dispatch-run';

const timings = { startDelaySeconds: 12, graceSeconds: 2, sweepSeconds: 30 };
const input = {
  orderId: '018f0000-0000-7000-8000-000000001042',
  eventId: '018f0000-0000-7000-8000-00000000e042',
  at: '2026-11-21T00:40:00.000Z',
  restart: false,
};
const opened = {
  deliveryId: '018f0000-0000-7000-8000-00000000d042',
  readyAt: input.at,
  searchStartedAt: '2026-11-21T00:40:12.000Z',
};

/** A fake step that records what the run asked for; waits resolve to the given values. */
function fakeStep(waits: { offerEnd?: unknown; partner?: unknown } = {}) {
  const log: string[] = [];
  const step: DispatchStep = {
    open: async (id, work) => {
      log.push(id);
      return work();
    },
    turn: async (id, work) => {
      log.push(id);
      return work();
    },
    sleepUntil: async (id, at) => {
      log.push(`${id}@${at.toISOString()}`);
    },
    waitForOfferEnd: async (id, offerId, timeout) => {
      log.push(`${id}:${offerId}@${timeout.toISOString()}`);
      return waits.offerEnd ?? null;
    },
    waitForPartner: async (id, seconds) => {
      log.push(`${id}:${seconds}s`);
      return waits.partner ?? null;
    },
  };
  return { step, log };
}

function deps(turns: TurnResult[], open = opened) {
  const calls: string[] = [];
  const value: DispatchDeps = {
    openSearch: async () => open,
    searchTurn: async (deliveryId) => {
      calls.push(deliveryId);
      return turns.shift() ?? { kind: 'done' };
    },
  };
  return { value, calls };
}

const offered = (offerId: string): TurnResult => ({
  kind: 'offered',
  offerId,
  expiresAt: '2026-11-21T00:40:42.000Z',
});

describe('the dispatch run (W1, W4, W5)', () => {
  it('waits out the undo window, then offers one partner at a time', async () => {
    const { step, log } = fakeStep();
    const { value } = deps([offered('o1'), offered('o2'), { kind: 'done' }]);
    const result = await runDispatch(step, input, value, timings);
    expect(result).toEqual({ end: 'done', turns: 3 });
    expect(log).toEqual([
      'start@2026-11-21T00:40:12.000Z',
      'open',
      'turn-0',
      'ended-0:o1@2026-11-21T00:40:49.000Z',
      'turn-1',
      'ended-1:o2@2026-11-21T00:40:49.000Z',
      'turn-2',
    ]);
  });

  it('starts at once on a restart (give back, take off, Find a courier)', async () => {
    const { step, log } = fakeStep();
    await runDispatch(step, { ...input, restart: true }, deps([{ kind: 'done' }]).value, timings);
    expect(log[0]).toBe('open');
  });

  it('ends without a turn when the order is no longer ready', async () => {
    const { step, log } = fakeStep();
    const result = await runDispatch(step, input, deps([], null as never).value, timings);
    expect(result).toEqual({ end: 'not-started', turns: 0 });
    expect(log).not.toContain('turn-0');
  });

  it('sweeps every 30 seconds while nobody is left, and stops when the search stops', async () => {
    const { step, log } = fakeStep();
    const { value } = deps([
      { kind: 'nobody', escalated: true },
      { kind: 'nobody', escalated: true },
      { kind: 'stopped' },
    ]);
    expect(await runDispatch(step, input, value, timings)).toEqual({ end: 'stopped', turns: 3 });
    expect(log.filter((entry) => entry.startsWith('available-'))).toEqual([
      'available-0:30s',
      'available-1:30s',
    ]);
  });

  it('waits on a staff offer like any other, then goes on (A37.4)', async () => {
    const { step, log } = fakeStep();
    const { value } = deps([
      { kind: 'staffOfferOpen', offerId: 's1', expiresAt: '2026-11-21T00:41:12.000Z' },
      { kind: 'done' },
    ]);
    await runDispatch(step, input, value, timings);
    expect(log).toContain('ended-0:s1@2026-11-21T00:41:19.000Z');
  });

  it('re-checks the database after a wait times out, so a missed accept never leads to a second offer', async () => {
    // The partner accepted between the turn and its wait: the end event was never seen, the
    // wait timed out (null), and the next turn reads the delivery as assigned ("done").
    const { step, log } = fakeStep({ offerEnd: null });
    const { value, calls } = deps([offered('o1'), { kind: 'done' }]);
    const result = await runDispatch(step, input, value, timings);
    expect(result).toEqual({ end: 'done', turns: 2 });
    expect(calls).toHaveLength(2);
    expect(log.filter((entry) => entry.startsWith('ended-'))).toHaveLength(1);
  });

  it('gives up after the turn limit rather than looping for ever', async () => {
    const { step } = fakeStep();
    const endless: DispatchDeps = {
      openSearch: async () => opened,
      searchTurn: async () => ({ kind: 'nobody', escalated: true }),
    };
    expect(await runDispatch(step, input, endless, timings)).toEqual({
      end: 'turn-limit',
      turns: MAX_TURNS,
    });
  });
});
