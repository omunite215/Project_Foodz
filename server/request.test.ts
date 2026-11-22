import { describe, expect, it } from 'vitest';
import {
  clientIp,
  clientIpOptInRefused,
  clientIpSource,
  clientIpWarning,
  UNKNOWN_CLIENT,
} from './client-ip';

const h = (values: Record<string, string>) => new Headers(values);

describe('clientIp on Vercel', () => {
  const vercel = { VERCEL: '1' };

  it('trusts only the platform header', () => {
    expect(
      clientIp(
        h({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }),
        vercel,
      ),
    ).toBe('203.0.113.7');
    expect(clientIp(h({ 'x-forwarded-for': '1.1.1.1' }), vercel)).toBe(UNKNOWN_CLIENT);
  });

  it('ignores the test-only switch', () => {
    const env = { ...vercel, CLIENT_IP_FROM_HEADER: '1' };
    expect(clientIpSource(env)).toBe('vercel');
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6' }), env)).toBe(UNKNOWN_CLIENT);
  });
});

describe('clientIp behind trusted proxies', () => {
  it('ignores addresses the client prepends when one proxy appends the real one', () => {
    const oneProxy = { TRUSTED_PROXY_HOPS: '1' };
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 198.51.100.4' }), oneProxy)).toBe(
      '198.51.100.4',
    );
    expect(clientIp(h({ 'x-forwarded-for': '198.51.100.4' }), oneProxy)).toBe('198.51.100.4');
  });

  it('counts back past each trusted proxy', () => {
    expect(
      clientIp(h({ 'x-forwarded-for': '6.6.6.6, 198.51.100.4, 10.0.0.2' }), {
        TRUSTED_PROXY_HOPS: '2',
      }),
    ).toBe('198.51.100.4');
  });

  it('never falls back to a header the proxy does not write', () => {
    expect(clientIp(h({ 'x-real-ip': '192.0.2.9' }), { TRUSTED_PROXY_HOPS: '1' })).toBe(
      UNKNOWN_CLIENT,
    );
  });

  it('keeps the hop count within bounds', () => {
    const chain = h({ 'x-forwarded-for': '198.51.100.4, 10.0.0.2' });
    expect(clientIp(chain, { TRUSTED_PROXY_HOPS: '99' })).toBe('198.51.100.4');
    expect(clientIpSource({ TRUSTED_PROXY_HOPS: '-3' })).toBe('none');
    expect(clientIpSource({ TRUSTED_PROXY_HOPS: 'many' })).toBe('none');
  });
});

describe('clientIp with no trusted source', () => {
  it('never reads client headers: every client shares one key', () => {
    for (const env of [{}, { TRUSTED_PROXY_HOPS: '0' }, { CLIENT_IP_FROM_HEADER: '0' }]) {
      expect(clientIpSource(env)).toBe('none');
      expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6' }), env)).toBe(UNKNOWN_CLIENT);
      expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 127.0.0.1' }), env)).toBe(UNKNOWN_CLIENT);
      expect(clientIp(h({ 'x-real-ip': '192.0.2.9' }), env)).toBe(UNKNOWN_CLIENT);
    }
  });

  it('warns at start-up in production, and only there', () => {
    expect(clientIpWarning({ NODE_ENV: 'production' })).toMatch(/TRUSTED_PROXY_HOPS=1/);
    expect(clientIpWarning({ NODE_ENV: 'development' })).toBeNull();
    expect(clientIpWarning({ NODE_ENV: 'production', TRUSTED_PROXY_HOPS: '1' })).toBeNull();
    expect(clientIpWarning({ NODE_ENV: 'production', VERCEL: '1' })).toBeNull();
  });
});

describe('the test-only switch (CLIENT_IP_FROM_HEADER)', () => {
  const tests = { CLIENT_IP_FROM_HEADER: '1', NODE_ENV: 'production' };

  it('uses the rightmost forwarded entry, then x-real-ip', () => {
    expect(clientIpSource(tests)).toBe('test-header');
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 10.1.2.3' }), tests)).toBe('10.1.2.3');
    expect(clientIp(h({ 'x-forwarded-for': '::1' }), tests)).toBe('::1');
    expect(clientIp(h({ 'x-real-ip': '192.0.2.9' }), tests)).toBe('192.0.2.9');
    expect(clientIp(h({}), tests)).toBe(UNKNOWN_CLIENT);
    expect(clientIpSource({ CLIENT_IP_FROM_HEADER: 'true' })).toBe('test-header');
  });

  it('refuses values that are not address-like', () => {
    expect(clientIp(h({ 'x-forwarded-for': 'rl:* evil' }), tests)).toBe(UNKNOWN_CLIENT);
    expect(clientIp(h({ 'x-forwarded-for': 'a'.repeat(100) }), tests)).toBe(UNKNOWN_CLIENT);
  });

  it('says it is on at start-up', () => {
    expect(clientIpWarning(tests)).toMatch(/tests only/);
  });

  it('is refused on Vercel production and does nothing there', () => {
    const production = { CLIENT_IP_FROM_HEADER: '1', VERCEL_ENV: 'production' };
    expect(clientIpOptInRefused(production)).toBe(true);
    expect(clientIpSource(production)).toBe('none');
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6' }), production)).toBe(UNKNOWN_CLIENT);
    expect(clientIpOptInRefused({ CLIENT_IP_FROM_HEADER: '1', VERCEL_ENV: 'preview' })).toBe(false);
    expect(clientIpOptInRefused({ VERCEL_ENV: 'production' })).toBe(false);
  });

  it('loses to a configured proxy', () => {
    const env = { CLIENT_IP_FROM_HEADER: '1', TRUSTED_PROXY_HOPS: '1' };
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 198.51.100.4' }), env)).toBe('198.51.100.4');
  });
});
