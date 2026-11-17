'use client';

import { createContext, type ReactNode, useContext, useEffect } from 'react';
import type { AccountDto } from '@/server/modules/account/schema';

const AccountContext = createContext<AccountDto | null>(null);

/**
 * The account summary read once by the account layout. Pages and their loading skeletons read it,
 * so a skeleton draws the state the page will actually render (design 4.1, States).
 */
export function AccountProvider({
  account,
  children,
}: {
  account: AccountDto;
  children: ReactNode;
}) {
  return <AccountContext value={account}>{children}</AccountContext>;
}

export function useAccount(): AccountDto {
  const account = useContext(AccountContext);
  if (!account) throw new Error('useAccount needs the account layout');
  return account;
}

/**
 * A page restored from the back-forward cache after signing out would show account details
 * without asking the server; reload it instead, which sends a signed-out visitor to sign in (S5.9).
 */
export function ReloadFromBackForwardCache() {
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  return null;
}
