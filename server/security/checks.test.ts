import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { checkPasswordBreach } from './breached-passwords';
import { checkTurnstile, turnstileError } from './turnstile';

const suffixOf = (password: string) =>
  createHash('sha1').update(password).digest('hex').toUpperCase().slice(5);

describe('checkPasswordBreach', () => {
  it('sends only the five-character prefix and finds a breached password', async () => {
    const password = 'password123';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(`0000000000000000000000000000000000A:0\r\n${suffixOf(password)}:4242`),
      );
    expect(await checkPasswordBreach(password, fetchImpl)).toBe('breached');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toMatch(/^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/);
    expect(url).not.toContain(suffixOf(password));
    expect(new Headers(init?.headers).get('add-padding')).toBe('true');
  });

  it('treats padding entries and missing entries as clean', async () => {
    const password = 'a long unusual passphrase';
    const padded = vi.fn<typeof fetch>().mockResolvedValue(new Response(`${suffixOf(password)}:0`));
    expect(await checkPasswordBreach(password, padded)).toBe('clean');
    const absent = vi.fn<typeof fetch>().mockResolvedValue(new Response('ABC:1'));
    expect(await checkPasswordBreach(password, absent)).toBe('clean');
  });

  it('reports unknown when the service fails, so the caller can decide', async () => {
    const down = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network'));
    expect(await checkPasswordBreach('whatever123', down)).toBe('unknown');
    const busy = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    expect(await checkPasswordBreach('whatever123', busy)).toBe('unknown');
  });
});

describe('checkTurnstile', () => {
  it('passes, fails or reports the service as unavailable', async () => {
    const ok = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true }));
    expect(await checkTurnstile('token', '203.0.113.1', ok)).toBe('passed');
    const sent = ok.mock.calls[0]![1]!.body as URLSearchParams;
    expect(sent.get('remoteip')).toBe('203.0.113.1');

    const no = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: false }));
    expect(await checkTurnstile('token', undefined, no)).toBe('failed');

    const down = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    expect(await checkTurnstile('token', undefined, down)).toBe('unavailable');

    const odd = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>'));
    expect(await checkTurnstile('token', undefined, odd)).toBe('unavailable');
  });

  it('does not call the service without a token', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await checkTurnstile(undefined, undefined, fetchImpl)).toBe('missing');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('explains each failure in plain words', () => {
    expect(turnstileError('missing')).toMatchObject({ code: 'CAPTCHA_REQUIRED', status: 403 });
    expect(turnstileError('failed')).toMatchObject({ code: 'CAPTCHA_FAILED' });
    expect(turnstileError('unavailable')).toMatchObject({
      code: 'CAPTCHA_UNAVAILABLE',
      status: 503,
      message: "We couldn't run our quick security check. Check your connection, then try again.",
    });
  });
});
