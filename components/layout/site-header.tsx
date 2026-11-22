import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AccountEntry, type HeaderAccount } from './account-entry';
import { CartStatus } from './cart-status';
import { LogoLink } from './logo';
import { MainNav } from './main-nav';
import { MobileNav } from './mobile-nav';
import { PageContainer } from './page-container';

/**
 * Not sticky, so it never covers the element that has focus. The account slot is rendered from
 * the server's session read, never fetched after paint (S2.1).
 */
export function SiteHeader({ account }: { account: HeaderAccount | null }) {
  return (
    <header className="relative z-30 bg-neutral-8">
      <PageContainer className="flex h-18 items-center justify-between gap-4 lg:h-28">
        <LogoLink imageClassName="h-[18px] md:h-7 lg:h-10" />
        <div className="flex items-center gap-2 lg:gap-8">
          <MainNav />
          <CartStatus />
          <AccountEntry account={account} />
          <Button asChild size="touch" className="hidden uppercase lg:inline-flex">
            <Link href="/menu">Order now</Link>
          </Button>
          <MobileNav signedIn={account !== null} />
        </div>
      </PageContainer>
    </header>
  );
}
