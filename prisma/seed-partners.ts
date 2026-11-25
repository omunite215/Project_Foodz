// Puts the partner fixtures back to their states and relative dates (`npm run seed:partners`,
// F6 B18, B34): undoes staff decisions made on them during QA, takes them offline and restores
// their drawn documents. Local and CI databases only; touches no real account. Runs as the
// migrator role, like the seed.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import Redis from 'ioredis';
import { PrismaClient } from '../server/db/generated/client';
import { sampleAccountsRefusal } from './seeding';
import { writePartnerFixtureImages } from './seeding/partner-images';
import {
  FIXTURE_KEYS,
  fixtureAccounts,
  PARTNER_ACCOUNTS,
  partnerFixtureId,
  ensureDemoCourier,
  resetPartnerFixtures,
} from './seeding/partners';

async function main() {
  const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!databaseUrl) throw new Error('DATABASE_MIGRATOR_URL must be set. See .env.example.');
  const refusal = sampleAccountsRefusal(databaseUrl, process.env);
  if (refusal) throw new Error(`The partner fixtures are local and CI only, but ${refusal}.`);
  const field = process.env.FIELD_ENCRYPTION_KEY;
  const hash = process.env.ID_NUMBER_HASH_KEY;
  if (!field || !hash) throw new Error('FIELD_ENCRYPTION_KEY and ID_NUMBER_HASH_KEY must be set.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@foodz.example';
    const emails = [
      ...PARTNER_ACCOUNTS.map((account) => account.email),
      'support@foodz.example',
      adminEmail,
    ];
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true },
    });
    const idOf = (email: string) => {
      const user = users.find((row) => row.email === email);
      if (!user) {
        throw new Error(`${email} is missing. Run the seed with SEED_SAMPLE_ACCOUNTS=1 first.`);
      }
      return user.id;
    };
    const accounts = fixtureAccounts(
      Object.fromEntries(PARTNER_ACCOUNTS.map((account) => [account.key, idOf(account.email)])),
    );

    await prisma.$transaction(
      async (tx) => {
        // Roles, bans and phones go back too (a QA approval made Ana a partner).
        for (const account of PARTNER_ACCOUNTS) {
          await tx.user.update({
            where: { email: account.email },
            data: {
              role: account.role,
              banned: account.banned,
              banReason: account.banReason,
              phone: account.phone,
            },
          });
        }
        await ensureDemoCourier(tx);
        await resetPartnerFixtures(
          tx,
          {
            accounts,
            morgan: { id: idOf('support@foodz.example'), name: 'Morgan Diaz' },
            admin: { id: idOf(adminEmail), name: 'Foodz Admin' },
          },
          { field, hash },
          new Date(),
        );
      },
      { timeout: 30_000 },
    );

    if (process.env.REDIS_URL) {
      const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
      await redis.del(...FIXTURE_KEYS.map((key) => `partner:loc:${partnerFixtureId(key)}`));
      redis.disconnect();
    }
    const images = await writePartnerFixtureImages();
    process.stdout.write(
      images === null
        ? 'Partner fixtures reset (storage is not configured: no images written).\n'
        : `Partner fixtures reset with ${images} images.\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
