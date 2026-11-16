import { describe, expect, it } from 'vitest';
import { notifyInput } from './schema';

const valid = {
  userId: '0196a1b2-0000-7000-8000-000000000001',
  type: 'order.ready',
  title: 'Your order is ready',
  body: 'Riley is picking it up now.',
  link: '/orders/0196a1b2-0000-7000-8000-0000000000b1',
};

describe('notifyInput', () => {
  it('accepts a notification and defaults to no email', () => {
    expect(notifyInput.parse(valid)).toEqual({ ...valid, email: false });
    expect(notifyInput.parse({ ...valid, link: undefined, email: true }).email).toBe(true);
  });

  it.each([
    'https://evil.example/phish',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'orders/1',
    '/orders/1 extra',
    `/${'a'.repeat(300)}`,
  ])('rejects the link %j', (link) => {
    expect(notifyInput.safeParse({ ...valid, link }).success).toBe(false);
  });

  it.each(['Order.Ready', 'order ready', 'order..ready', '', 'x'.repeat(51)])(
    'rejects the type %j',
    (type) => {
      expect(notifyInput.safeParse({ ...valid, type }).success).toBe(false);
    },
  );

  it('rejects empty or oversized text and unknown fields', () => {
    expect(notifyInput.safeParse({ ...valid, title: '   ' }).success).toBe(false);
    expect(notifyInput.safeParse({ ...valid, body: 'x'.repeat(501) }).success).toBe(false);
    expect(notifyInput.safeParse({ ...valid, readAt: new Date() }).success).toBe(false);
    expect(notifyInput.safeParse({ ...valid, userId: 'someone' }).success).toBe(false);
  });
});
