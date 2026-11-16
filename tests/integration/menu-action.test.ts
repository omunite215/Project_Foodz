import { afterAll, describe, expect, it, vi } from 'vitest';
import { redis } from '@/server/redis';

// The action reads the caller's address from the request headers; each test uses its own.
const caller = vi.hoisted(() => ({ ip: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': caller.ip }),
}));

const { dishesByIdAction } = await import('@/server/modules/menu/actions');

// A fresh address per test, so each starts with a full rate-limit allowance.
const newCaller = () => {
  caller.ip = `test-${crypto.randomUUID()}`;
};

afterAll(() => redis.quit());

describe('checking dishes by id from the browser', () => {
  it('answers a valid request and refuses a malformed one without detail', async () => {
    newCaller();
    expect((await dishesByIdAction({ ids: [crypto.randomUUID()] }))?.data).toEqual([]);

    const tooMany = Array.from({ length: 51 }, () => crypto.randomUUID());
    for (const input of [{ ids: [] }, { ids: ['gimbap'] }, { ids: tooMany }]) {
      const result = await dishesByIdAction(input);
      expect(result?.data).toBeUndefined();
      expect(result?.validationErrors).toBeDefined();
    }
  });

  it('is limited to 60 calls a minute per caller, invalid ones included', async () => {
    newCaller();
    const ids = [crypto.randomUUID()];
    for (let i = 0; i < 30; i++) await dishesByIdAction({ ids });
    for (let i = 0; i < 30; i++) await dishesByIdAction({ ids: ['not-an-id'] });

    expect((await dishesByIdAction({ ids }))?.serverError).toMatchObject({ code: 'RATE_LIMITED' });

    // Another caller is not affected.
    newCaller();
    expect((await dishesByIdAction({ ids }))?.data).toEqual([]);
  });
});
