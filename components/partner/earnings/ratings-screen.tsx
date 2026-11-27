'use client';

import { ArrowLeft, CircleAlert, FlaskConical, Info, Phone, Star } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PartnerRatingsSummary, TagCount } from '@/server/modules/ratings/schema';
import type { PartnerState } from '@/server/modules/partners/schema';
import { Button } from '@/components/ui/button';
import { formatRating } from '@/lib/format';
import {
  RATINGS_UPDATE_WORDS,
  ratingsCount,
  ratingsSentence,
  SHOWN_AT_FIVE,
  TAGS_AT_FIVE,
  TAGS_WINDOW,
  tagSentence,
  tagWords,
} from '@/lib/partner/earnings-text';
import { CallKitchenLink } from '../delivery/pick-up-screen';
import { PinnedConnectionBanner, usePartnerSession } from '../home/partner-home';
import { SuspensionCover } from '../home/home-parts';
import { OfferLayer, useOfferOpen } from '../offers/offer-layer';
import { DispatchNoticeSlot } from '../offers/offer-notices';
import { IconDisc, PartnerFrame, PartnerNotice, PartnerTabBar, StatusHeader } from '../shell';
import { MoneyNoticeSlot } from './money-notices';
import { useOpenDeliveryOnAccept } from './use-open-delivery';

/*
 * "Your ratings" (F9 design 1.12, P58): his average, how many, and what customers picked, from
 * the figure published once 5 new counted ratings have come in, so no single rating can be
 * worked out. Never a single rating, a date, an order, a customer's name or a comment.
 */

type Home = Extract<PartnerState, { screen: 'home' }>;

export function RatingsScreen({
  state,
  userId,
  asOf,
  summary,
  kitchenPhone,
}: {
  state: Home;
  userId: string;
  asOf: string;
  summary: PartnerRatingsSummary | null;
  kitchenPhone: string | null;
}) {
  const { sharing, online, holding } = usePartnerSession(state, asOf);
  const offerOpen = useOfferOpen();
  useOpenDeliveryOnAccept();
  return (
    <>
      <div inert={sharing.suspended || offerOpen ? true : undefined}>
        <PartnerFrame
          header={
            <StatusHeader
              online={online || Boolean(holding)}
              name={state.partner.name}
              photoUrl={state.partner.photo?.url ?? null}
            />
          }
          pinned={<PinnedConnectionBanner pinned={sharing.pinned} />}
          tabBar={<PartnerTabBar current="profile" />}
          mainClassName="space-y-6"
        >
          <div className="space-y-3 empty:hidden">
            <MoneyNoticeSlot userId={userId} />
            <DispatchNoticeSlot />
          </div>
          <Button
            asChild
            variant="ghost"
            size="kitchen"
            className="-ml-3 min-h-12 px-3 text-strong"
          >
            <Link href="/partner/profile">
              <ArrowLeft className="size-5" aria-hidden />
              Profile
            </Link>
          </Button>
          {summary?.practice ? (
            <PartnerNotice tone="muted" icon={FlaskConical}>
              Practice data. These aren&apos;t real ratings.
            </PartnerNotice>
          ) : null}
          <h1
            data-partner-h1=""
            tabIndex={-1}
            className="font-heading text-title-1 text-strong outline-none"
          >
            Your ratings
          </h1>
          {summary ? <RatingsBody summary={summary} /> : <RatingsError />}
          <Fairness phone={kitchenPhone} />
        </PartnerFrame>
      </div>
      <OfferLayer />
      {sharing.suspended ? <SuspensionCover how={sharing.suspended} /> : null}
    </>
  );
}

function RatingsError() {
  const router = useRouter();
  return (
    <div className="text-center">
      <IconDisc icon={CircleAlert} tone="error" />
      <h2 className="mt-4 font-heading text-title-2 text-strong">
        Couldn&apos;t load your ratings.
      </h2>
      <div className="mt-4 flex justify-center">
        <Button
          type="button"
          variant="outline"
          size="kitchen"
          className="bg-card text-strong"
          onClick={() => router.refresh()}
        >
          Try again
        </Button>
      </div>
    </div>
  );
}

export function RatingsBody({ summary }: { summary: PartnerRatingsSummary }) {
  const count = summary.count;
  const average = summary.average;
  if (count === 0 || average === null) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5 text-center">
        <Star className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-body-3 font-semibold text-strong">No ratings yet.</p>
      </section>
    );
  }
  const underFive = count < 5;
  let tags;
  if (underFive) tags = <p className="text-body-4 text-foreground">{TAGS_AT_FIVE}</p>;
  else if (!summary.tagsShown) tags = <p className="text-body-4 text-foreground">{TAGS_WINDOW}</p>;
  else {
    tags = (
      <>
        <TagGroup title="What customers liked" tags={summary.liked} />
        <TagGroup title="What customers mentioned" tags={summary.mentioned} />
      </>
    );
  }
  return (
    <>
      <section className="rounded-2xl border border-border bg-card p-5 text-center">
        <div aria-hidden className="flex items-center justify-center gap-2">
          <Star className="size-8 fill-current text-warning-mark" />
          <p className="font-sans text-h2 leading-none font-semibold text-strong tabular-nums">
            {formatRating(average)}
          </p>
        </div>
        <p aria-hidden className="mt-2 text-body-4 text-foreground">
          {ratingsCount(count)}
        </p>
        {underFive ? null : (
          <p aria-hidden className="mt-1 text-body-5 text-muted-foreground">
            {RATINGS_UPDATE_WORDS}
          </p>
        )}
        <p className="sr-only">{ratingsSentence(average, count)}</p>
        {underFive ? (
          <p className="mt-3 rounded-xl bg-muted p-3 text-body-5 text-strong">{SHOWN_AT_FIVE}</p>
        ) : null}
      </section>
      {tags}
    </>
  );
}

function TagGroup({ title, tags }: { title: string; tags: TagCount[] }) {
  return (
    <section>
      <h2 className="text-body-3 font-semibold text-strong">{title}</h2>
      <p className="text-body-5 text-muted-foreground">Last 30 days</p>
      {tags.length === 0 ? (
        <p className="mt-3 text-body-4 text-foreground">Nothing in the last 30 days.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
          {tags.map((tag) => (
            <li
              key={tag.tag}
              className="flex min-h-12 items-center justify-between gap-4 px-4 text-body-4 text-strong"
            >
              <span aria-hidden className="[overflow-wrap:anywhere]">
                {tagWords(tag.tag)}
              </span>
              <span aria-hidden className="font-semibold tabular-nums">
                {tag.count}
              </span>
              <span className="sr-only">{tagSentence(tag.tag, tag.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Fairness({ phone }: { phone: string | null }) {
  return (
    <section className="space-y-3 rounded-2xl bg-muted p-4 text-body-4 text-strong">
      <p className="flex gap-3">
        <Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        Ratings don&apos;t change which offers you get.
      </p>
      <p className="flex gap-3">
        <Phone className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        If you think a rating is unfair, call Foodz Kitchen.
      </p>
      {phone ? <CallKitchenLink phone={phone} /> : null}
    </section>
  );
}
