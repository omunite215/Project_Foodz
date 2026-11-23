import { describe, expect, it, vi } from 'vitest';
import { ATTEMPT_STATUS_PATH, fetchAttemptStatus } from './attempt-status';

const ORDER = '01a201a9-7986-74dd-9f5a-15ae7a8fe737';

const answering = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => Response.json(body, { status }));

describe('fetchAttemptStatus (S7.3)', () => {
  it('asks the route for this key, never from a cache, and reads its answer', async () => {
    const fetcher = answering({ kind: 'placed', orderId: ORDER, number: '1042' });
    await expect(fetchAttemptStatus('a_b-c'.repeat(4), { fetcher })).resolves.toEqual({
      kind: 'placed',
      orderId: ORDER,
      number: '1042',
    });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(`${ATTEMPT_STATUS_PATH}?key=${'a_b-c'.repeat(4)}`);
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
  });

  it('reads every outcome the server gives', async () => {
    for (const body of [
      { kind: 'notFound' },
      { kind: 'awaitingPayment', orderId: ORDER, number: '1042', expiresAt: null },
      {
        kind: 'failed',
        orderId: ORDER,
        number: '1042',
        decline: { code: null, declineCode: null },
      },
      { kind: 'cancelled', orderId: ORDER, number: '1042', reason: 'customer' },
    ]) {
      expect(await fetchAttemptStatus('k'.repeat(16), { fetcher: answering(body) })).toEqual(body);
    }
  });

  it('gives nothing for a refusal, an unexpected answer or a network failure', async () => {
    const key = 'k'.repeat(16);
    expect(
      await fetchAttemptStatus(key, { fetcher: answering({ code: 'RATE_LIMITED' }, 429) }),
    ).toBeNull();
    expect(
      await fetchAttemptStatus(key, { fetcher: answering({ kind: 'placed', orderId: 'x' }) }),
    ).toBeNull();
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await fetchAttemptStatus(key, { fetcher: offline })).toBeNull();
  });
});
