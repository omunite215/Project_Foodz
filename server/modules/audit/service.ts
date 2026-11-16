import 'server-only';
import type { DbContext } from '@/server/db/context';
import { requestInfo } from '@/server/request';
import { type AuditEntry, insertAuditEntry } from './repo';

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
