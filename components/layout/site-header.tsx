import Link from 'next/link';
import { CartButton } from '@/components/cart/cart-button';
import { Button } from '@/components/ui/button';
import { AccountEntry, type HeaderAccount } from './account-entry';
import { LogoLink } from './logo';
import { MainNav } from './main-nav';
import { MobileNav } from './mobile-nav';
import { PageContainer } from './page-container';
import { SearchLink } from './search-link';

/**
 * Not sticky, so it never covers the element that has focus. The account slot is rendered from
 * the server's session read, never fetched after paint (S2.1). The search icon and the cart sit
 * in their own 44 px slots, so nothing shifts when the cart loads (F3 design 1.1).
 */
export function SiteHeader({
  account,
  phone,
}: {
  account: HeaderAccount | null;
  /** The store's number for the cart-full notice. */
  phone: { display: string; tel: string } | null;
}) {
  return (
    <header className="relative z-30 bg-neutral-8">
      <PageContainer className="flex h-18 items-center justify-between gap-4 lg:h-28">
        <LogoLink imageClassName="h-[18px] md:h-7 lg:h-10" />
        <div className="flex items-center gap-2 lg:gap-8">
          <MainNav />
          <div className="flex items-center gap-2">
            <SearchLink />
            <CartButton signedIn={account !== null} phone={phone} />
          </div>
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
