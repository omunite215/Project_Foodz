import { ContactList, OpeningHours } from '@/components/store/store-contact';
import type { StoreStatus } from '@/server/modules/menu/schema';
import { FooterLinks } from './footer-links';
import { LogoLink } from './logo';
import { PageContainer } from './page-container';

/** Only used when the store settings cannot be read. */
const FALLBACK_YEAR = '2026';

/** Hours, address and links come from the store settings, so changing them changes the page. */
export function SiteFooter({ status }: { status: StoreStatus | null }) {
  const groups = status?.footerLinks ?? [];

  return (
    <footer className="border-t border-neutral-6 bg-neutral-8">
      <PageContainer className="py-10 md:py-15 xl:pt-15 xl:pb-10">
        <div className="flex flex-col gap-8 md:grid md:grid-cols-2 xl:grid-cols-12">
          <div className="xl:col-span-4">
            <LogoLink imageClassName="h-10" />
            <p className="mt-3 max-w-[336px] text-body-5 text-muted-foreground">
              Korean, Thai and Vietnamese food, cooked to order and delivered hot in Boston.
            </p>
            {status ? <ContactList store={status.store} className="mt-6" /> : null}
          </div>
          <div className="xl:col-span-3">
            <OpeningHours status={status} />
          </div>
          {groups.length > 0 ? (
            <div className="md:col-span-2 xl:col-span-5">
              <FooterLinks groups={groups} />
            </div>
          ) : null}
        </div>
        <p className="mt-10 border-t border-neutral-6 pt-6 text-body-5 text-muted-foreground">
          © {status?.at.slice(0, 4) ?? FALLBACK_YEAR} Foodz
        </p>
      </PageContainer>
    </footer>
  );
}
