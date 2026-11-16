// Seeds the database: `npm run db:seed` locally, and the compose `migrate` job after migrations.
// Runs as the migrator role (DATABASE_MIGRATOR_URL), like the migrations themselves.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../server/db/generated/client';
import { seedDatabase } from './seeding';

function env(
  name: string,
  { minLength = 1, fallback }: { minLength?: number; fallback?: string } = {},
) {
  const value = process.env[name] || fallback;
  if (!value || value.length < minLength) {
    throw new Error(`${name} must be set (at least ${minLength} characters). See .env.example.`);
  }
  return value;
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env('DATABASE_MIGRATOR_URL') }),
  });
  try {
    const result = await seedDatabase(prisma, {
      authSecret: env('BETTER_AUTH_SECRET', { minLength: 32 }),
      adminEmail: env('SEED_ADMIN_EMAIL', { fallback: 'admin@foodz.example' }),
      adminPassword: env('SEED_ADMIN_PASSWORD', { minLength: 12 }),
      demoPassword: env('DEMO_PASSWORD', { minLength: 10 }),
    });

    const created = Object.entries(result.created).filter(([, n]) => n > 0);
    process.stdout.write(
      created.length
        ? `Seeded: ${created.map(([name, n]) => `${n} ${name}`).join(', ')}.\n`
        : 'Seed: nothing to add, the database already has the seed data.\n',
    );

    if (result.adminTwoFactor) {
      // Shown once: the secret is stored encrypted and cannot be read back.
      process.stdout.write(
        [
          '',
          'Admin two-factor setup (shown only this once):',
          `  Add to your authenticator app: ${result.adminTwoFactor.totpUri}`,
          `  Backup codes: ${result.adminTwoFactor.backupCodes.join(' ')}`,
          '',
        ].join('\n'),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
