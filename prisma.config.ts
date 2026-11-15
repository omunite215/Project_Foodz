import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Migrations always run as the migrator role; the app itself connects as foodz_app.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Not needed for `prisma generate`, so builds work without database credentials.
    url: process.env.DATABASE_MIGRATOR_URL ?? '',
  },
});
