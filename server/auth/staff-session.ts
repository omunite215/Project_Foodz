import { STAFF_SESSION_MS } from '@/server/modules/staff/schema';
import { isStaff, type Role } from './roles';

/*
 * Staff sessions last 12 hours from sign-in and are never extended by activity (F5 U11, A1.7).
 * The database row is given that end at sign-in (server/auth/index.ts), and the session reads as
 * signed out once it passes, whatever the row says.
 */

/** When a staff session that started at `createdAt` ends. */
export const staffSessionEnd = (createdAt: Date) =>
  new Date(createdAt.getTime() + STAFF_SESSION_MS);

/** True when a staff member's session is older than 12 hours. Customers keep 7 days. */
export function staffSessionOver(role: Role, createdAt: Date | string, now = new Date()): boolean {
  if (!isStaff(role)) return false;
  return staffSessionEnd(new Date(createdAt)).getTime() <= now.getTime();
}
