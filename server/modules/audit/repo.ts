import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';
import type { Prisma } from '@/server/db/generated/client';

export interface AuditEntry {
  action: string;
  targetType: string;
  targetId?: string;
  data?: Prisma.InputJsonValue;
  ip?: string;
  userAgent?: string;
}

export async function insertAuditEntry(ctx: DbContext, entry: AuditEntry) {
  const actor = ctx.actor;
  await db(ctx).auditLog.create({
    data: {
      actorId: actor.kind === 'user' ? actor.userId : null,
      actorRole: actor.kind === 'user' ? actor.role : actor.kind,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      data: entry.data,
      ip: entry.ip,
      userAgent: entry.userAgent,
    },
    select: { id: true },
  });
}
