import { createRequire } from 'node:module';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { db } from '@/server/db/client';
import { runAsSystem } from '@/server/db/context';
import { PrismaClient } from '@/server/db/generated/client';
import { seedCatalog } from '../../prisma/seeding';

// The driver the app's database adapter loads.
const pg = createRequire(import.meta.url)('pg') as typeof import('pg');
const query = Object.getOwnPropertyDescriptor(pg.Client.prototype, 'query')!;
const originalQuery = query.value as (...args: unknown[]) => unknown;

let migrator: PrismaClient;

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
}, 120_000);

afterEach(() => {
  Object.defineProperty(pg.Client.prototype, 'query', query);
});

afterAll(async () => {
  await migrator.$disconnect();
});

describe('runAs', () => {
  it('refuses a transaction opened inside another one', async () => {
    await expect(runAsSystem('outer', () => runAsSystem('inner', async () => 1))).rejects.toThrow(
      'runAs was called inside another runAs transaction',
    );
  });

  it('lets work a transaction left running open its own once that transaction has ended', async () => {
    let release: (() => void) | undefined;
    const ended = new Promise<void>((resolve) => (release = resolve));
    let later: Promise<number> | undefined;
    await runAsSystem('outer', async () => {
      later = ended.then(() => runAsSystem('later', async () => 2));
    });
    release?.();
    await expect(later).resolves.toBe(2);
  });

  it('still runs separate transactions side by side', async () => {
    await expect(
      Promise.all([runAsSystem('first', async () => 1), runAsSystem('second', async () => 2)]),
    ).resolves.toEqual([1, 2]);
  });

  it('sends the queries of one transaction to its connection one at a time', async () => {
    const running = new Map<object, number>();
    let most = 0;
    Object.defineProperty(pg.Client.prototype, 'query', {
      ...query,
      value(this: object, ...args: unknown[]) {
        const now = (running.get(this) ?? 0) + 1;
        running.set(this, now);
        most = Math.max(most, now);
        const done = () => running.set(this, (running.get(this) ?? 1) - 1);
        const result = Reflect.apply(originalQuery, this, args);
        if (result instanceof Promise) return result.finally(done);
        done();
        return result;
      },
    });

    // Prisma loads each of these relations with its own query, and starts them together.
    const dishes = await runAsSystem('relations', (ctx) =>
      db(ctx).menuItem.findMany({
        take: 3,
        select: {
          id: true,
          campaigns: { select: { id: true } },
          favorites: { select: { userId: true } },
          reviews: { select: { id: true } },
        },
      }),
    );

    expect(dishes).toHaveLength(3);
    expect(most).toBe(1);
  });
});
