import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

function capture(fields: Record<string, unknown>) {
  const lines: string[] = [];
  const log = createLogger({ write: (line: string) => lines.push(line) });
  log.warn(fields, 'test line');
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

const SECRET = 'do-not-log-me';

describe('logger redaction', () => {
  it.each([
    'password',
    'newPassword',
    'currentPassword',
    'token',
    'captchaToken',
    'secret',
    'cookie',
    'url',
    'sealed',
    'email',
    'newEmail',
    'phone',
    'ipAddress',
    'line1',
    'line2',
    'notes',
    'lat',
    'lng',
    'code',
    'clientSecret',
    'contactName',
    'kitchenNote',
  ])('hides %s at the top level and in form input', (key) => {
    const line = capture({ [key]: SECRET, input: { [key]: SECRET } });
    expect(line[key]).toBe('[redacted]');
    expect(line.input).toEqual({ [key]: '[redacted]' });
    expect(JSON.stringify(line)).not.toContain(SECRET);
  });

  it('hides one level down for any parent', () => {
    const line = capture({
      user: { email: SECRET, newEmail: SECRET },
      address: { line2: SECRET, notes: SECRET, lat: 42.35, lng: -71.04 },
      event: { data: { sealed: SECRET } },
      req: { headers: { cookie: SECRET, authorization: SECRET } },
      nested: { deeper: { token: SECRET, password: SECRET } },
    });
    expect(JSON.stringify(line)).not.toContain(SECRET);
    expect(JSON.stringify(line)).not.toContain('42.35');
  });

  it('keeps error codes and the fields logs rely on', () => {
    const error = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
    const line = capture({ err: error, flow: 'sign-in', errorCode: 'INVALID_TOKEN', policy: 'x' });
    expect(line).toMatchObject({ flow: 'sign-in', errorCode: 'INVALID_TOKEN', policy: 'x' });
    expect((line.err as { code?: string }).code).toBe('ECONNREFUSED');
  });
});
