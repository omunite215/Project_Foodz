import { createHmac, randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isInngestDevMode } from './client';

const SIGNING_KEY = `signkey-test-${randomBytes(32).toString('hex')}`;
const SITE_URL = 'https://foodz.example';
const ENDPOINT = `${SITE_URL}/api/inngest`;

/** Signs a body the way Inngest Cloud does: HMAC-SHA256 over body + timestamp. */
function sign(body: string, key: string, timestamp = Math.round(Date.now() / 1000)) {
  const hmac = createHmac('sha256', key.replace(/^signkey-\w+-/, ''))
    .update(body + String(timestamp))
    .digest('hex');
  return `t=${timestamp}&s=${hmac}`;
}

// Inngest signs the canonical (RFC 8785) form of the JSON body; keys are written here in sorted
// order so the text sent and the text signed are the same.
const body = JSON.stringify({
  ctx: { attempt: 0, run_id: 'run-1', stack: { current: 0, stack: [] } },
  event: { data: { uploadId: '0196a1b2-0000-7000-8000-000000000001' }, name: 'upload.received' },
  events: [],
  steps: {},
});

function run(signature?: string, payload = body) {
  return new Request(`${ENDPOINT}?fnId=foodz-unknown&stepId=step`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'x-inngest-signature': signature } : {}),
    },
    body: payload,
  });
}

let route: typeof import('@/app/api/inngest/route');

// The route imports every job function (the order and partner jobs among them); on a busy machine, such as a
// pre-commit hook running beside the linter, that takes longer than the default hook timeout.
beforeAll(async () => {
  vi.stubEnv('INNGEST_DEV', '');
  vi.stubEnv('INNGEST_SIGNING_KEY', SIGNING_KEY);
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE_URL);
  vi.stubEnv('LOG_LEVEL', 'silent');
  vi.resetModules();
  route = await import('@/app/api/inngest/route');
}, 60_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('/api/inngest outside dev mode', () => {
  it('rejects a job request with no signature', async () => {
    expect((await route.POST(run() as never, undefined)).status).toBe(401);
  });

  it('rejects a signature made with another key', async () => {
    const forged = sign(body, `signkey-test-${randomBytes(32).toString('hex')}`);
    expect((await route.POST(run(forged) as never, undefined)).status).toBe(401);
  });

  it('rejects a valid signature replayed on a changed body', async () => {
    const signature = sign(body, SIGNING_KEY);
    const changed = body.replace('run-1', 'run-2');
    expect((await route.POST(run(signature, changed) as never, undefined)).status).toBe(401);
  });

  it('rejects an expired signature', async () => {
    const old = sign(body, SIGNING_KEY, Math.round(Date.now() / 1000) - 60 * 60);
    expect((await route.POST(run(old) as never, undefined)).status).toBe(401);
  });

  it('accepts a correctly signed request (it then fails only on the unknown function)', async () => {
    const response = await route.POST(run(sign(body, SIGNING_KEY)) as never, undefined);
    expect(response.status).not.toBe(401);
    expect(await response.text()).toContain('was not found in this app');
  });

  it('does not describe itself to unsigned callers', async () => {
    expect((await route.GET(new Request(ENDPOINT) as never, undefined)).status).toBe(401);
  });

  it('registers the configured site URL, whatever Host header the request carries', async () => {
    const registered: unknown[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      registered.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'));
      return Response.json({ ok: true });
    });

    await route.PUT(
      new Request('http://evil.example/api/inngest', {
        method: 'PUT',
        headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' },
      }) as never,
      undefined,
    );

    expect(registered).toEqual([expect.objectContaining({ url: ENDPOINT })]);
  });
});

describe('dev mode', () => {
  it('is used only when INNGEST_DEV=1 and never on Vercel', () => {
    expect(isInngestDevMode({ INNGEST_DEV: '1' })).toBe(true);
    expect(isInngestDevMode({ INNGEST_DEV: '1', VERCEL: '1' })).toBe(false);
    expect(isInngestDevMode({ INNGEST_DEV: '1', FOODZ_DEPLOYMENT: 'production' })).toBe(false);
    expect(isInngestDevMode({ INNGEST_DEV: '1', ECS_CONTAINER_METADATA_URI_V4: 'http://x' })).toBe(
      false,
    );
    expect(isInngestDevMode({ INNGEST_DEV: 'true' })).toBe(false);
    expect(isInngestDevMode({})).toBe(false);
  });
});
