import Link from 'next/link';
import type { CampaignBanner as Campaign } from '@/server/modules/menu/schema';
import { dishHref } from '@/server/modules/menu/urls';
import { DishPlate } from '@/components/dish/dish-plate';
import { OfferCountdown } from '@/components/dish/offer-countdown';
import { Button } from '@/components/ui/button';
import { formatPrice, splitByCode } from '@/lib/format';
import { isSitePath } from '@/lib/navigation';
import { CopyCodeButton } from './copy-code-button';

/** The coupon code as real text: one tap selects all of it. */
export function CouponCode({ code }: { code: string }) {
  return (
    <span className="mx-0.5 inline-flex h-8 items-center rounded-md border border-dashed border-brand-strong bg-white px-2 align-middle font-semibold tracking-wider text-neutral-1 select-all">
      {code}
    </span>
  );
}

function Subtitle({ text, code }: { text: string | null; code: string | null }) {
  if (!code) return text;
  const parts = text ? splitByCode(text, code) : [];
  const hasCode = parts.some((part) => part.isCode);
  return (
    <>
      {parts.map((part) =>
        part.isCode ? <CouponCode key={part.start} code={part.text} /> : part.text,
      )}
      {hasCode ? null : (
        <>
          {text ? ' ' : null}Code <CouponCode code={code} />
        </>
      )}
    </>
  );
}

/**
 * A running campaign on Home: what it is, its code (selectable and copyable), a way to order,
 * and the dishes it covers (sold-out ones are already left out by the server).
 */
export function CampaignBanner({
  campaign,
  headingLevel: Heading = 'h2',
}: {
  campaign: Campaign;
  headingLevel?: 'h2' | 'h3';
}) {
  const code = campaign.coupon?.code ?? null;
  const cta = campaign.cta && isSitePath(campaign.cta.href) ? campaign.cta : null;

  return (
    <div className="w-full rounded-2xl bg-brand-soft p-6 md:rounded-3xl md:p-8 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center lg:gap-12 xl:p-12">
      <div>
        <OfferCountdown endsAt={campaign.endsAt} variant="white" />
        <Heading className="mt-4 font-heading text-h4 text-balance text-neutral-1 md:text-h3">
          {campaign.title}
        </Heading>
        <p className="mt-3 text-body-4 leading-loose text-neutral-2 md:text-body-2">
          <Subtitle text={campaign.subtitle} code={code} />
        </p>
        {cta || code ? (
          <div className="mt-6 flex flex-wrap items-start gap-3">
            {cta && isSitePath(cta.href) ? (
              <Button asChild size="touch" className="uppercase">
                <Link href={cta.href}>{cta.label}</Link>
              </Button>
            ) : null}
            {code ? <CopyCodeButton code={code} /> : null}
          </div>
        ) : null}
      </div>
      {campaign.dishes.length > 0 ? (
        <ul className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6 lg:mt-0 lg:grid-cols-2 xl:grid-cols-4">
          {campaign.dishes.map((dish) => (
            <li key={dish.id}>
              <Link
                href={dishHref(dish.slug)}
                className="flex min-h-11 flex-col items-center gap-2 rounded-xl p-1 text-center outline-offset-2 hover:bg-white/60"
              >
                <DishPlate
                  src={dish.image}
                  sizes="120px"
                  className="w-22 max-w-full md:w-24 xl:w-30"
                />
                <span className="sr-only">{`${dish.title}, ${formatPrice(dish.priceCents)}`}</span>
                <span
                  aria-hidden
                  className="line-clamp-2 text-body-5 font-medium text-neutral-1 md:text-body-4"
                >
                  {dish.title}
                </span>
                <span aria-hidden className="text-body-5 font-semibold text-neutral-2 tabular-nums">
                  {formatPrice(dish.priceCents)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
