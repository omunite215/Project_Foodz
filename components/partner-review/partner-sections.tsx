import Link from 'next/link';
import type { PartnerListQuery } from '@/server/modules/partners/review-schema';
import { PARTNER_SECTIONS, type PartnerSection, SECTION_LABELS } from '@/lib/admin/earnings-text';
import { applicationHref } from '@/lib/partner-review/url';
import { cn } from '@/lib/utils';

/*
 * The partner page's sections (F9 design 3.3): Earnings, Ratings and Application as link tabs,
 * so the view is in the address (reload and Back keep it) and the list it came from stays in
 * the address too, for "Back to partners". F6 7.3's tab look.
 */

const TAB_LINK =
  'relative inline-flex h-12 shrink-0 items-center px-3 text-body-5 font-medium text-neutral-3 hover:text-neutral-1 focus-visible:-outline-offset-2';

export function PartnerSectionsNav({
  partnerId,
  list,
  current,
}: {
  partnerId: string;
  list: PartnerListQuery;
  current: PartnerSection;
}) {
  return (
    <nav
      aria-label="Partner sections"
      className="mt-6 flex gap-1 overflow-x-auto border-b border-neutral-6"
    >
      {PARTNER_SECTIONS.map((section) => {
        const isCurrent = section === current;
        return (
          <Link
            key={section}
            href={applicationHref(partnerId, list, { view: section })}
            scroll={false}
            prefetch={false}
            aria-current={isCurrent ? 'page' : undefined}
            className={cn(
              TAB_LINK,
              isCurrent &&
                'text-neutral-1 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-brand-strong',
            )}
          >
            {SECTION_LABELS[section]}
          </Link>
        );
      })}
    </nav>
  );
}
