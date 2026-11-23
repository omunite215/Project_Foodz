import 'server-only';
import type { DbContext } from '@/server/db/context';
import { requestInfo } from '@/server/request';
import { type AuditEntry, hasAuditEntry, insertAuditEntry } from './repo';

/**
 * Records a privileged or security-relevant action in the append-only audit log. Runs in the
 * caller's transaction, so the entry is saved only if the action itself succeeds.
 */
export async function audit(ctx: DbContext, entry: Omit<AuditEntry, 'ip' | 'userAgent'>) {
  let ip: string | undefined;
  let userAgent: string | undefined;
  try {
    ({ ip, userAgent } = await requestInfo());
  } catch {
    // Background jobs have no request; the actor is enough.
  }
  await insertAuditEntry(ctx, { ...entry, ip, userAgent });
}

/**
 * `audit`, once per `data[key]`: a retried job that meets the same outside record again (the
 * same Stripe refund, say) doesn't log it twice.
 */
export async function auditOnce(
  ctx: DbContext,
  entry: Omit<AuditEntry, 'ip' | 'userAgent'> & { targetId: string },
  key: string,
) {
  const value = (entry.data as Record<string, unknown> | undefined)?.[key];
  if (
    typeof value === 'string' &&
    (await hasAuditEntry(ctx, { action: entry.action, targetId: entry.targetId, key, value }))
  ) {
    return false;
  }
  await audit(ctx, entry);
  return true;
}
