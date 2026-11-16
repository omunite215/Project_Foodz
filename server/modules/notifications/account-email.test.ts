import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn<(event: unknown) => Promise<unknown>>(),
  sendEmail: vi.fn<(email: { to: string; subject: string; text: string }) => Promise<void>>(),
}));
vi.mock('@/server/jobs/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/jobs/client')>()),
  inngest: { send: mocks.send },
}));
vi.mock('@/server/notifications/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/notifications/email')>()),
  sendEmail: mocks.sendEmail,
}));

process.env.LOG_LEVEL = 'silent';
process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.NEXT_PUBLIC_SITE_URL = 'https://foodz.example';

const { deliverAccountEmail, queueAccountEmail, renderAccountEmail, unsealAccountEmail } =
  await import('./account-email');

const confirm = {
  kind: 'verify-email' as const,
  to: 'maya@example.com',
  name: 'Maya <b>Lopez</b>',
  url: 'https://foodz.example/api/auth/verify-email?token=abc&callbackURL=%2Fverify-email',
};

beforeEach(() => {
  mocks.send.mockReset().mockResolvedValue({ ids: ['evt'] });
  mocks.sendEmail.mockReset().mockResolvedValue();
});

describe('account emails', () => {
  it('queues an encrypted payload that holds neither the address nor the link in clear', async () => {
    await queueAccountEmail(confirm);
    const event = mocks.send.mock.calls[0]?.[0] as { name: string; data: { sealed: string } };
    expect(event.name).toBe('account.email-requested');
    expect(event.data.sealed).not.toContain('maya@example.com');
    expect(event.data.sealed).not.toContain('token=abc');
    expect(unsealAccountEmail(event.data.sealed)).toEqual(confirm);
  });

  it('sends the decrypted email from the job', async () => {
    await queueAccountEmail(confirm);
    const event = mocks.send.mock.calls[0]?.[0] as { data: { sealed: string } };
    await expect(deliverAccountEmail(event.data.sealed)).resolves.toBe('sent');
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'maya@example.com', subject: 'Confirm your email for Foodz' }),
    );
  });

  it('refuses a tampered payload', async () => {
    await queueAccountEmail(confirm);
    const event = mocks.send.mock.calls[0]?.[0] as { data: { sealed: string } };
    const tampered = `${event.data.sealed.slice(0, -2)}AA`;
    await expect(deliverAccountEmail(tampered)).rejects.toThrow('Could not decrypt field');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('logs instead of failing the request when the queue is down', async () => {
    mocks.send.mockRejectedValue(new Error('queue down'));
    await expect(queueAccountEmail(confirm)).resolves.toBeUndefined();
  });

  it('writes the confirm email with the expiry, a button, the plain link and a text part', () => {
    const email = renderAccountEmail(confirm);
    expect(email.text).toContain('The link works for 24 hours.');
    expect(email.text).toContain(confirm.url);
    expect(email.html).toContain('>Confirm email</a>');
    // The name is escaped, never markup.
    expect(email.html).not.toContain('<b>Lopez');
    expect(email.html).toContain('Hi Maya,');
    expect(email.html.toLowerCase()).not.toContain('click here');
  });

  it.each([
    [
      { kind: 'reset-password', to: 'a@b.co', name: 'A', url: 'https://foodz.example/r' },
      'Reset your Foodz password',
      '30 minutes',
    ],
    [
      { kind: 'password-changed', to: 'a@b.co', name: 'A' },
      'Your Foodz password was changed',
      "If this wasn't you, reset it now and contact us.",
    ],
    [
      { kind: 'account-exists', to: 'a@b.co' },
      'Someone tried to sign up with your email',
      'Someone tried to create a Foodz account with this address. If it was you, sign in or reset your password.',
    ],
    [
      { kind: 'account-deleted', to: 'a@b.co', name: 'A' },
      'Your Foodz account has been deleted',
      'Past orders are kept',
    ],
  ] as const)('writes %o', (message, subject, phrase) => {
    const email = renderAccountEmail(message);
    expect(email.subject).toBe(subject);
    expect(email.text).toContain(phrase);
  });
});
