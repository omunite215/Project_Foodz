import { describe, expect, it } from 'vitest';
import { buildCsp, originOf, permissionsPolicy } from './csp';

const directive = (csp: string, name: string) =>
  csp
    .split('; ')
    .find((part) => part.startsWith(`${name} `))
    ?.slice(name.length + 1)
    .split(' ') ?? [];

describe('buildCsp', () => {
  const csp = buildCsp({ nonce: 'abc123', isDev: false, isHttps: true });

  it('only allows scripts that carry the nonce', () => {
    const scripts = directive(csp, 'script-src');
    expect(scripts).toContain("'nonce-abc123'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  it('blocks plugins, framing and base-tag injection', () => {
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'self'"]);
    expect(directive(csp, 'form-action')).toEqual(["'self'"]);
  });

  it('upgrades insecure requests only on HTTPS deployments', () => {
    expect(csp).toContain('upgrade-insecure-requests');
    expect(buildCsp({ nonce: 'n', isDev: false, isHttps: false })).not.toContain(
      'upgrade-insecure-requests',
    );
  });

  it('allows eval only in development (needed for fast refresh)', () => {
    const dev = buildCsp({ nonce: 'n', isDev: true });
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'");
  });

  it('adds configured image and socket origins', () => {
    const custom = buildCsp({
      nonce: 'n',
      isDev: false,
      imageOrigins: ['https://cdn.example.com'],
      socketOrigins: ['wss://ws.example.com'],
    });
    expect(directive(custom, 'img-src')).toContain('https://cdn.example.com');
    expect(directive(custom, 'connect-src')).toContain('wss://ws.example.com');
  });
});

describe('permissionsPolicy', () => {
  it('offers geolocation only to the partner app and checkout', () => {
    expect(permissionsPolicy('/partner/active')).toContain('geolocation=(self)');
    expect(permissionsPolicy('/checkout')).toContain('geolocation=(self)');
    expect(permissionsPolicy('/menu')).toContain('geolocation=()');
  });

  it('always disables camera and microphone', () => {
    expect(permissionsPolicy('/')).toContain('camera=()');
    expect(permissionsPolicy('/')).toContain('microphone=()');
  });
});

describe('originOf', () => {
  it('extracts origins and ignores invalid input', () => {
    expect(originOf('https://bucket.example.com/path/x.png')).toBe('https://bucket.example.com');
    expect(originOf('not a url')).toBeUndefined();
    expect(originOf(undefined)).toBeUndefined();
  });
});
