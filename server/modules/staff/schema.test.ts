import { describe, expect, it } from 'vitest';
import { STEP_UP_ERRORS, stepUpInput } from './schema';

const messagesOf = (result: { error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('stepUpInput (A7.10)', () => {
  it('accepts six digits, with spaces or a dash', () => {
    expect(stepUpInput.parse({ method: 'totp', code: '123 456' })).toEqual({
      method: 'totp',
      code: '123456',
    });
    expect(stepUpInput.parse({ method: 'totp', code: '123-456' }).code).toBe('123456');
  });

  it('accepts a backup code', () => {
    expect(stepUpInput.parse({ method: 'backup', code: ' AbCdE-12345 ' })).toEqual({
      method: 'backup',
      code: 'AbCdE-12345',
    });
  });

  it.each([
    [{ method: 'totp', code: '12345' }, STEP_UP_ERRORS.totpFormat],
    [{ method: 'totp', code: '1234567' }, STEP_UP_ERRORS.totpFormat],
    [{ method: 'totp', code: 'abcdef' }, STEP_UP_ERRORS.totpFormat],
    [{ method: 'backup', code: 'no' }, STEP_UP_ERRORS.backupFormat],
    [{ method: 'backup', code: 'has space!' }, STEP_UP_ERRORS.backupFormat],
  ])('refuses %j', (input, message) => {
    expect(messagesOf(stepUpInput.safeParse(input))).toEqual([message]);
  });

  it('refuses other methods, long codes and unknown fields', () => {
    expect(stepUpInput.safeParse({ method: 'sms', code: '123456' }).success).toBe(false);
    expect(stepUpInput.safeParse({ method: 'backup', code: 'x'.repeat(65) }).success).toBe(false);
    expect(stepUpInput.safeParse({ method: 'totp', code: '123456', orderId: 'x' }).success).toBe(
      false,
    );
  });
});
