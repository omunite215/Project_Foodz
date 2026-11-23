// Seeds the database: `npm run db:seed` locally, and the compose `migrate` job after migrations.
// Runs as the migrator role (DATABASE_MIGRATOR_URL), like the migrations themselves.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../server/db/generated/client';
import { sampleAccountsRefusal, seedDatabase } from './seeding';
import { writePartnerFixtureImages } from './seeding/partner-images';

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
  const databaseUrl = env('DATABASE_MIGRATOR_URL');
  // Sample customers: local and CI databases only, with a fresh password on every run.
  let samplePassword: string | undefined;
  if (['true', '1'].includes(process.env.SEED_SAMPLE_ACCOUNTS ?? '')) {
    const refusal = sampleAccountsRefusal(databaseUrl, process.env);
    if (refusal) throw new Error(`SEED_SAMPLE_ACCOUNTS is set, but ${refusal}. Unset it.`);
    samplePassword = randomBytes(18).toString('base64url');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const result = await seedDatabase(prisma, {
      authSecret: env('BETTER_AUTH_SECRET', { minLength: 32 }),
      adminEmail: env('SEED_ADMIN_EMAIL', { fallback: 'admin@foodz.example' }),
      adminPassword: env('SEED_ADMIN_PASSWORD', { minLength: 12 }),
      demoPassword: env('DEMO_PASSWORD', { minLength: 10 }),
      samplePassword,
      partnerKeys:
        process.env.FIELD_ENCRYPTION_KEY && process.env.ID_NUMBER_HASH_KEY
          ? { field: process.env.FIELD_ENCRYPTION_KEY, hash: process.env.ID_NUMBER_HASH_KEY }
          : undefined,
    });

    const created = Object.entries(result.created).filter(([, n]) => n > 0);
    process.stdout.write(
      created.length
        ? `Seeded: ${created.map(([name, n]) => `${n} ${name}`).join(', ')}.\n`
        : 'Seed: nothing to add, the database already has the seed data.\n',
    );

    if (samplePassword && result.created.partnerFixtures) {
      // F6: the partner fixtures' drawn photos and sample IDs.
      try {
        const images = await writePartnerFixtureImages();
        if (images === null) {
          process.stdout.write('Partner images skipped: storage is not configured.\n');
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'storage error';
        process.stdout.write(`Partner images not written (${reason}).\n`);
      }
    }

    if (samplePassword) {
      // Reset on every run. The browser tests read it from this output (E2E_SEED_OUTPUT).
      process.stdout.write(`Sample customers password (local and CI only): ${samplePassword}\n`);
    }

    if (result.staffTwoFactor?.length) {
      // Every run (local and CI only): the secrets are derived, so an authenticator is added
      // once; the backup codes are new each run. Copy this block to docs/local-staff-2fa.txt.
      process.stdout.write(
        [
          '',
          'Sample staff two-factor (local and CI only; same password as the sample customers):',
          ...result.staffTwoFactor.flatMap((member) => [
            `  ${member.email} (${member.name}, ${member.role})`,
            `    Authenticator: ${member.totpUri}`,
            `    Backup codes: ${member.backupCodes.join(' ')}`,
          ]),
          '',
        ].join('\n'),
      );
    }

    if (result.adminTwoFactor) {
      // Shown once: the secret is stored encrypted and cannot be read back.
      process.stdout.write(
        [
          '',
          'Admin two-factor setup (shown only this once, and for this database only):',
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
