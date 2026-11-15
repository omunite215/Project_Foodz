import { createHmac } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'test-key';
const SECRET = 'test-secret';
const SITE = 'http://localhost:3456';
const USER = '0196a1b2-0000-7000-8000-00000000000a';
const ORDER = '0196a1b2-0000-7000-8000-0000000000b1';

const mocks = vi.hoisted(() => ({
  getActor: vi.fn<() => Promise<unknown>>(),
  getSession: vi.fn<() => Promise<unknown>>(),
  canSubscribe: vi.fn<(subscriber: unknown, channel: string) => Promise<boolean>>(),
  enforceRateLimit: vi.fn<(policy: string, key: string) => Promise<void>>(),
}));
vi.mock('@/server/auth/session', () => ({
  getActor: mocks.getActor,
  getSession: mocks.getSession,
}));
vi.mock('@/server/modules/realtime/service', () => ({ canSubscribe: mocks.canSubscribe }));
vi.mock('@/server/security/rate-limit', () => ({ enforceRateLimit: mocks.enforceRateLimit }));

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE);
  vi.stubEnv('NEXT_PUBLIC_PUSHER_KEY', KEY);
  vi.stubEnv('PUSHER_SECRET', SECRET);
  vi.stubEnv('PUSHER_APP_ID', 'foodz');
  vi.stubEnv('PUSHER_HOST', '127.0.0.1');
  ({ POST } = await import('@/app/api/realtime/auth/route'));
});

beforeEach(() => {
  mocks.getActor.mockResolvedValue({ kind: 'user', userId: USER, role: 'customer', isDemo: false });
  mocks.getSession.mockResolvedValue({ user: { twoFactorEnabled: false } });
  mocks.canSubscribe.mockResolvedValue(true);
  mocks.enforceRateLimit.mockResolvedValue();
});

function subscribe(
  fields: Record<string, string> = {
    socket_id: '1234.5678',
    channel_name: `private-order-${ORDER}`,
  },
  origin: string | null = SITE,
) {
  return POST(
    new Request(`${SITE}/api/realtime/auth`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(origin ? { origin } : {}),
      },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

describe('/api/realtime/auth', () => {
  it('signs an allowed subscription with the app secret', async () => {
    const response = await subscribe();

    expect(response.status).toBe(200);
    const expected = createHmac('sha256', SECRET)
      .update(`1234.5678:private-order-${ORDER}`)
      .digest('hex');
    expect(await response.json()).toEqual({ auth: `${KEY}:${expected}` });
    expect(mocks.canSubscribe).toHaveBeenCalledWith(
      { userId: USER, role: 'customer', isDemo: false, twoFactorEnabled: false },
      `private-order-${ORDER}`,
    );
  });

  it('refuses a channel the user may not see', async () => {
    mocks.canSubscribe.mockResolvedValue(false);
    const response = await subscribe();
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('auth');
  });

  it('refuses visitors who are not signed in, before looking at the channel', async () => {
    mocks.getActor.mockResolvedValue({ kind: 'anonymous' });
    expect((await subscribe()).status).toBe(401);
    expect(mocks.canSubscribe).not.toHaveBeenCalled();
  });

  it.each([
    ['another site', 'https://evil.example'],
    ['no origin', null],
  ])('refuses requests from %s', async (_label, origin) => {
    expect((await subscribe(undefined, origin)).status).toBe(403);
    expect(mocks.getActor).not.toHaveBeenCalled();
  });

  it.each([
    [{ socket_id: 'abc', channel_name: `private-order-${ORDER}` }],
    [{ socket_id: '1.2', channel_name: '' }],
    [{ socket_id: '1.2' }],
    [{ socket_id: '1.2', channel_name: `private-order-${ORDER}`, channel_data: '{}' }],
    [{ socket_id: '1.2', channel_name: 'x'.repeat(201) }],
  ])('rejects malformed input %j', async (fields) => {
    expect((await subscribe(fields as Record<string, string>)).status).toBe(422);
    expect(mocks.canSubscribe).not.toHaveBeenCalled();
  });

  it('stops callers who go over the rate limit', async () => {
    const { rateLimited } = await import('@/server/errors');
    mocks.enforceRateLimit.mockRejectedValue(rateLimited());
    expect((await subscribe()).status).toBe(429);
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith('realtime.auth', `user:${USER}`);
  });
});
