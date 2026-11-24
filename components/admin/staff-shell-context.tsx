'use client';

import { createContext, type ReactNode, use } from 'react';
import { STAFF_ROLE_LABELS, type StaffRole, type StaffScreen } from '@/server/modules/staff/schema';

/*
 * What the `/admin` layout decided on the server (F5 design 1.1), handed to the shell's client
 * parts: who is signed in, which frame they get and when their session ends. The browser never
 * decides access; it only draws what the server allowed.
 */

export type ShellFrame =
  /** Staff without two-factor: logo and account menu only (design 1.8). */
  | 'gate'
  /** KITCHEN: top bar only, no sidebar (A1.6, A16.1). */
  | 'kitchen'
  /** SUPPORT, ADMIN and the demo admin: sidebar and top bar. */
  | 'sidebar'
  /** CONTENT_EDITOR: top bar only, nothing to list yet (D3). */
  | 'editor';

export interface StaffShellValue {
  frame: ShellFrame;
  user: { name: string; role: StaffRole; isDemo: boolean };
  screens: StaffScreen[];
  readOnly: boolean;
  /** Sign-in plus 12 hours; null on the two-factor gate. */
  sessionExpiresAt: string | null;
  timeZone: string;
}

const StaffShellContext = createContext<StaffShellValue | null>(null);

export function StaffShellProvider({
  value,
  children,
}: {
  value: StaffShellValue;
  children: ReactNode;
}) {
  return <StaffShellContext value={value}>{children}</StaffShellContext>;
}

export function useStaffShell(): StaffShellValue {
  const value = use(StaffShellContext);
  if (!value) throw new Error('useStaffShell must be used inside the /admin layout.');
  return value;
}

/** "Admin", "Admin (demo)", "Kitchen", "Content editor". */
export const roleLabel = (user: StaffShellValue['user']) =>
  user.isDemo ? `${STAFF_ROLE_LABELS[user.role]} (demo)` : STAFF_ROLE_LABELS[user.role];
