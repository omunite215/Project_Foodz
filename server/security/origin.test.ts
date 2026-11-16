import { describe, expect, it } from 'vitest';
import { isSameOrigin } from './origin';

const SITE = 'https://foodz.example';
const post = (origin?: string) =>
  new Request(`${SITE}/api/realtime/auth`, {
    method: 'POST',
    headers: origin ? { origin } : {},
  });

describe('isSameOrigin', () => {
  it('accepts requests from the site', () => {
    expect(isSameOrigin(post('https://foodz.example'), SITE)).toBe(true);
  });

  it.each([
    'https://evil.example',
    'https://foodz.example.evil.example',
    'http://foodz.example',
    'https://foodz.example:8443',
    'null',
    'not a url',
  ])('refuses %j', (origin) => {
    expect(isSameOrigin(post(origin), SITE)).toBe(false);
  });

  it('refuses requests without an Origin header, or when no site URL is configured', () => {
    expect(isSameOrigin(post(), SITE)).toBe(false);
    expect(isSameOrigin(post(SITE), '')).toBe(false);
  });
});
