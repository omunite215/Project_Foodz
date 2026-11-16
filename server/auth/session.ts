import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import type { Actor } from '@/server/db/context';
import { demoReadOnly, forbidden, twoFactorRequired, unauthenticated } from '@/server/errors';
import { auth } from './index';
import { can, isRole, isStaff, type Permission } from './roles';

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export type UserActor = Extract<Actor, { kind: 'user' }>;

/** The caller for this request, resolved once and reused across the render. */
export const getActor = cache(async (): Promise<Actor> => {
  const session = await getSession();
  if (!session || session.user.banned) return { kind: 'anonymous' };
  return {
    kind: 'user',
    userId: session.user.id,
    role: isRole(session.user.role) ? session.user.role : 'customer',
    isDemo: Boolean(session.user.isDemo),
  };
});

export async function requireUser(): Promise<UserActor> {
  const actor = await getActor();
  if (actor.kind !== 'user') throw unauthenticated();
  return actor;
}

/**
 * Checks a permission for a signed-in user. Demo accounts may only read. Other staff accounts
 * must have two-factor enabled; the shared demo admin is exempt because it can never write.
 */
export async function requirePermission(permission: Permission, options: { write?: boolean } = {}) {
  const actor = await requireUser();
  if (!can(actor.role, permission)) throw forbidden();

  if (actor.isDemo) {
    if (options.write !== false) throw demoReadOnly();
  } else if (isStaff(actor.role)) {
    const session = await getSession();
    if (!session?.user.twoFactorEnabled) throw twoFactorRequired();
  }
  return actor;
}

/** Sensitive actions (refunds, bans, role changes, publishing terms) need a recent sign-in. */
export async function requireFreshSession() {
  const session = await getSession();
  if (!session) throw unauthenticated();
  const ageMs = Date.now() - new Date(session.session.createdAt).getTime();
  if (ageMs > 10 * 60 * 1000) throw forbidden();
  return session;
}
