// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The sharing engine against a stand-in phone and server (F6 design 6.4): the heartbeat while
 * standing still (P10.3), "Back online. Location sent." after a dead zone (P11.2), the right
 * sentence after 10 minutes without a connection (P11.4), and nothing sent when the phone says
 * it can't find itself (P11.6). Timers and the clock are fake; one engine runs for the whole file,
 * each test as another partner.
 */

const announced = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/announce', () => ({ announce: (message: string) => announced.push(message) }));

const sharing = await import('./sharing');
const { HEARTBEAT_MS } = await import('./location-queue');

// Route R from the story: the kitchen, then about 234 m towards Faneuil Hall.
const R0 = { latitude: 42.3505, longitude: -71.045 };
const R1 = { latitude: 42.3521, longitude: -71.0469 };

interface SentPoint {
  lat: number;
  lng: number;
  recordedAt: string;
}

const phone = {
  online: true,
  /**
   * A fresh read: answered, never answered (a phone that reports only changes, like a test
   * browser), or "position unavailable" (no GPS, in a tunnel, P11.6).
   */
  answers: 'yes' as 'yes' | 'silent' | 'timeout' | 'unavailable',
  position: R0,
  onWatch: null as PositionCallback | null,
};
const server = {
  posts: [] as SentPoint[][],
  takenOfflineAt: null as string | null,
  /** How often the app asked whether he is still online (P11.4). */
  stateReads: 0,
};

const fixAt = (coords: typeof R0, at = Date.now()) =>
  ({
    coords: { ...coords, accuracy: 15, heading: null, speed: null },
    timestamp: at,
  }) as unknown as GeolocationPosition;

const answer = (status: number, body: unknown) => ({
  status,
  json: async () => body,
  headers: new Headers(),
});

function fakeFetch(path: string, init: { body?: string }) {
  if (path === '/api/v1/partner/me') {
    server.stateReads += 1;
    return Promise.resolve(
      answer(200, {
        screen: 'home',
        availability: { online: !server.takenOfflineAt, onThisDevice: true },
        lastOffline: server.takenOfflineAt
          ? { reason: 'no-location', at: server.takenOfflineAt }
          : null,
      }),
    );
  }
  if (path !== '/api/v1/partner/locations' || !init.body) return Promise.resolve(answer(200, {}));
  const { points } = JSON.parse(init.body) as { points: SentPoint[] };
  server.posts.push(points);
  if (server.takenOfflineAt) {
    return Promise.resolve(
      answer(403, {
        code: 'NOT_ONLINE',
        details: { reason: 'no-location', at: server.takenOfflineAt },
      }),
    );
  }
  return Promise.resolve(
    answer(200, {
      lastPointAt: points.at(-1)?.recordedAt,
      serverTime: new Date().toISOString(),
    }),
  );
}

function setConnection(online: boolean) {
  phone.online = online;
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

let partner = 0;

/** A partner who was sharing on this phone; the first fix arrives and is sent. */
async function goOnline() {
  partner += 1;
  const now = new Date().toISOString();
  await sharing.adoptServerState({
    partnerId: `partner-${partner}`,
    isDemo: false,
    online: true,
    onlineSince: now,
    lastPointAt: now,
    onThisDevice: true,
    lastOffline: null,
    asOf: now,
  });
  expect(sharing.sharingStore.state.phase).toBe('online');
  phone.onWatch?.(fixAt(phone.position));
  await vi.advanceTimersByTimeAsync(10);
  expect(server.posts).toHaveLength(1);
}

beforeAll(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => phone.online });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: async () => ({ state: 'granted' }) },
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: (success: PositionCallback) => {
        phone.onWatch = success;
        return 1;
      },
      clearWatch: () => {
        phone.onWatch = null;
      },
      getCurrentPosition: (success: PositionCallback, failure: PositionErrorCallback) => {
        const codes = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
        if (phone.answers === 'yes') success(fixAt(phone.position));
        if (phone.answers === 'unavailable') {
          failure({ code: 2, ...codes } as GeolocationPositionError);
        }
        if (phone.answers === 'timeout') failure({ code: 3, ...codes } as GeolocationPositionError);
      },
    },
  });
});

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-24T18:00:00.000Z') });
  vi.stubGlobal('fetch', vi.fn<typeof fakeFetch>(fakeFetch));
  Object.assign(phone, { online: true, answers: 'yes', position: R0 });
  Object.assign(server, { posts: [], takenOfflineAt: null, stateReads: 0 });
  announced.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the heartbeat (P10.3, P11.6)', () => {
  it('sends a point every 15 s while he stands still and the phone reports nothing new', async () => {
    await goOnline();
    await vi.advanceTimersByTimeAsync(4 * HEARTBEAT_MS);
    expect(server.posts).toHaveLength(5);
    const times = server.posts.slice(1).map(([point]) => Date.parse(point!.recordedAt));
    expect(times).toEqual([1, 2, 3, 4].map((n) => Date.parse('2026-11-24T18:00:00Z') + n * 15_000));
    // The server keeps him fresh: the last accepted point is the latest heartbeat.
    expect(sharing.sharingStore.state.lastAcceptedAt).toBe('2026-11-24T18:01:00.000Z');
  });

  it('sends the last fix again, stamped now, for a minute after it, when the phone stays silent', async () => {
    await goOnline();
    phone.answers = 'silent';
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    // At 15, 30, 45 and 60 s, then no more: a stuck phone goes stale (S7).
    expect(server.posts).toHaveLength(5);
    for (const [point] of server.posts) {
      expect(point).toMatchObject({ lat: R0.latitude, lng: R0.longitude });
    }
    expect(sharing.sharingStore.state.lastAcceptedAt).toBe('2026-11-24T18:01:00.000Z');

    // A real fix again: the heartbeat comes back.
    phone.answers = 'yes';
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(server.posts.length).toBeGreaterThan(5);
  });

  it('counts two timed-out reads in a row as no GPS, and re-sends nothing', async () => {
    await goOnline();
    phone.answers = 'timeout';
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(server.posts).toHaveLength(1);
  });

  it("sends nothing when the phone says it can't find itself", async () => {
    await goOnline();
    phone.answers = 'unavailable';
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(server.posts).toHaveLength(1);
    expect(sharing.sharingStore.state.phase).toBe('online');
  });
});

describe('the connection drops and comes back (P11.1, P11.2)', () => {
  it('sends what was queued, then says "Back online. Location sent."', async () => {
    await goOnline();
    setConnection(false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sharing.sharingStore.state.pinned).toBe('noConnection');

    // He rides on to R1 in the dead zone (after the 4 s gap): queued, not sent.
    await vi.advanceTimersByTimeAsync(2_000);
    phone.position = R1;
    phone.onWatch?.(fixAt(R1));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.posts).toHaveLength(1);
    expect(sharing.sharingStore.state.queued).toBeGreaterThan(0);

    setConnection(true);
    // The browser's word alone doesn't clear the banner: only a send that gets through does.
    expect(sharing.sharingStore.state.pinned).toBe('noConnection');
    await vi.advanceTimersByTimeAsync(10);
    expect(server.posts.at(-1)?.at(-1)).toMatchObject({ lat: R1.latitude, lng: R1.longitude });
    expect(sharing.sharingStore.state).toMatchObject({
      pinned: 'backOnline',
      connection: 'online',
      queued: 0,
    });
    expect(announced).toContain('Back online. Location sent.');

    await vi.advanceTimersByTimeAsync(4_000);
    expect(sharing.sharingStore.state.pinned).toBeNull();
  });

  it('confirms with the last fix when nothing was queued in a short drop', async () => {
    await goOnline();
    setConnection(false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sharing.sharingStore.state.pinned).toBe('noConnection');
    setConnection(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(server.posts).toHaveLength(2);
    expect(sharing.sharingStore.state.pinned).toBe('backOnline');
  });
});

describe('ten minutes without a connection (P11.4)', () => {
  it('says the connection was lost, and keeps nothing from while he was offline', async () => {
    await goOnline();
    setConnection(false);
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    // Meanwhile the server took him offline for having no location (P10.8).
    server.takenOfflineAt = '2026-11-24T18:10:00.000Z';

    const sentBefore = server.posts.length;
    setConnection(true);
    await vi.advanceTimersByTimeAsync(10);
    // The server is asked first; what queued in the dead zone is dropped, never sent.
    expect(server.stateReads).toBe(1);
    expect(server.posts).toHaveLength(sentBefore);
    expect(sharing.sharingStore.state).toMatchObject({ phase: 'offline', queued: 0, pinned: null });
    expect(sharing.sharingStore.state.notice?.text).toBe(
      'You went offline at 1:10 pm because we lost your connection for 10 minutes.',
    );
    expect(sharing.isWatching()).toBe(false);
  });
});
