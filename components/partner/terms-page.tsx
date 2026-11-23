'use client';

import { useRouter } from 'next/navigation';
import type { LegalPage } from '@/server/modules/content/schema';
import { termsVersionLine } from '@/lib/partner/text';
import { TERMS_UNAVAILABLE, TermsProse } from './apply/terms-sheet';
import { PartnerFrame, PlainHeader } from './shell';

/** `/partner/terms`: the same content as the sheet, as a page with the plain header. */
export function TermsPage({ terms, timeZone }: { terms: LegalPage | null; timeZone: string }) {
  const router = useRouter();
  return (
    <PartnerFrame
      header={
        <PlainHeader
          title="Partner Terms"
          menu={false}
          start={{
            kind: 'back',
            onBack: () => {
              if (window.history.length > 1) router.back();
              else router.push('/partner');
            },
          }}
        />
      }
    >
      <article>
        <h1 className="font-heading text-title-1 text-strong">Foodz Partner Terms</h1>
        <p className="mt-2 text-body-5 text-muted-foreground">
          {terms ? termsVersionLine(terms.version, terms.publishedAt, timeZone) : null}
        </p>
        <div className="mt-6">
          {terms ? (
            <TermsProse blocks={terms.blocks} />
          ) : (
            <p className="rounded-xl bg-danger-soft px-4 py-3 text-body-4 text-strong">
              {TERMS_UNAVAILABLE}
            </p>
          )}
        </div>
      </article>
    </PartnerFrame>
  );
}
