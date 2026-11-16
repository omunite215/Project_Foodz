import { Mail, MapPin, Phone } from 'lucide-react';
import type { StoreStatus } from '@/server/modules/menu/schema';
import { groupWeeklyHours } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The weekly hours, today in bold; says so when the settings cannot be read. */
export function OpeningHours({ status }: { status: StoreStatus | null }) {
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

/** Address, phone and email, each a 44px tap target on phones. */
export function ContactList({
  store,
  className,
}: {
  store: StoreStatus['store'];
  className?: string;
}) {
  const tel = store.phone.replace(/[^\d+]/g, '');
  const linkClass =
    'inline-flex min-h-11 items-center gap-2 underline-offset-4 hover:underline md:min-h-0';

  return (
    <ul className={cn('space-y-2 text-body-5 text-neutral-3', className)}>
      <li className="flex min-h-11 items-center gap-2 md:min-h-0 md:items-start">
        <MapPin className="size-4 shrink-0 md:mt-0.5" aria-hidden />
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
