import { describe, expect, it } from 'vitest';
import { readConfig } from '../lib/config';

const base = { pusherKey: 'k', turnstileSiteKey: 't' };
const read = (context: Record<string, unknown>) => readConfig((key) => context[key]);

describe('readConfig', () => {
  it('uses the defaults for a minimal deployment', () => {
    expect(read(base)).toMatchObject({
      imageTag: 'latest',
      webCount: 1,
      realtime: 'soketi',
      jobs: 'inngest',
      stripe: false,
      retainData: true,
    });
  });

  it('refuses a custom domain without its certificate, and a certificate outside us-east-1', () => {
    expect(() => read({ ...base, domainName: 'foodz.example' })).toThrow(/together/);
    expect(() =>
      read({
        ...base,
        domainName: 'foodz.example',
        certificateArn: 'arn:aws:acm:eu-west-1:123456789012:certificate/abc',
      }),
    ).toThrow(/us-east-1/);
  });

  it('needs the public Pusher settings when Pusher Channels is chosen', () => {
    expect(() => read({ turnstileSiteKey: 't', realtime: 'pusher' })).toThrow(/pusher/);
    expect(read({ ...base, realtime: 'pusher', pusherAppId: '1' }).realtime).toBe('pusher');
  });

  it('rejects unknown choices and bad numbers', () => {
    expect(() => read({ ...base, jobs: 'cron' })).toThrow(/jobs/);
    expect(() => read({ ...base, webCount: 11 })).toThrow(/webCount/);
    expect(() => read({ ...base, imageTag: 'bad tag' })).toThrow(/imageTag/);
  });

  it('needs the Turnstile site key and, for Stripe, the publishable key', () => {
    expect(() => read({ pusherKey: 'k' })).toThrow(/turnstileSiteKey/);
    expect(() => read({ ...base, stripe: 'true' })).toThrow(/stripePublishableKey/);
  });
});
