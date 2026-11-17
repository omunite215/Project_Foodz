import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callAction,
  fieldError,
  fieldErrorsFrom,
  INTERNAL_MESSAGE,
  isOffline,
  OFFLINE_MESSAGE,
  readActionResult,
  TIMEOUT_MESSAGE,
} from './action-result';

describe('readActionResult', () => {
  it('passes data through', () => {
    expect(readActionResult({ data: { redirectTo: '/menu' } })).toEqual({
      ok: true,
      data: { redirectTo: '/menu' },
    });
  });

  it('keeps the safe parts of a server error', () => {
    const outcome = readActionResult({
      serverError: {
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Try again in 5 minutes, or reset your password.',
        retryAfterSeconds: 300,
        fieldErrors: { password: ['Use at least 10 characters.'], junk: 'not a list' },
        details: { radiusKm: 8 },
      },
    });
    expect(outcome).toEqual({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Try again in 5 minutes, or reset your password.',
        retryAfterSeconds: 300,
        fieldErrors: { password: ['Use at least 10 characters.'] },
        details: { radiusKm: 8 },
      },
    });
  });

  it('turns validation errors into field errors', () => {
    const outcome = readActionResult({
      validationErrors: { _errors: ['form'], email: { _errors: ['Enter an email address.'] } },
    });
    expect(outcome).toEqual({
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'Check the highlighted fields.',
        fieldErrors: { email: ['Enter an email address.'] },
      },
    });
    expect(fieldError(outcome.ok ? null : outcome.error, 'email')).toBe('Enter an email address.');
  });

  it('treats a missing or malformed answer as an internal error', () => {
    expect(readActionResult(undefined)).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: INTERNAL_MESSAGE },
    });
    expect(readActionResult({ serverError: 'boom' })).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: INTERNAL_MESSAGE },
    });
  });
});

describe('fieldErrorsFrom', () => {
  it('ignores anything that is not the formatted shape', () => {
    expect(fieldErrorsFrom(null)).toEqual({});
    expect(fieldErrorsFrom({ name: 'x', phone: { _errors: [1, 'Bad number'] } })).toEqual({
      phone: ['Bad number'],
    });
  });
});

describe('callAction', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('answers offline without calling when the browser is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const run = vi.fn<() => Promise<{ data: number }>>();
    expect(await callAction(run)).toEqual({
      ok: false,
      error: { code: 'OFFLINE', message: OFFLINE_MESSAGE },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('answers offline when the request fails on the network', async () => {
    const outcome = await callAction(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(outcome).toEqual({ ok: false, error: { code: 'OFFLINE', message: OFFLINE_MESSAGE } });
  });

  it('gives up after the time-out', async () => {
    vi.useFakeTimers();
    const pending = callAction(() => new Promise<never>(() => {}), { timeoutMs: 15_000 });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toEqual({
      ok: false,
      error: { code: 'TIMEOUT', message: TIMEOUT_MESSAGE },
    });
  });

  it('returns the data of a quick answer', async () => {
    expect(await callAction(async () => ({ data: 1 }))).toEqual({ ok: true, data: 1 });
  });
});

describe('isOffline', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('trusts only a real onLine flag', () => {
    vi.stubGlobal('navigator', {});
    expect(isOffline()).toBe(false);
    vi.stubGlobal('navigator', { onLine: true });
    expect(isOffline()).toBe(false);
    vi.stubGlobal('navigator', { onLine: false });
    expect(isOffline()).toBe(true);
  });
});
