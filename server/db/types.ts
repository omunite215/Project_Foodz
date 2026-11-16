import type { Role } from '@/server/auth/roles';

export type Actor =
  | { kind: 'user'; userId: string; role: Role; isDemo: boolean }
  | { kind: 'anonymous' }
  | { kind: 'system'; reason: string };

/**
 * An opaque handle that services pass to repositories. It carries an open transaction whose
 * Postgres session has `app.user_id` and `app.role` set, so row-level security applies.
 */
export interface DbContext {
  readonly actor: Actor;
}
