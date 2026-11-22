import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn<() => Promise<unknown>>() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('./index', () => ({ auth: { api: { getSession } } }));

const { requirePermission } = await import('./session');

function signedIn(user: {
  role: string;
  isDemo?: boolean;
  twoFactorEnabled?: boolean;
  banned?: boolean;
}) {
  getSession.mockResolvedValue({
    user: { id: '0196a1b2-0000-7000-8000-00000000000a', isDemo: false, banned: false, ...user },
    session: { createdAt: new Date() },
  });
}

const readOrders = { order: ['read-any'] } as const;

beforeEach(() => {
  getSession.mockReset();
});

describe('requirePermission', () => {
  it('lets a customer do what customers may do', async () => {
    signedIn({ role: 'customer' });
    await expect(requirePermission({ order: ['create'] })).resolves.toMatchObject({
      role: 'customer',
    });
  });

  it('refuses a permission the role does not hold', async () => {
    signedIn({ role: 'customer' });
    await expect(requirePermission(readOrders)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses staff without two-factor, and allows them once it is on', async () => {
    signedIn({ role: 'kitchen', twoFactorEnabled: false });
    await expect(requirePermission(readOrders)).rejects.toMatchObject({
      code: 'TWO_FACTOR_REQUIRED',
      message: 'Set up two-factor sign-in to use staff tools.',
    });

    signedIn({ role: 'kitchen', twoFactorEnabled: true });
    await expect(requirePermission(readOrders)).resolves.toMatchObject({ role: 'kitchen' });
  });

  it('lets the demo admin read without two-factor', async () => {
    signedIn({ role: 'admin', isDemo: true, twoFactorEnabled: false });
    await expect(requirePermission(readOrders, { write: false })).resolves.toMatchObject({
      role: 'admin',
      isDemo: true,
    });
  });

  it('never lets a demo account write, even with two-factor on', async () => {
    signedIn({ role: 'admin', isDemo: true, twoFactorEnabled: true });
    await expect(requirePermission({ user: ['ban'] })).rejects.toMatchObject({
      code: 'DEMO_READ_ONLY',
      message: "Demo accounts can't change this.",
    });
    await expect(requirePermission({ user: ['ban'] }, { write: true })).rejects.toMatchObject({
      code: 'DEMO_READ_ONLY',
    });
  });

  it('treats banned users and missing sessions as signed out', async () => {
    signedIn({ role: 'admin', twoFactorEnabled: true, banned: true });
    await expect(requirePermission(readOrders)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    getSession.mockResolvedValue(null);
    await expect(requirePermission(readOrders)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
