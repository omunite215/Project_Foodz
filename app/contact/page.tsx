import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { ContactList, OpeningHours } from '@/components/store/store-contact';
import { loadStoreStatus } from '@/lib/storefront-data';

export const metadata: Metadata = { title: 'Contact' };

/** How to reach the kitchen, from the store settings (the same details as the footer). */
export default async function ContactPage() {
  const status = await loadStoreStatus();

  return (
    <PageContainer className="pt-10 pb-15 md:pt-20 md:pb-20">
      <h1 className="text-center font-heading text-h4 leading-tight text-neutral-2 md:text-h2">
        Contact us
      </h1>
      <p className="mx-auto mt-3 max-w-[560px] text-center text-body-4 text-muted-foreground md:text-body-2">
        Questions about an order, allergies or catering? Call or email us while we are open.
      </p>

      <div className="mx-auto mt-10 grid max-w-[768px] gap-8 rounded-2xl bg-neutral-7 p-6 md:mt-15 md:grid-cols-2 md:gap-12 md:p-10">
        <div>
          <h2 className="text-button-1 font-medium text-neutral-1">Get in touch</h2>
          {status ? (
            <ContactList store={status.store} className="mt-4" />
          ) : (
            <p className="mt-4 text-body-4 text-muted-foreground">
              Contact details unavailable right now
            </p>
          )}
        </div>
        <OpeningHours status={status} />
      </div>
    </PageContainer>
  );
}
