// Puts F9's earnings and rating fixtures back (`npm run seed:earnings`, story E11.1): Luis's and
// Diego's weeks, Grace's rated deliveries, the payout, the cash hand-in, online sessions and
// S2209. T is now, or `--at=2026-11-20T19:46:00-05:00`; entries after T are left out. Local and
// CI databases only; runs as the migrator role, like the seed, after `seed:partners`.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../server/db/generated/client';
import { sampleAccountsRefusal } from './seeding';
import { resetEarningsFixtures } from './seeding/earnings';
import { partnerFixtureId } from './seeding/partners';

async function main() {
  const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!databaseUrl) throw new Error('DATABASE_MIGRATOR_URL must be set. See .env.example.');
  const refusal = sampleAccountsRefusal(databaseUrl, process.env);
  if (refusal) throw new Error(`The earnings fixtures are local and CI only, but ${refusal}.`);
  const atArgument = process.argv.find((value) => value.startsWith('--at='))?.slice(5);
  const at = atArgument ? new Date(atArgument) : new Date();
  if (Number.isNaN(at.getTime())) throw new Error('--at must be an ISO date and time.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@foodz.example';
    const staff = await prisma.user.findMany({
      where: { email: { in: ['support@foodz.example', adminEmail] } },
      select: { id: true, email: true },
    });
    const morgan = staff.find((user) => user.email === 'support@foodz.example');
    const admin = staff.find((user) => user.email === adminEmail);
    if (!morgan || !admin) throw new Error('Run the seed with SEED_SAMPLE_ACCOUNTS=1 first.');
    const people = {
      luis: partnerFixtureId('luis'),
      diego: partnerFixtureId('diego'),
      grace: partnerFixtureId('grace'),
      morgan: morgan.id,
      admin: admin.id,
    };
    const found = await prisma.deliveryPartner.count({
      where: { id: { in: [people.luis, people.diego, people.grace] } },
    });
    if (found < 3) throw new Error('Run `npm run seed:partners` first.');
    const written = await prisma.$transaction((tx) => resetEarningsFixtures(tx, people, at), {
      timeout: 120_000,
    });
    console.warn(`Earnings fixtures: ${written} deliveries written for T = ${at.toISOString()}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
