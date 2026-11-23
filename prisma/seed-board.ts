// Puts the order board's fixtures S1101 to S1108 back to their states and relative times
// (`npm run seed:board`, F5). Local and CI databases only; touches no other order. Runs as the
// migrator role, like the seed.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../server/db/generated/client';
import { BOARD_FIXTURE_NUMBERS, resetBoardFixtures } from './seeding/board';
import { sampleAccountsRefusal } from './seeding';

const PEOPLE = {
  priya: 'second.customer@foodz.example',
  dana: 'demo.customer@foodz.example',
  alex: 'kitchen@foodz.example',
  morgan: 'support@foodz.example',
} as const;

async function main() {
  const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!databaseUrl) throw new Error('DATABASE_MIGRATOR_URL must be set. See .env.example.');
  const refusal = sampleAccountsRefusal(databaseUrl, process.env);
  if (refusal) throw new Error(`The board fixtures are local and CI only, but ${refusal}.`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(PEOPLE) } },
      select: { id: true, email: true },
    });
    const idOf = (email: string) => {
      const id = users.find((user) => user.email === email)?.id;
      if (!id) {
        throw new Error(`${email} is missing. Run the seed with SEED_SAMPLE_ACCOUNTS=1 first.`);
      }
      return id;
    };
    const people = {
      priya: idOf(PEOPLE.priya),
      dana: idOf(PEOPLE.dana),
      alex: idOf(PEOPLE.alex),
      morgan: idOf(PEOPLE.morgan),
    };
    await prisma.$transaction((tx) => resetBoardFixtures(tx, people, new Date()), {
      timeout: 30_000,
    });
    process.stdout.write(`Board fixtures reset: ${BOARD_FIXTURE_NUMBERS.join(', ')}.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
