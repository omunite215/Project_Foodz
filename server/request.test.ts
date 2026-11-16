import { describe, expect, it } from 'vitest';
import { clientIp } from './request';

const h = (values: Record<string, string>) => new Headers(values);

describe('clientIp', () => {
  it('trusts only the platform header on Vercel', () => {
    const vercel = { VERCEL: '1' };
    expect(
      clientIp(
        h({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }),
        vercel,
      ),
    ).toBe('203.0.113.7');
    expect(clientIp(h({ 'x-forwarded-for': '1.1.1.1' }), vercel)).toBe('unknown');
  });

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

  it('uses the rightmost entry with no proxy configured, never the leftmost', () => {
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 127.0.0.1' }), {})).toBe('127.0.0.1');
    expect(clientIp(h({ 'x-forwarded-for': '::1' }), {})).toBe('::1');
  });

  it('falls back to x-real-ip, then to unknown', () => {
    expect(clientIp(h({ 'x-real-ip': '192.0.2.9' }), {})).toBe('192.0.2.9');
    expect(clientIp(h({}), {})).toBe('unknown');
  });

  it('refuses values that are not address-like', () => {
    expect(clientIp(h({ 'x-forwarded-for': 'rl:* evil' }), {})).toBe('unknown');
    expect(clientIp(h({ 'x-forwarded-for': 'a'.repeat(100) }), {})).toBe('unknown');
  });

  it('keeps the hop count within bounds', () => {
    const chain = h({ 'x-forwarded-for': '198.51.100.4, 10.0.0.2' });
    expect(clientIp(chain, { TRUSTED_PROXY_HOPS: '99' })).toBe('198.51.100.4');
    expect(clientIp(chain, { TRUSTED_PROXY_HOPS: '-3' })).toBe('10.0.0.2');
    expect(clientIp(chain, { TRUSTED_PROXY_HOPS: 'many' })).toBe('10.0.0.2');
  });
});
