import type { PrismaClient } from '@/server/db/generated/client';

/*
 * Bulk ledger data for the F9 suites (story E11.1 `seedBulkEarnings`). Written by the table
 * owner straight into the day totals, which is all the report reads; there are no entries
 * behind them, so `clearBulkEarnings` removes them before the nightly check runs elsewhere.
 */

export const BULK_PREFIX = 'Scale Partner ';

/** `partners` approved partners, each with `days` days of figures ending today. */
export async function seedBulkEarnings(migrator: PrismaClient, partners: number, days = 365) {
  await migrator.$executeRaw`
    WITH people AS (
      INSERT INTO users (id, name, email, role, created_at, updated_at)
      SELECT gen_random_uuid(), ${BULK_PREFIX} || g, 'scale-' || g || '-' || gen_random_uuid() || '@test.dev',
             'partner', now(), now()
      FROM generate_series(1, ${partners}::int) g
      RETURNING id
    ), created AS (
      INSERT INTO delivery_partners (id, user_id, status, vehicle_type, approved_at, updated_at)
      SELECT gen_random_uuid(), id, 'APPROVED', 'SCOOTER', now(), now() FROM people
      RETURNING id
    )
    INSERT INTO partner_ledger_days (partner_id, day, pool, deliveries, delivery_pay_cents, tips_cents, net_cents)
    SELECT c.id, app_store_date(app_now()) - d, 'REAL', 5, 1500, 400, 1900
    FROM created c CROSS JOIN generate_series(0, ${days - 1}::int) d`;
}

export async function clearBulkEarnings(migrator: PrismaClient) {
  await migrator.$executeRaw`
    DELETE FROM partner_ledger_days d USING delivery_partners p, users u
    WHERE d.partner_id = p.id AND u.id = p.user_id AND u.name LIKE ${`${BULK_PREFIX}%`}`;
}
