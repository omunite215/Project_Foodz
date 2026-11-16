import { Mail, MapPin, Phone } from 'lucide-react';
import type { StoreStatus } from '@/server/modules/menu/schema';
import { groupWeeklyHours } from '@/lib/format';
import { FooterLinks } from './footer-links';
import { LogoLink } from './logo';
import { PageContainer } from './page-container';

/** Only used when the store settings cannot be read. */
const FALLBACK_YEAR = '2026';

function OpeningHours({ status }: { status: StoreStatus | null }) {
  const rows = status ? groupWeeklyHours(status.weeklyHours) : [];

  return (
    <div>
      <h2 className="text-button-1 font-medium text-neutral-1">Opening hours</h2>
      {rows.length > 0 && status ? (
        <dl className="mt-4 max-w-80 space-y-2">
          {rows.map((row) => {
            const isToday = row.weekdays.includes(status.today);
            return (
              <div
                key={row.days}
                className={
                  isToday
                    ? 'flex justify-between gap-6 text-body-4 font-semibold'
                    : 'flex justify-between gap-6 text-body-4'
                }
              >
                <dt className="text-muted-foreground">
                  {row.days}
                  {isToday ? <span className="sr-only"> (today)</span> : null}
                </dt>
                <dd className="text-neutral-2 tabular-nums">{row.hours}</dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="mt-4 text-body-4 text-muted-foreground">Opening hours unavailable</p>
      )}
    </div>
  );
}

function ContactList({ store }: { store: StoreStatus['store'] }) {
  const tel = store.phone.replace(/[^\d+]/g, '');
  const linkClass =
    'inline-flex min-h-11 items-center gap-2 underline-offset-4 hover:underline md:min-h-0';

  return (
    <ul className="mt-6 space-y-2 text-body-5 text-neutral-3">
      <li className="flex items-start gap-2">
        <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{store.addressText}</span>
      </li>
      <li>
        <a href={`tel:${tel}`} className={linkClass}>
          <Phone className="size-4 shrink-0" aria-hidden />
          {store.phone}
        </a>
      </li>
      <li>
        <a href={`mailto:${store.email}`} className={linkClass}>
          <Mail className="size-4 shrink-0" aria-hidden />
          {store.email}
        </a>
      </li>
    </ul>
  );
}

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
            {status ? <ContactList store={status.store} /> : null}
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
